// One-way sync: MyAnimeList → library. Pulls BOTH lists:
//   - the anime list (auto-tracked by watch apps)
//   - the manga list (auto-tracked by Mihon)
//
// via /api/mal-list (a Vercel relay, since MAL blocks browser requests), then:
//   - adds entries that aren't in the library yet (matched by MAL id first,
//     then by normalized title against titles + alt titles — always within
//     the same kind, since MAL anime ids and manga ids are separate spaces)
//   - updates status/rating on entries whose MAL side changed
//   - NEVER touches app-owned fields: favorites, tags, notes, wouldRevisit,
//     isExcited, and never deletes anything.

import {
  collection,
  db,
  doc,
  serverTimestamp,
  writeBatch,
} from '../firebase';
import { COMIC_TYPES, MediaItem, MediaType, normalizeTitle, typeGroupOf } from '../types';

// MAL statuses (anime and manga variants) → the library's status names
const STATUS_MAP: Record<string, string> = {
  watching: 'Reading',
  reading: 'Reading',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
  plan_to_watch: 'Plan to Read',
  plan_to_read: 'Plan to Read',
};

// MAL manga media_type → library mediaType (novels are skipped entirely)
const MANGA_TYPE_MAP: Record<string, MediaType> = {
  manhwa: 'manhwa',
  manhua: 'manhua',
  manga: 'manga',
  one_shot: 'manga',
  doujinshi: 'manga',
  oel: 'webtoon',
};

interface MalEntry {
  node: {
    id: number;
    title: string;
    main_picture?: { medium?: string; large?: string };
    alternative_titles?: { en?: string; ja?: string; synonyms?: string[] };
    start_season?: { year?: number };
    start_date?: string;
    media_type?: string;
  };
  list_status: {
    status: string;
    score: number;
    updated_at?: string;
  };
}

export interface MalSyncResult {
  total: number;
  added: number;
  updated: number;
  unchanged: number;
  skippedNovels: number;
}

async function fetchMalList(username: string, list: 'anime' | 'manga'): Promise<MalEntry[]> {
  const res = await fetch(`/api/mal-list?username=${encodeURIComponent(username)}&list=${list}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Sync failed (${res.status})`);
  }
  return json.data || [];
}

function scoreToRating(score: number): number | null {
  if (!score || score < 1) return null;
  return Math.max(1, Math.min(5, Math.ceil(score / 2)));
}

export async function syncFromMal(
  uid: string,
  username: string,
  existingItems: MediaItem[],
): Promise<MalSyncResult> {
  const [animeEntries, mangaEntries] = await Promise.all([
    fetchMalList(username, 'anime'),
    fetchMalList(username, 'manga'),
  ]);

  // MAL anime ids and manga ids are separate number spaces — match each kind
  // only against library entries of the matching kind.
  const buildMaps = (kindItems: MediaItem[]) => {
    const byMalId = new Map<number, MediaItem>();
    const byName = new Map<string, MediaItem>();
    for (const item of kindItems) {
      if (item.externalIds?.malId) byMalId.set(item.externalIds.malId, item);
      for (const name of [item.title, ...item.alternativeTitles]) {
        const n = normalizeTitle(name);
        if (n && !byName.has(n)) byName.set(n, item);
      }
    }
    return { byMalId, byName };
  };
  const animeMaps = buildMaps(existingItems.filter(m => m.mediaType === 'anime'));
  const comicMaps = buildMaps(existingItems.filter(m => typeGroupOf(m.mediaType) === 'comics'));

  const mediaRef = collection(db, 'users', uid, 'media');
  let batch = writeBatch(db);
  let pending = 0;
  const flush = async () => {
    if (pending > 0) {
      await batch.commit();
      batch = writeBatch(db);
      pending = 0;
    }
  };

  const result: MalSyncResult = { total: 0, added: 0, updated: 0, unchanged: 0, skippedNovels: 0 };

  const processEntries = async (
    entries: MalEntry[],
    kind: 'anime' | 'manga',
    maps: { byMalId: Map<number, MediaItem>; byName: Map<string, MediaItem> },
  ) => {
    for (const entry of entries) {
      const node = entry.node;

      // Light novels etc. live on MAL's manga list but not in this library
      if (kind === 'manga' && node.media_type && !(node.media_type in MANGA_TYPE_MAP)) {
        result.skippedNovels++;
        continue;
      }
      result.total++;

      const status = STATUS_MAP[entry.list_status?.status] || 'Plan to Read';
      const rating = scoreToRating(entry.list_status?.score || 0);
      const year = kind === 'anime'
        ? node.start_season?.year ?? null
        : (node.start_date ? parseInt(node.start_date.slice(0, 4), 10) || null : null);
      const newType: MediaType = kind === 'anime'
        ? 'anime'
        : MANGA_TYPE_MAP[node.media_type || 'manga'] || 'manga';

      const names = [
        node.title,
        node.alternative_titles?.en,
        node.alternative_titles?.ja,
        ...(node.alternative_titles?.synonyms || []),
      ].filter((t): t is string => !!t);

      let match = maps.byMalId.get(node.id);
      if (!match) {
        for (const name of names) {
          const m = maps.byName.get(normalizeTitle(name));
          if (m) { match = m; break; }
        }
      }

      if (!match) {
        const alts = new Map<string, string>();
        for (const a of names.slice(1)) {
          const n = normalizeTitle(a);
          if (n && n !== normalizeTitle(node.title) && !alts.has(n)) alts.set(n, a);
        }
        batch.set(doc(mediaRef), {
          mediaType: newType,
          title: node.title,
          alternativeTitles: [...alts.values()].slice(0, 25),
          coverUrl: node.main_picture?.large || node.main_picture?.medium || null,
          status,
          isFavorite: false,
          wouldRevisit: false,
          isExcited: false,
          rating,
          tags: [],
          year,
          externalIds: { malId: node.id },
          notes: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        pending++;
        result.added++;
      } else {
        // Existing entry: update only what MAL owns (status, rating), and
        // fill gaps. App-owned fields stay untouched.
        const updates: Record<string, unknown> = {};
        if (match.status !== status) updates.status = status;
        if (rating !== null && match.rating !== rating) updates.rating = rating;
        if (!match.externalIds?.malId) updates['externalIds.malId'] = node.id;
        if (!match.coverUrl && (node.main_picture?.large || node.main_picture?.medium)) {
          updates.coverUrl = node.main_picture.large || node.main_picture.medium;
        }
        if (!match.year && year) updates.year = year;

        if (Object.keys(updates).length > 0) {
          updates.updatedAt = serverTimestamp();
          batch.update(doc(mediaRef, match.id), updates);
          pending++;
          result.updated++;
        } else {
          result.unchanged++;
        }
      }

      if (pending >= 400) await flush();
    }
  };

  await processEntries(animeEntries, 'anime', animeMaps);
  await processEntries(mangaEntries, 'manga', comicMaps);
  await flush();

  // Remember the sync time so the app can auto-refresh daily
  const settingsBatch = writeBatch(db);
  settingsBatch.set(
    doc(db, 'users', uid, 'settings', 'config'),
    { malUsername: username, lastMalSync: Date.now() },
    { merge: true },
  );
  await settingsBatch.commit();

  return result;
}

// Re-export for callers that only need comic detection
export { COMIC_TYPES };
