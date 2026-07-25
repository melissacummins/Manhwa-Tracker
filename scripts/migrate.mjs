#!/usr/bin/env node
/**
 * One-off migration: legacy `manhwas` collection -> `users/{uid}/media`.
 *
 * Usage:
 *   node scripts/migrate.mjs            # dry run (default): reads, enriches, reports — writes NOTHING to Firestore
 *   node scripts/migrate.mjs --execute  # performs the writes after the same pipeline
 *   node scripts/migrate.mjs --help
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS to point at a Firebase
 * service-account key file (Firebase console -> Project settings ->
 * Service accounts -> Generate new private key). Keep that file out of
 * git — the repo's .gitignore covers *service-account*.json.
 *
 * The script never modifies or deletes the legacy collections. It writes
 * backups and reports to backups/ (gitignored). AniList lookups are cached
 * in backups/anilist-cache.json, so an interrupted run resumes cheaply.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const HELP = process.argv.includes('--help') || process.argv.includes('-h');
const EXECUTE = process.argv.includes('--execute');

if (HELP) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''));
  process.exit(0);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account key file path.');
  console.error('Generate one: Firebase console -> Project settings -> Service accounts -> Generate new private key.');
  process.exit(1);
}

// The Firestore database is NAMED (not "(default)") — read the id from the app config.
const appConfig = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const app = initializeApp({ credential: applicationDefault(), projectId: appConfig.projectId });
const db = getFirestore(app, appConfig.firestoreDatabaseId);

const BACKUP_DIR = new URL('../backups/', import.meta.url);
mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

const STATUS_PRECEDENCE = ['Completed', 'Reading', 'On Hold', 'Plan to Read', 'Dropped'];
const ALT_TITLE_CAP = 25;
const ANILIST_INTERVAL_MS = 2500;

function normalizeTitle(s) {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickStatus(a, b) {
  const ia = STATUS_PRECEDENCE.indexOf(a);
  const ib = STATUS_PRECEDENCE.indexOf(b);
  if (ia === -1) return b;
  if (ib === -1) return a;
  return ia <= ib ? a : b;
}

function comicTypeFromCountry(country) {
  if (country === 'KR') return 'manhwa';
  if (country === 'CN' || country === 'TW') return 'manhua';
  if (country === 'JP') return 'manga';
  return 'manhwa';
}

// --- AniList client with cache, rate limit, and 429 backoff ---
const cachePath = new URL('anilist-cache.json', BACKUP_DIR);
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
let lastRequestAt = 0;

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

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function anilistSearch(title) {
  const key = normalizeTitle(title);
  if (key in cache) return cache[key];

  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastRequestAt + ANILIST_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    let res;
    try {
      res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: title } }),
      });
    } catch (err) {
      console.warn(`  network error on "${title}" (attempt ${attempt + 1}): ${err.message}`);
      await sleep(2000 * 2 ** attempt);
      continue;
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      const backoff = Math.max(retryAfter * 1000, 2000 * 2 ** attempt);
      console.warn(`  rate limited; backing off ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) {
      console.warn(`  AniList HTTP ${res.status} on "${title}"`);
      cache[key] = null;
      writeFileSync(cachePath, JSON.stringify(cache));
      return null;
    }

    const json = await res.json();
    const media = (json?.data?.Page?.media || []).filter(m => m.format !== 'NOVEL');
    cache[key] = media;
    writeFileSync(cachePath, JSON.stringify(cache));
    return media;
  }
  return null; // exhausted retries; treated as no match, not cached
}

function findConfidentMatch(candidates, ownTitles) {
  if (!candidates) return null;
  const own = new Set(ownTitles.map(normalizeTitle).filter(Boolean));
  for (const m of candidates) {
    const theirs = [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])]
      .filter(Boolean)
      .map(normalizeTitle);
    if (theirs.some(t => own.has(t))) return m;
  }
  return null;
}

// --- Main pipeline ---
async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (will write to users/{uid}/media)' : 'DRY RUN (no Firestore writes)'}`);

  // 1. Backup
  const rawSnap = await db.collection('manhwas').get();
  const rawDocs = rawSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const settingsSnap = await db.collection('userSettings').get();
  const rawSettings = settingsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const backupFile = new URL(`manhwas-${stamp}.json`, BACKUP_DIR);
  writeFileSync(backupFile, JSON.stringify({ manhwas: rawDocs, userSettings: rawSettings }, (k, v) =>
    v instanceof Timestamp ? v.toDate().toISOString() : v, 2));
  console.log(`1. Backup written: ${backupFile.pathname} (${rawDocs.length} docs)`);
  if (rawDocs.length === 0) {
    console.error('Backup read zero docs — check credentials and database id. Aborting.');
    process.exit(1);
  }

  // 2. Reconcile counts
  const needsAttention = rawDocs.filter(d => !d.title || !d.userId);
  console.log(`2. Reconcile: ${rawDocs.length} total, ${rawDocs.length - needsAttention.length} well-formed, ${needsAttention.length} missing title/userId`);

  const usable = rawDocs.filter(d => d.title && d.userId);

  // 3. Split " / " titles
  let splitCount = 0;
  const items = usable.map(d => {
    const segments = d.title.split(' / ').map(s => s.trim()).filter(Boolean);
    if (segments.length > 1) splitCount++;
    const alts = new Map(); // normalized -> original
    for (const a of [...segments.slice(1), ...(d.alternativeTitles || [])]) {
      const n = normalizeTitle(a);
      if (n && n !== normalizeTitle(segments[0]) && !alts.has(n)) alts.set(n, a);
    }
    return { ...d, title: segments[0], alternativeTitles: [...alts.values()] };
  });
  console.log(`3. Title split: ${splitCount} titles contained " / " separators`);

  // 4. Dedupe by EXACT normalized primary title only.
  //
  // Deliberately NOT matching via legacy alternativeTitles here: those came
  // from the buggy AI fetch and contain corrupted fragments ("대공님", "Dad")
  // plus outright hallucinated aliases, which transitively merge unrelated
  // series (verified against the real data: it falsely merged "I Love Yoo"
  // into a different webtoon). Alt-title overlaps are surfaced as
  // possibleDuplicates in the report instead; same-AniList-id merging
  // happens after enrichment in step 5b, using authoritative data.
  function mergeGroup(group, merges) {
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
      if (other.createdAt && out.createdAt && other.createdAt.toMillis?.() < out.createdAt.toMillis?.()) {
        out.createdAt = other.createdAt;
      }
    }
    merges.push({ kept: out.title, keptId: out.id, mergedIds: rest.map(r => r.id), mergedTitles: rest.map(r => r.title) });
    return out;
  }

  const byPrimary = new Map(); // normalized primary title -> items
  for (const item of items) {
    const n = normalizeTitle(item.title);
    if (!byPrimary.has(n)) byPrimary.set(n, []);
    byPrimary.get(n).push(item);
  }
  const merges = [];
  const merged = [...byPrimary.values()].map(g => mergeGroup(g, merges));
  console.log(`4. Dedupe (exact primary title): ${items.length} -> ${merged.length} items (${merges.length} merges)`);

  // 5. AniList enrichment
  console.log(`5. AniList enrichment: ${merged.length} lookups at 1 per ${ANILIST_INTERVAL_MS / 1000}s (cached lookups are instant)...`);
  const unmatched = [];
  const droppedAltTitles = {};
  let done = 0;
  let matchedCount = 0;
  const enriched = [];
  for (const item of merged) {
    const candidates = await anilistSearch(item.title);
    const match = findConfidentMatch(candidates, [item.title, ...item.alternativeTitles]);
    if (match) {
      matchedCount++;
      const primaryNorm = normalizeTitle(item.title);
      const official = new Map();
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
        mediaType: comicTypeFromCountry(match.countryOfOrigin),
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
    done++;
    if (done % 25 === 0) console.log(`   ...${done}/${merged.length} (${matchedCount} matched)`);
  }
  console.log(`5. Enrichment done: ${matchedCount} matched, ${unmatched.length} unmatched`);

  // 5b. Second dedupe pass: items that confidently resolved to the SAME
  // AniList id are the same series under different titles — safe to merge
  // on authoritative data.
  const byAnilist = new Map();
  const noId = [];
  for (const item of enriched) {
    const aid = item.externalIds?.anilistId;
    if (aid) {
      if (!byAnilist.has(aid)) byAnilist.set(aid, []);
      byAnilist.get(aid).push(item);
    } else {
      noId.push(item);
    }
  }
  const idMerges = [];
  const afterIdMerge = [...[...byAnilist.values()].map(g => mergeGroup(g, idMerges)), ...noId];
  if (idMerges.length) {
    console.log(`5b. Same-AniList-id dedupe: ${enriched.length} -> ${afterIdMerge.length} items (${idMerges.length} merges)`);
  }
  enriched.length = 0;
  enriched.push(...afterIdMerge);

  // 5c. Remaining legacy alt-title overlaps: report only, never auto-merge
  // (legacy alts are untrustworthy — see step 4 comment).
  const nameOwners = new Map();
  const possibleDuplicates = [];
  for (const item of enriched) {
    for (const name of [item.title, ...item.alternativeTitles]) {
      const n = normalizeTitle(name);
      if (!n) continue;
      const owner = nameOwners.get(n);
      if (owner && owner.id !== item.id) {
        possibleDuplicates.push({ sharedName: name, a: owner.title, b: item.title, aId: owner.id, bId: item.id });
      } else {
        nameOwners.set(n, item);
      }
    }
  }
  if (possibleDuplicates.length) {
    console.log(`5c. ${possibleDuplicates.length} possible duplicate pairs flagged for manual review (see report)`);
  }

  // 6. Field mapping
  const finalItems = enriched.map(d => ({
    id: d.id,
    userId: d.userId,
    data: {
      mediaType: d.mediaType,
      title: d.title,
      alternativeTitles: d.alternativeTitles,
      coverUrl: d.coverUrl,
      status: d.status,
      isFavorite: !!d.isFavorite,
      wouldRevisit: !!d.isFavorite,
      rating: null,
      tags: [],
      year: d.year,
      externalIds: d.externalIds,
      notes: d.notes || '',
      createdAt: d.createdAt || Timestamp.now(),
      updatedAt: d.updatedAt || Timestamp.now(),
    },
  }));

  // 7. Write (execute mode only)
  if (EXECUTE) {
    console.log('7. Writing to users/{uid}/media in batches...');
    let written = 0;
    for (let i = 0; i < finalItems.length; i += 450) {
      const batch = db.batch();
      for (const item of finalItems.slice(i, i + 450)) {
        batch.set(db.collection('users').doc(item.userId).collection('media').doc(item.id), item.data);
      }
      await batch.commit();
      written += Math.min(450, finalItems.length - i);
      console.log(`   ...${written}/${finalItems.length}`);
    }
    for (const s of rawSettings) {
      const { userId, id, ...rest } = s;
      await db.collection('users').doc(id).collection('settings').doc('config')
        .set({ statusConfig: rest.statusConfig || {} });
    }
    console.log('7. Writes complete. Legacy collections were NOT modified.');
  } else {
    console.log('7. DRY RUN — skipped all Firestore writes.');
  }

  // 8. Report
  const report = {
    mode: EXECUTE ? 'execute' : 'dry-run',
    timestamp: new Date().toISOString(),
    counts: {
      rawDocs: rawDocs.length,
      needsAttention: needsAttention.length,
      afterTitleDedupe: merged.length,
      anilistMatched: matchedCount,
      afterAnilistIdDedupe: enriched.length,
      unmatched: unmatched.length,
      possibleDuplicates: possibleDuplicates.length,
      written: EXECUTE ? finalItems.length : 0,
    },
    titleSplits: splitCount,
    merges,
    anilistIdMerges: idMerges,
    possibleDuplicates,
    unmatched,
    droppedAltTitles,
    needsAttention: needsAttention.map(d => ({ id: d.id, fields: Object.keys(d) })),
  };
  const reportFile = new URL(`migration-report-${stamp}.json`, BACKUP_DIR);
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`8. Report written: ${reportFile.pathname}`);
  console.log('\nSummary:', JSON.stringify(report.counts, null, 2));
  if (!EXECUTE) console.log('\nReview the report, then rerun with --execute to perform the migration.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
