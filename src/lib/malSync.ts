// One-way sync: MyAnimeList → library.
//
// Pulls the user's public MAL anime list via /api/mal-list (a Vercel relay,
// since MAL blocks browser requests), then:
//   - adds anime that aren't in the library yet (matched by MAL id first,
//     then by normalized title against titles + alt titles)
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
import { MediaItem, normalizeTitle } from '../types';

// MAL watching statuses → the library's status names
const STATUS_MAP: Record<string, string> = {
  watching: 'Reading',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
  plan_to_watch: 'Plan to Read',
};

interface MalEntry {
  node: {
    id: number;
    title: string;
    main_picture?: { medium?: string; large?: string };
    alternative_titles?: { en?: string; ja?: string; synonyms?: string[] };
    start_season?: { year?: number };
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
}

export async function fetchMalList(username: string): Promise<MalEntry[]> {
  const res = await fetch(`/api/mal-list?username=${encodeURIComponent(username)}`);
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
  const entries = await fetchMalList(username);

  // Match existing entries by MAL id first, then by any known name
  const byMalId = new Map<number, MediaItem>();
  const byName = new Map<string, MediaItem>();
  for (const item of existingItems) {
    if (item.externalIds?.malId) byMalId.set(item.externalIds.malId, item);
    for (const name of [item.title, ...item.alternativeTitles]) {
      const n = normalizeTitle(name);
      if (n && !byName.has(n)) byName.set(n, item);
    }
  }

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

  const result: MalSyncResult = { total: entries.length, added: 0, updated: 0, unchanged: 0 };

  for (const entry of entries) {
    const node = entry.node;
    const status = STATUS_MAP[entry.list_status?.status] || 'Plan to Read';
    const rating = scoreToRating(entry.list_status?.score || 0);

    const names = [
      node.title,
      node.alternative_titles?.en,
      node.alternative_titles?.ja,
      ...(node.alternative_titles?.synonyms || []),
    ].filter((t): t is string => !!t);

    let match = byMalId.get(node.id);
    if (!match) {
      for (const name of names) {
        const m = byName.get(normalizeTitle(name));
        if (m) { match = m; break; }
      }
    }

    if (!match) {
      // New anime from MAL
      const alts = new Map<string, string>();
      for (const a of names.slice(1)) {
        const n = normalizeTitle(a);
        if (n && n !== normalizeTitle(node.title) && !alts.has(n)) alts.set(n, a);
      }
      batch.set(doc(mediaRef), {
        mediaType: 'anime',
        title: node.title,
        alternativeTitles: [...alts.values()].slice(0, 25),
        coverUrl: node.main_picture?.large || node.main_picture?.medium || null,
        status,
        isFavorite: false,
        wouldRevisit: false,
        isExcited: false,
        rating,
        tags: [],
        year: node.start_season?.year ?? null,
        externalIds: { malId: node.id },
        notes: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pending++;
      result.added++;
    } else {
      // Existing entry: update only what MAL owns (status, rating), and fill
      // gaps (missing cover/year/malId). App-owned fields stay untouched.
      const updates: Record<string, unknown> = {};
      if (match.status !== status) updates.status = status;
      if (rating !== null && match.rating !== rating) updates.rating = rating;
      if (!match.externalIds?.malId) updates['externalIds.malId'] = node.id;
      if (!match.coverUrl && (node.main_picture?.large || node.main_picture?.medium)) {
        updates.coverUrl = node.main_picture.large || node.main_picture.medium;
      }
      if (!match.year && node.start_season?.year) updates.year = node.start_season.year;

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
