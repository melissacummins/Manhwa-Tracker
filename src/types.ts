export type MediaType = 'manhwa' | 'manhua' | 'manga' | 'webtoon' | 'anime' | 'movie' | 'tv';

export const MEDIA_TYPES: { value: MediaType; label: string }[] = [
  { value: 'manhwa', label: 'Manhwa' },
  { value: 'manhua', label: 'Manhua' },
  { value: 'manga', label: 'Manga' },
  { value: 'webtoon', label: 'Webtoon' },
  { value: 'anime', label: 'Anime' },
  { value: 'movie', label: 'Movie' },
  { value: 'tv', label: 'TV Show' },
];

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
