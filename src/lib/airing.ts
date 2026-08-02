// Freshness info for in-progress titles: latest/next episode for anime,
// releasing/finished status for manga. One batched AniList query per 50 ids,
// cached in sessionStorage for 6 hours; fails silently (the Continue page
// just shows no info line) when AniList is unreachable.

import { MediaItem } from '../types';
import { anilistRequest } from './metadata';

export interface AiringInfo {
  status?: string;               // RELEASING | FINISHED | ...
  episodes?: number | null;
  chapters?: number | null;
  nextEpisode?: number | null;
  nextAiringAt?: number | null;  // epoch seconds
}

const CACHE_KEY = 'cc-airing-cache';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const QUERY = `
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids) {
      id
      status
      episodes
      chapters
      nextAiringEpisode { episode airingAt }
    }
  }
}`;

export async function fetchAiringInfo(items: MediaItem[]): Promise<Record<number, AiringInfo>> {
  const ids = Array.from(new Set(
    items.map(m => m.externalIds?.anilistId).filter((id): id is number => !!id)
  ));
  if (ids.length === 0) return {};

  // Serve from cache when fresh and covering the same ids
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < CACHE_TTL_MS && ids.every(id => id in cached.data)) {
      return cached.data;
    }
  } catch { /* rebuild below */ }

  const result: Record<number, AiringInfo> = {};
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const res = await anilistRequest({ query: QUERY, variables: { ids: ids.slice(i, i + 50) } });
      if (!res.ok) return result;
      const json = await res.json();
      for (const m of json?.data?.Page?.media || []) {
        result[m.id] = {
          status: m.status,
          episodes: m.episodes ?? null,
          chapters: m.chapters ?? null,
          nextEpisode: m.nextAiringEpisode?.episode ?? null,
          nextAiringAt: m.nextAiringEpisode?.airingAt ?? null,
        };
      }
    }
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: result }));
    } catch { /* cache is best-effort */ }
  } catch { /* AniList unreachable — no info lines this visit */ }
  return result;
}

// One-line freshness label, or null when there's nothing useful to say
export function airingLabel(item: MediaItem, info?: AiringInfo): string | null {
  if (!info) return null;
  const isAnime = item.mediaType === 'anime';

  if (isAnime) {
    if (info.nextEpisode && info.nextAiringAt) {
      const out = info.nextEpisode - 1;
      const secs = info.nextAiringAt - Math.floor(Date.now() / 1000);
      const days = Math.ceil(secs / 86400);
      const when = secs <= 0 ? 'soon' : days <= 1 ? 'tomorrow' : `in ${days}d`;
      return out > 0 ? `Ep ${out} out · Ep ${info.nextEpisode} ${when}` : `Ep 1 ${when}`;
    }
    if (info.status === 'FINISHED' && info.episodes) return `${info.episodes} eps · complete`;
    if (info.status === 'RELEASING') return 'airing';
    return null;
  }

  if (info.status === 'FINISHED') return info.chapters ? `complete · ${info.chapters} ch` : 'complete';
  if (info.status === 'RELEASING') return 'ongoing';
  if (info.status === 'HIATUS') return 'on hiatus';
  return null;
}
