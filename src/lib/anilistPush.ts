// One-way push: library → the user's AniList account.
//
// Uses AniList's implicit-grant OAuth (pure browser, no server, no secret):
// the user authorizes once, the token lands in the URL hash, and we keep it
// in localStorage (AniList tokens last ~1 year). Pushing sends status and
// score for every entry that has (or can resolve) an AniList id. Entries are
// skipped when they haven't changed since the last successful push.

import { MediaItem } from '../types';

const TOKEN_KEY = 'cc-anilist-token';
const PUSHED_KEY = 'cc-anilist-pushed'; // itemId -> updatedAt millis at last push

const STATUS_MAP: Record<string, string> = {
  'Reading': 'CURRENT',
  'Completed': 'COMPLETED',
  'On Hold': 'PAUSED',
  'Dropped': 'DROPPED',
  'Plan to Read': 'PLANNING',
};

export function anilistAuthUrl(): string | null {
  const clientId = import.meta.env.VITE_ANILIST_CLIENT_ID;
  if (!clientId) return null;
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearStoredToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Call on app load: captures the token AniList appends to the URL hash
// after authorization, stores it, and cleans the URL.
export function captureTokenFromHash(): boolean {
  const match = window.location.hash.match(/access_token=([^&]+)/);
  if (!match) return false;
  localStorage.setItem(TOKEN_KEY, match[1]);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return true;
}

export interface PushProgress {
  current: number;
  total: number;
  pushed: number;
  skipped: number;
  failed: number;
  detail: string;
}

export interface PushResult {
  pushed: number;
  skipped: number;
  failed: number;
  failures: string[];
  tokenExpired: boolean;
}

function loadPushed(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PUSHED_KEY) || '{}');
  } catch {
    return {};
  }
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

let lastRequestAt = 0;

async function anilistGraphQL(token: string, query: string, variables: Record<string, unknown>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastRequestAt + 2500 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      await sleep(Math.max(retryAfter * 1000, 2000 * 2 ** attempt));
      continue;
    }
    if (res.status === 401) {
      throw new Error('TOKEN_EXPIRED');
    }
    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(json.errors[0].message || 'AniList error');
    }
    return json.data;
  }
  throw new Error('AniList rate limit would not clear — try again later.');
}

export async function pushToAniList(
  items: MediaItem[],
  onProgress: (p: PushProgress) => void,
  isCancelled: () => boolean,
): Promise<PushResult | null> {
  const token = getStoredToken();
  if (!token) throw new Error('Not connected to AniList yet.');

  const pushedMap = loadPushed();
  const savePushed = () => {
    try { localStorage.setItem(PUSHED_KEY, JSON.stringify(pushedMap)); } catch { /* non-fatal */ }
  };

  // Everything with an AniList id, or an anime with a MAL id we can resolve
  const eligible = items.filter(m =>
    STATUS_MAP[m.status] &&
    (m.externalIds?.anilistId || (m.mediaType === 'anime' && m.externalIds?.malId))
  );

  const result: PushResult = { pushed: 0, skipped: 0, failed: 0, failures: [], tokenExpired: false };

  for (let i = 0; i < eligible.length; i++) {
    if (isCancelled()) { savePushed(); return null; }
    const item = eligible[i];
    const changedAt = item.updatedAt?.toMillis?.() ?? 0;

    if (pushedMap[item.id] && pushedMap[item.id] >= changedAt) {
      result.skipped++;
      continue;
    }

    onProgress({
      current: i + 1,
      total: eligible.length,
      pushed: result.pushed,
      skipped: result.skipped,
      failed: result.failed,
      detail: item.title,
    });

    try {
      let mediaId = item.externalIds?.anilistId;
      if (!mediaId && item.externalIds?.malId) {
        const data = await anilistGraphQL(token,
          `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id } }`,
          { idMal: item.externalIds.malId });
        mediaId = data?.Media?.id;
      }
      if (!mediaId) {
        result.failed++;
        result.failures.push(`${item.title} — no AniList match`);
        continue;
      }

      const variables: Record<string, unknown> = {
        mediaId,
        status: STATUS_MAP[item.status],
      };
      if (item.rating != null) variables.score = item.rating * 2; // 1–5 stars -> 10-point

      await anilistGraphQL(token,
        `mutation ($mediaId: Int, $status: MediaListStatus, $score: Float) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score) { id }
        }`,
        variables);

      pushedMap[item.id] = changedAt || Date.now();
      result.pushed++;
      if (result.pushed % 20 === 0) savePushed();
    } catch (err) {
      if (err instanceof Error && err.message === 'TOKEN_EXPIRED') {
        clearStoredToken();
        result.tokenExpired = true;
        savePushed();
        return result;
      }
      result.failed++;
      result.failures.push(`${item.title} — ${err instanceof Error ? err.message : 'failed'}`);
    }
  }

  savePushed();
  return result;
}
