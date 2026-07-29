export type MediaType = 'manhwa' | 'manhua' | 'manga' | 'webtoon' | 'anime' | 'movie' | 'tv';

// Comic formats are stored granularly (AniList tells us manhwa vs manga vs
// manhua) but browsed as ONE bucket — the owner never filters them apart.
export const COMIC_TYPES: MediaType[] = ['manhwa', 'manhua', 'manga', 'webtoon'];

export type TypeGroup = 'comics' | 'anime' | 'movie' | 'tv';

export const TYPE_GROUPS: { value: TypeGroup; label: string; defaultType: MediaType }[] = [
  { value: 'comics', label: 'Manhwa', defaultType: 'manhwa' },
  { value: 'anime', label: 'Anime', defaultType: 'anime' },
  { value: 'movie', label: 'Movie', defaultType: 'movie' },
  { value: 'tv', label: 'TV Show', defaultType: 'tv' },
];

export function typeGroupOf(t: MediaType): TypeGroup {
  return COMIC_TYPES.includes(t) ? 'comics' : (t as TypeGroup);
}

export function typeLabel(t: MediaType): string {
  if (COMIC_TYPES.includes(t)) return 'Manhwa';
  if (t === 'anime') return 'Anime';
  if (t === 'movie') return 'Movie';
  return 'TV Show';
}

// Statuses are stored under one set of names ("Reading", "Plan to Read") so
// filters, stats, and sync stay simple — but watchable types display them
// in watching terms.
const WATCH_GROUPS: TypeGroup[] = ['anime', 'movie', 'tv'];

export function displayStatus(status: string, mediaType: MediaType): string {
  if (!WATCH_GROUPS.includes(typeGroupOf(mediaType))) return status;
  if (status === 'Reading') return 'Watching';
  if (status === 'Plan to Read') return 'Plan to Watch';
  return status;
}

export interface MediaItem {
  id: string;
  mediaType: MediaType;
  title: string;
  alternativeTitles: string[];
  coverUrl: string | null;
  status: string;
  isFavorite: boolean;
  wouldRevisit: boolean;
  isExcited?: boolean;   // pinned to the "Most Excited For" shelf
  rating: number | null;
  tags: string[];
  year: number | null;
  externalIds: { anilistId?: number; tmdbId?: number; malId?: number };
  notes: string;
  createdAt: any;
  updatedAt: any;
}

export interface UserConfig {
  statusConfig: Record<string, string>;
  malUsername?: string;
  lastMalSync?: number; // epoch millis of the last successful MAL pull
}

export const DEFAULT_STATUSES = {
  'Reading': '#3b82f6', // Blue
  'Completed': '#10b981', // Emerald
  'On Hold': '#f59e0b', // Amber
  'Dropped': '#ef4444', // Red
  'Plan to Read': '#6366f1', // Indigo
};

// Normalize a title for duplicate comparison: lowercase, Unicode-normalize,
// strip punctuation, collapse whitespace.
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
