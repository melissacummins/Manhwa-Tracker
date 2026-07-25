// Browser-side migration: legacy `manhwas` collection -> `users/{uid}/media`.
//
// Runs entirely in the signed-in user's browser under the Firestore security
// rules — no service account, no terminal. Same pipeline as
// scripts/migrate.mjs (which remains as a power-user alternative):
// backup -> split " / " titles -> exact-title dedupe -> AniList enrichment
// (strict match confidence, rate-limited, cached in localStorage) ->
// same-AniList-id dedupe -> batched writes. Never modifies legacy data.
// Resumable: items already present in users/{uid}/media are skipped.

import {
  collection,
  db,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from '../firebase';
import { Timestamp } from 'firebase/firestore';
import { MediaItem, normalizeTitle } from '../types';

const STATUS_PRECEDENCE = ['Completed', 'Reading', 'On Hold', 'Plan to Read', 'Dropped'];
const ALT_TITLE_CAP = 25;
const ANILIST_INTERVAL_MS = 2500;
const CACHE_KEY = 'cc-migration-anilist-cache';

export interface MigrationProgress {
  phase: 'reading' | 'enriching' | 'writing' | 'done';
  current: number;
  total: number;
  matched: number;
  detail: string;
}

export interface MigrationReport {
  counts: {
    legacyDocs: number;
    alreadyMigrated: number;
    needsAttention: number;
    titleSplits: number;
    afterTitleDedupe: number;
    anilistMatched: number;
    unmatched: number;
    written: number;
  };
  merges: { kept: string; mergedTitles: string[] }[];
  possibleDuplicates: { sharedName: string; a: string; b: string }[];
  unmatched: string[];
  droppedAltTitles: Record<string, string[]>;
}

interface LegacyDoc {
  id: string;
  title: string;
  alternativeTitles: string[];
  status: string;
  isFavorite: boolean;
  notes: string;
  createdAt: any;
  updatedAt: any;
}

function pickStatus(a: string, b: string): string {
  const ia = STATUS_PRECEDENCE.indexOf(a);
  const ib = STATUS_PRECEDENCE.indexOf(b);
  if (ia === -1) return b;
  if (ib === -1) return a;
  return ia <= ib ? a : b;
}

function comicTypeFromCountry(country: string | null): MediaItem['mediaType'] {
  if (country === 'KR') return 'manhwa';
  if (country === 'CN' || country === 'TW') return 'manhua';
  if (country === 'JP') return 'manga';
  return 'manhwa';
}

function downloadJson(filename: string, data: unknown) {
  const uri = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
  const a = document.createElement('a');
  a.setAttribute('href', uri);
  a.setAttribute('download', filename);
  a.click();
}

// --- AniList lookup with localStorage cache and rate limiting ---

const ANILIST_QUERY = `
query ($search: String) {
  Page(perPage: 5) {
    media(search: $search, type: MANGA) {
      id
      title { romaji english native }
      synonyms
      coverImage { large }
      startDate { year }
      countryOfOrigin
      format
    }
  }
}`;

type AniListMedia = {
  id: number;
  title: { romaji?: string; english?: string; native?: string };
  synonyms?: string[];
  coverImage?: { large?: string };
  startDate?: { year?: number };
  countryOfOrigin?: string;
  format?: string;
};

function loadCache(): Record<string, AniListMedia[] | null> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, AniListMedia[] | null>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage full — enrichment still works, just without resume caching
  }
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

let lastRequestAt = 0;

async function anilistSearch(
  title: string,
  cache: Record<string, AniListMedia[] | null>,
): Promise<AniListMedia[] | null> {
  const key = normalizeTitle(title);
  if (key in cache) return cache[key];

  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastRequestAt + ANILIST_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    let res: Response;
    try {
      res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: title } }),
      });
    } catch {
      await sleep(2000 * 2 ** attempt);
      continue;
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      await sleep(Math.max(retryAfter * 1000, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) {
      cache[key] = null;
      saveCache(cache);
      return null;
    }

    const json = await res.json();
    const media: AniListMedia[] = (json?.data?.Page?.media || []).filter((m: AniListMedia) => m.format !== 'NOVEL');
    cache[key] = media;
    saveCache(cache);
    return media;
  }
  return null;
}

function findConfidentMatch(candidates: AniListMedia[] | null, ownTitles: string[]): AniListMedia | null {
  if (!candidates) return null;
  const own = new Set(ownTitles.map(normalizeTitle).filter(Boolean));
  for (const m of candidates) {
    const theirs = [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])]
      .filter((t): t is string => !!t)
      .map(normalizeTitle);
    if (theirs.some(t => own.has(t))) return m;
  }
  return null;
}

