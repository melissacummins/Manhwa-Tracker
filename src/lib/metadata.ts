import { MediaType } from '../types';

export interface MetadataResult {
  externalId: number;
  source: 'anilist' | 'tmdb';
  title: string;
  alternativeTitles: string[];
  coverUrl: string | null;
  year: number | null;
  suggestedMediaType: MediaType;
}

export class MetadataError extends Error {}

const ANILIST_QUERY = `
query ($search: String, $type: MediaType) {
  Page(perPage: 8) {
    media(search: $search, type: $type) {
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

function anilistTypeFor(mediaType: MediaType): 'MANGA' | 'ANIME' {
  return mediaType === 'anime' ? 'ANIME' : 'MANGA';
}

function comicTypeFromCountry(country: string | null): MediaType {
  if (country === 'KR') return 'manhwa';
  if (country === 'CN' || country === 'TW') return 'manhua';
  if (country === 'JP') return 'manga';
  return 'manhwa';
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Direct first (fast; rate limits land on the user's own IP), then our own
// Vercel relay — AniList's CORS preflight breaks at times, and server-to-
// server calls sidestep it entirely.
export async function anilistRequest(body: unknown, token?: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const payload = JSON.stringify(body);

  let res: Response | null = null;
  const targets = ['https://graphql.anilist.co', '/api/anilist', '/api/anilist'];
  for (let attempt = 0; attempt < targets.length; attempt++) {
    if (attempt > 1) await sleep(2000);
    try {
      res = await fetch(targets[attempt], { method: 'POST', headers, body: payload });
    } catch {
      res = null;
      continue;
    }
    if (res.status !== 429 && res.status < 500) return res;
  }
  if (!res) {
    throw new MetadataError(
      "AniList isn't responding right now — it's usually a brief outage or rate limit on their side. Try again in a few minutes, or add the entry manually."
    );
  }
  return res;
}

async function searchAniList(search: string, mediaType: MediaType): Promise<MetadataResult[]> {
  const res = await anilistRequest({
    query: ANILIST_QUERY,
    variables: { search, type: anilistTypeFor(mediaType) },
  });
  if (!res.ok) throw new MetadataError(`AniList search failed (${res.status}) — try again in a few minutes.`);
  const json = await res.json();
  const media: any[] = json?.data?.Page?.media || [];
  return media
    .filter(m => m.format !== 'NOVEL')
    .map(m => {
      const primary: string = m.title?.english || m.title?.romaji || m.title?.native || '';
      const alts = Array.from(new Set(
        [m.title?.english, m.title?.romaji, m.title?.native, ...(m.synonyms || [])]
          .filter((t): t is string => !!t && t !== primary)
      ));
      return {
        externalId: m.id as number,
        source: 'anilist' as const,
        title: primary,
        alternativeTitles: alts,
        coverUrl: m.coverImage?.large || null,
        year: m.startDate?.year ?? null,
        suggestedMediaType: mediaType === 'anime' ? 'anime' as const : comicTypeFromCountry(m.countryOfOrigin),
      };
    })
    .filter(r => r.title);
}

async function searchTmdb(search: string, mediaType: 'movie' | 'tv'): Promise<MetadataResult[]> {
  const apiKey = import.meta.env.VITE_TMDB_API_KEY;
  if (!apiKey) {
    throw new MetadataError('TMDB API key not configured. Add VITE_TMDB_API_KEY to .env.local (see .env.example).');
  }
  const url = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(search)}`;
  const res = await fetch(url);
  if (!res.ok) throw new MetadataError(`TMDB search failed (${res.status})`);
  const json = await res.json();
  const results: any[] = json?.results || [];
  return results.slice(0, 8).map(r => {
    const title: string = mediaType === 'movie' ? r.title : r.name;
    const original: string = mediaType === 'movie' ? r.original_title : r.original_name;
    const date: string = (mediaType === 'movie' ? r.release_date : r.first_air_date) || '';
    return {
      externalId: r.id as number,
      source: 'tmdb' as const,
      title,
      alternativeTitles: original && original !== title ? [original] : [],
      coverUrl: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
      year: date ? parseInt(date.slice(0, 4), 10) || null : null,
      suggestedMediaType: mediaType,
    };
  }).filter(r => r.title);
}

export async function searchMetadata(search: string, mediaType: MediaType): Promise<MetadataResult[]> {
  if (!search.trim()) return [];
  if (mediaType === 'movie' || mediaType === 'tv') return searchTmdb(search, mediaType);
  return searchAniList(search, mediaType);
}