// --- Main entry point ---

export async function runMigration(
  uid: string,
  onProgress: (p: MigrationProgress) => void,
  isCancelled: () => boolean,
): Promise<MigrationReport | null> {
  // 1. Read legacy data (own docs only, per security rules)
  onProgress({ phase: 'reading', current: 0, total: 0, matched: 0, detail: 'Reading your legacy collection...' });
  const legacySnap = await getDocs(query(collection(db, 'manhwas'), where('userId', '==', uid)));
  const legacyDocs = legacySnap.docs.map(d => ({ id: d.id, ...d.data() })) as (LegacyDoc & { userId: string })[];

  if (legacyDocs.length === 0) {
    throw new Error('No legacy entries found for your account — nothing to migrate.');
  }

  // 2. Automatic backup download BEFORE anything else
  const stamp = new Date().toISOString().slice(0, 10);
  downloadJson(`legacy-backup-${stamp}.json`, legacyDocs.map(d => ({
    ...d,
    createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? d.createdAt,
    updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() ?? d.updatedAt,
  })));

  // 3. What's already migrated? (makes re-runs safe)
  const existingSnap = await getDocs(collection(db, 'users', uid, 'media'));
  const existingIds = new Set(existingSnap.docs.map(d => d.id));

  const needsAttention = legacyDocs.filter(d => !d.title);
  const usable = legacyDocs.filter(d => d.title);

  // 4. Split " / " titles (slash WITHOUT surrounding spaces is part of the title)
  let splitCount = 0;
  const items = usable.map(d => {
    const segments = d.title.split(' / ').map(s => s.trim()).filter(Boolean);
    if (segments.length > 1) splitCount++;
    const alts = new Map<string, string>();
    for (const a of [...segments.slice(1), ...(d.alternativeTitles || [])]) {
      const n = normalizeTitle(a);
      if (n && n !== normalizeTitle(segments[0]) && !alts.has(n)) alts.set(n, a);
    }
    return { ...d, title: segments[0], alternativeTitles: [...alts.values()] };
  });

  // 5. Dedupe by EXACT normalized primary title only. Legacy alt titles are
  // untrustworthy (corrupted AI fragments falsely link unrelated series) —
  // alt overlaps are reported as possibleDuplicates, never auto-merged.
  type Working = typeof items[number];
  const merges: { kept: string; mergedTitles: string[] }[] = [];
  function mergeGroup(group: Working[]): Working {
    if (group.length === 1) return group[0];
    const [first, ...rest] = group;
    const out = { ...first };
    for (const other of rest) {
      out.status = pickStatus(out.status, other.status);
      out.isFavorite = out.isFavorite || other.isFavorite;
      out.notes = out.notes || other.notes || '';
      const alts = new Map(out.alternativeTitles.map(a => [normalizeTitle(a), a]));
      for (const a of [other.title, ...other.alternativeTitles]) {
        const n = normalizeTitle(a);
        if (n && n !== normalizeTitle(out.title) && !alts.has(n)) alts.set(n, a);
      }
      out.alternativeTitles = [...alts.values()];
      if (other.createdAt?.toMillis && out.createdAt?.toMillis && other.createdAt.toMillis() < out.createdAt.toMillis()) {
        out.createdAt = other.createdAt;
      }
    }
    merges.push({ kept: out.title, mergedTitles: rest.map(r => r.title) });
    return out;
  }

  const byPrimary = new Map<string, Working[]>();
  for (const item of items) {
    const n = normalizeTitle(item.title);
    if (!byPrimary.has(n)) byPrimary.set(n, []);
    byPrimary.get(n)!.push(item);
  }
  const merged = [...byPrimary.values()].map(mergeGroup);

  const toMigrate = merged.filter(item => !existingIds.has(item.id));
  const alreadyMigrated = merged.length - toMigrate.length;

  // 6. Enrich + write, in interleaved batches so progress is durable
  const cache = loadCache();
  const unmatched: string[] = [];
  const droppedAltTitles: Record<string, string[]> = {};
  const enriched: (Working & Partial<MediaItem>)[] = [];
  let matchedCount = 0;

  for (let i = 0; i < toMigrate.length; i++) {
    if (isCancelled()) return null;
    const item = toMigrate[i];
    onProgress({
      phase: 'enriching',
      current: i + 1,
      total: toMigrate.length,
      matched: matchedCount,
      detail: item.title,
    });

    const candidates = await anilistSearch(item.title, cache);
    const match = findConfidentMatch(candidates, [item.title, ...item.alternativeTitles]);
    if (match) {
      matchedCount++;
      const primaryNorm = normalizeTitle(item.title);
      const official = new Map<string, string>();
      for (const t of [match.title?.english, match.title?.romaji, match.title?.native, ...(match.synonyms || [])]) {
        if (!t) continue;
        const n = normalizeTitle(t);
        if (n && n !== primaryNorm && !official.has(n)) official.set(n, t);
      }
      const newAlts = [...official.values()].slice(0, ALT_TITLE_CAP);
      const newAltNorms = new Set(newAlts.map(normalizeTitle));
      const dropped = item.alternativeTitles.filter(a => !newAltNorms.has(normalizeTitle(a)));
      if (dropped.length) droppedAltTitles[item.title] = dropped;
      enriched.push({
        ...item,
        alternativeTitles: newAlts,
        coverUrl: match.coverImage?.large || null,
        year: match.startDate?.year ?? null,
        externalIds: { anilistId: match.id },
        mediaType: comicTypeFromCountry(match.countryOfOrigin ?? null),
      });
    } else {
      unmatched.push(item.title);
      enriched.push({
        ...item,
        alternativeTitles: item.alternativeTitles.slice(0, ALT_TITLE_CAP),
        coverUrl: null,
        year: null,
        externalIds: {},
        mediaType: 'manhwa',
      });
    }
  }

  // 6b. Same-AniList-id dedupe (authoritative: same id = same series)
  const byAnilist = new Map<number, typeof enriched>();
  const noId: typeof enriched = [];
  for (const item of enriched) {
    const aid = item.externalIds?.anilistId;
    if (aid) {
      if (!byAnilist.has(aid)) byAnilist.set(aid, []);
      byAnilist.get(aid)!.push(item);
    } else {
      noId.push(item);
    }
  }
  const finalList = [
    ...[...byAnilist.values()].map(g => mergeGroup(g as Working[]) as typeof enriched[number]),
    ...noId,
  ];

  // 6c. Remaining alt-title overlaps: report-only
  const nameOwners = new Map<string, { id: string; title: string }>();
  const possibleDuplicates: { sharedName: string; a: string; b: string }[] = [];
  for (const item of finalList) {
    for (const name of [item.title, ...(item.alternativeTitles || [])]) {
      const n = normalizeTitle(name);
      if (!n) continue;
      const owner = nameOwners.get(n);
      if (owner && owner.id !== item.id) {
        possibleDuplicates.push({ sharedName: name, a: owner.title, b: item.title });
      } else {
        nameOwners.set(n, { id: item.id, title: item.title });
      }
    }
  }

  // 7. Batched writes (450 per batch, well under the 500 limit)
  let written = 0;
  for (let i = 0; i < finalList.length; i += 450) {
    if (isCancelled()) return null;
    const batch = writeBatch(db);
    for (const item of finalList.slice(i, i + 450)) {
      batch.set(doc(db, 'users', uid, 'media', item.id), {
        mediaType: item.mediaType,
        title: item.title,
        alternativeTitles: item.alternativeTitles,
        coverUrl: item.coverUrl ?? null,
        status: item.status,
        isFavorite: !!item.isFavorite,
        wouldRevisit: !!item.isFavorite,
        rating: null,
        tags: [],
        year: item.year ?? null,
        externalIds: item.externalIds ?? {},
        notes: item.notes || '',
        createdAt: item.createdAt ?? Timestamp.now(),
        updatedAt: item.updatedAt ?? Timestamp.now(),
      });
    }
    await batch.commit();
    written += Math.min(450, finalList.length - i);
    onProgress({ phase: 'writing', current: written, total: finalList.length, matched: matchedCount, detail: 'Saving...' });
  }

  // 8. Migrate legacy settings (status colors) if present
  const legacySettings = await getDoc(doc(db, 'userSettings', uid));
  if (legacySettings.exists()) {
    const statusConfig = (legacySettings.data() as any).statusConfig;
    if (statusConfig) {
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', uid, 'settings', 'config'), { statusConfig });
      await batch.commit();
    }
  }

  const report: MigrationReport = {
    counts: {
      legacyDocs: legacyDocs.length,
      alreadyMigrated,
      needsAttention: needsAttention.length,
      titleSplits: splitCount,
      afterTitleDedupe: merged.length,
      anilistMatched: matchedCount,
      unmatched: unmatched.length,
      written,
    },
    merges,
    possibleDuplicates,
    unmatched,
    droppedAltTitles,
  };

  downloadJson(`migration-report-${stamp}.json`, report);
  localStorage.removeItem(CACHE_KEY);
  onProgress({ phase: 'done', current: written, total: written, matched: matchedCount, detail: 'Done!' });
  return report;
}
