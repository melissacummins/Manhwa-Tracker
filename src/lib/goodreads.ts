// Goodreads library import: parses the CSV that Goodreads' own
// "Export Library" produces (My Books → Import and Export), maps shelves and
// ratings onto our statuses, and enriches each book with a cover. Import only
// ADDS new book entries — it never edits or deletes anything — and re-running
// it is safe: books already in the library are skipped, so an interrupted run
// just resumes.
//
// Covers come from a three-step chain built for a KU/indie-heavy shelf:
//   1. Goodreads itself, by the Book Id in the CSV (via our relay) — the
//      exact cover of the exact edition, works for Amazon-only titles.
//   2. Google Books, strict title+author match.
//   3. Open Library, ISBN first then strict title+author match.
// runCoverFix() re-runs that chain over books ALREADY in the library using
// the same CSV, replacing covers when Goodreads has the exact one and
// filling in missing ones from the catalogs.

import { writeBatch, collection, doc, db, serverTimestamp } from '../firebase';
import { cleanGoogleCover } from './metadata';
import { MediaItem, normalizeTitle, typeGroupOf } from '../types';

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180: quoted fields may contain commas, quotes, newlines —
// Goodreads reviews regularly do all three)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

export interface GoodreadsBook {
  goodreadsId: number | null;
  title: string;
  seriesTitle: string | null; // the full "Title (Series, #1)" form, if any
  author: string | null;
  isbn: string | null;        // ISBN13 preferred
  rating: number | null;
  status: string;
  isFavorite: boolean;
  year: number | null;
  notes: string;
}

const SHELF_STATUS: Record<string, string> = {
  'read': 'Completed',
  'currently-reading': 'Reading',
  'to-read': 'Plan to Read',
};

function statusForShelf(shelf: string): string {
  if (SHELF_STATUS[shelf]) return SHELF_STATUS[shelf];
  // Custom exclusive shelves: treat obvious "gave up" names as Dropped
  if (/dnf|abandon|drop/i.test(shelf)) return 'Dropped';
  return 'Plan to Read';
}

// Goodreads wraps ISBNs in an Excel guard: ="0439023483" (or ="" when empty)
function cleanIsbn(raw: string): string | null {
  const digits = (raw || '').replace(/[^0-9Xx]/g, '');
  return digits.length >= 10 ? digits : null;
}

export function parseGoodreadsCsv(text: string): GoodreadsBook[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    id: col('Book Id'),
    title: col('Title'),
    author: col('Author'),
    isbn: col('ISBN'),
    isbn13: col('ISBN13'),
    rating: col('My Rating'),
    yearOrig: col('Original Publication Year'),
    yearPub: col('Year Published'),
    shelf: col('Exclusive Shelf'),
    shelves: col('Bookshelves'),
    review: col('My Review'),
    privateNotes: col('Private Notes'),
  };
  if (idx.title < 0 || idx.shelf < 0) {
    throw new Error("This doesn't look like a Goodreads export — the Title / Exclusive Shelf columns are missing.");
  }

  const get = (row: string[], i: number) => (i >= 0 && row[i] ? row[i].trim() : '');
  const seen = new Set<string>();
  const books: GoodreadsBook[] = [];

  for (const row of rows.slice(1)) {
    const rawTitle = get(row, idx.title);
    if (!rawTitle) continue;

    // "The Fine Print (Dreamland Billionaires, #1)" — keep the clean title
    // as primary and the series form as an alternative name
    const seriesMatch = /^(.*?)\s*\(([^()]*#[\d.]+[^()]*)\)\s*$/.exec(rawTitle);
    const title = seriesMatch ? seriesMatch[1].trim() : rawTitle;
    const key = get(row, idx.id) || normalizeTitle(title);
    if (seen.has(key)) continue;
    seen.add(key);

    const shelves = get(row, idx.shelves).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const rating = parseInt(get(row, idx.rating), 10) || 0;
    const year = parseInt(get(row, idx.yearOrig), 10) || parseInt(get(row, idx.yearPub), 10) || null;
    const notes = [get(row, idx.review), get(row, idx.privateNotes)]
      .filter(Boolean).join('\n\n').slice(0, 5000);

    books.push({
      goodreadsId: parseInt(get(row, idx.id), 10) || null,
      title,
      seriesTitle: seriesMatch ? rawTitle : null,
      author: get(row, idx.author) || null,
      isbn: cleanIsbn(get(row, idx.isbn13)) || cleanIsbn(get(row, idx.isbn)),
      rating: rating >= 1 && rating <= 5 ? rating : null,
      status: statusForShelf(get(row, idx.shelf).toLowerCase()),
      isFavorite: shelves.some(s => s === 'favorites' || s === 'favourites'),
      year,
      notes,
    });
  }
  return books;
}

// ---------------------------------------------------------------------------
// Cover enrichment: Goodreads (exact) → Google Books → Open Library.
// Cached locally so re-runs and the cover-fix pass are cheap.
// ---------------------------------------------------------------------------

export interface CoverMatch {
  coverUrl: string | null;
  source: 'goodreads' | 'googlebooks' | 'openlibrary' | null;
  googleBooksId: string | null;
  olId: number | null;
  year: number | null;
}

const NO_MATCH: CoverMatch = { coverUrl: null, source: null, googleBooksId: null, olId: null, year: null };

// v2: the v1 cache held Open-Library-only lookups, including its bad matches
const COVER_CACHE_KEY = 'cc-goodreads-cover-cache-v2';

function loadCoverCache(): Record<string, CoverMatch> {
  try {
    const raw: Record<string, CoverMatch> = JSON.parse(localStorage.getItem(COVER_CACHE_KEY) || '{}');
    // Keep hits only. Earlier builds cached misses too, which made re-running
    // the fix pass useless for anything that failed once (e.g. during a
    // Goodreads rate-limit stretch) — misses must always be retried.
    const hits: Record<string, CoverMatch> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v?.coverUrl) hits[k] = v;
    }
    return hits;
  } catch { return {}; }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Loose author check: full-string or family-name match, permissive when
// either side is missing (title match still required)
function authorsMatch(a: string | null, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  const norm = (s: string) => normalizeTitle(s);
  const last = (s: string) => norm(s).split(' ').pop() || '';
  return norm(a) === norm(b) || (last(a) !== '' && last(a) === last(b));
}

// Goodreads rate-limits bursts by serving bot-check pages (the relay reports
// those as 429), so back off and retry a couple of times before giving up.
// Misses are never cached, so anything that still fails here is retried the
// next time the import or fix pass runs.
async function lookupGoodreadsCover(goodreadsId: number): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`/api/goodreads-cover?id=${goodreadsId}`);
      if (res.ok) {
        const json = await res.json();
        return json.coverUrl || null;
      }
      if (res.status !== 429) return null; // genuinely no cover — don't hammer
    } catch { /* network hiccup — treat like a rate limit and retry */ }
    await sleep(4000 * (attempt + 1));
  }
  return null;
}

async function lookupGoogleBooks(book: GoodreadsBook): Promise<CoverMatch | null> {
  const q = `intitle:"${book.title}"` + (book.author ? ` inauthor:"${book.author}"` : '');
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5&printType=books`);
    if (!res.ok) return null;
    const json = await res.json();
    const volumes: any[] = json?.items || [];
    const match = volumes.find(v =>
      normalizeTitle(v.volumeInfo?.title || '') === normalizeTitle(book.title) &&
      authorsMatch(book.author, v.volumeInfo?.authors?.[0])
    );
    if (!match) return null;
    return {
      coverUrl: cleanGoogleCover(match.volumeInfo?.imageLinks?.thumbnail),
      source: 'googlebooks',
      googleBooksId: match.id,
      olId: null,
      year: match.volumeInfo?.publishedDate ? parseInt(match.volumeInfo.publishedDate.slice(0, 4), 10) || null : null,
    };
  } catch { return null; }
}

async function lookupOpenLibrary(book: GoodreadsBook): Promise<CoverMatch | null> {
  const fields = 'key,title,cover_i,first_publish_year';
  const urls: string[] = [];
  if (book.isbn) {
    urls.push(`https://openlibrary.org/search.json?q=${encodeURIComponent('isbn:' + book.isbn)}&fields=${fields}&limit=1`);
  }
  urls.push(
    `https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}` +
    (book.author ? `&author=${encodeURIComponent(book.author)}` : '') +
    `&fields=${fields}&limit=3`
  );

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const docs: any[] = json?.docs || [];
      // ISBN lookups are exact; title lookups must match the title strictly
      const isIsbnLookup = url.includes('isbn%3A');
      const match = docs.find(d =>
        d.key && (isIsbnLookup || normalizeTitle(d.title || '') === normalizeTitle(book.title))
      );
      if (match) {
        const idMatch = /OL(\d+)W/.exec(match.key);
        return {
          coverUrl: match.cover_i ? `https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg` : null,
          source: 'openlibrary',
          googleBooksId: null,
          olId: idMatch ? parseInt(idMatch[1], 10) : null,
          year: match.first_publish_year ?? null,
        };
      }
    } catch { /* network hiccup — try the next url or give up gracefully */ }
  }
  return null;
}

async function findCover(book: GoodreadsBook): Promise<CoverMatch> {
  if (book.goodreadsId) {
    const grCover = await lookupGoodreadsCover(book.goodreadsId);
    if (grCover) return { coverUrl: grCover, source: 'goodreads', googleBooksId: null, olId: null, year: null };
  }
  const gb = await lookupGoogleBooks(book);
  if (gb?.coverUrl) return gb;
  const ol = await lookupOpenLibrary(book);
  if (ol?.coverUrl) return ol;
  // No cover anywhere — keep whichever catalog id/year we did find
  return gb || ol || NO_MATCH;
}

async function findCoverCached(
  book: GoodreadsBook,
  cache: Record<string, CoverMatch>,
): Promise<CoverMatch> {
  const key = book.goodreadsId ? String(book.goodreadsId) : normalizeTitle(book.title);
  let match = cache[key];
  if (match === undefined) {
    match = await findCover(book);
    if (match.coverUrl) {
      // Cache hits only — a miss may just be a rate limit and must be
      // retried on the next run
      cache[key] = match;
      try { localStorage.setItem(COVER_CACHE_KEY, JSON.stringify(cache)); } catch { /* cache is best-effort */ }
    }
    await sleep(350); // stay polite to everyone we're asking
  }
  return match;
}

function externalIdsFor(book: GoodreadsBook, match: CoverMatch): MediaItem['externalIds'] {
  const ids: MediaItem['externalIds'] = {};
  if (book.goodreadsId) ids.goodreadsId = book.goodreadsId;
  if (match.googleBooksId) ids.googleBooksId = match.googleBooksId;
  if (match.olId) ids.openLibraryId = match.olId;
  return ids;
}

// ---------------------------------------------------------------------------
// The import itself
// ---------------------------------------------------------------------------

export interface ImportProgress {
  phase: 'enriching' | 'writing';
  current: number;
  total: number;
  coversFound: number;
  detail: string;
}

export interface ImportReport {
  imported: number;
  skipped: number;       // already in the library
  coversFound: number;
  noCover: string[];     // imported without a cover — titles, for the report file
}

export function splitNewAndSkipped(books: GoodreadsBook[], existingItems: MediaItem[]) {
  const existingNames = new Set<string>();
  for (const m of existingItems) {
    if (typeGroupOf(m.mediaType) !== 'books') continue;
    existingNames.add(normalizeTitle(m.title));
    m.alternativeTitles.forEach(a => existingNames.add(normalizeTitle(a)));
  }
  const fresh: GoodreadsBook[] = [];
  let skipped = 0;
  for (const b of books) {
    const names = [b.title, b.seriesTitle].filter((t): t is string => !!t).map(normalizeTitle);
    if (names.some(n => existingNames.has(n))) skipped++;
    else fresh.push(b);
  }
  return { fresh, skipped };
}

export async function runGoodreadsImport(
  uid: string,
  books: GoodreadsBook[],
  existingItems: MediaItem[],
  onProgress: (p: ImportProgress) => void,
  isCancelled: () => boolean,
): Promise<ImportReport | null> {
  const { fresh, skipped } = splitNewAndSkipped(books, existingItems);
  const cache = loadCoverCache();
  const mediaRef = collection(db, 'users', uid, 'media');

  let imported = 0;
  let coversFound = 0;
  const noCover: string[] = [];
  let batch = writeBatch(db);
  let batchCount = 0;

  for (let i = 0; i < fresh.length; i++) {
    if (isCancelled()) {
      // Commit what we have — those books exist now and will be skipped on rerun
      if (batchCount > 0) await batch.commit();
      return null;
    }
    const book = fresh[i];
    onProgress({ phase: 'enriching', current: i + 1, total: fresh.length, coversFound, detail: book.title });

    const match = await findCoverCached(book, cache);
    if (match.coverUrl) coversFound++;
    else noCover.push(book.author ? `${book.title} — ${book.author}` : book.title);

    batch.set(doc(mediaRef), {
      mediaType: 'book',
      title: book.title,
      author: book.author,
      alternativeTitles: book.seriesTitle ? [book.seriesTitle] : [],
      coverUrl: match.coverUrl,
      status: book.status,
      isFavorite: book.isFavorite,
      wouldRevisit: false,
      isExcited: false,
      rating: book.rating,
      tags: [],
      year: book.year ?? match.year,
      externalIds: externalIdsFor(book, match),
      notes: book.notes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    imported++;
    batchCount++;
    if (batchCount >= 100) {
      onProgress({ phase: 'writing', current: i + 1, total: fresh.length, coversFound, detail: 'Saving to your library...' });
      await batch.commit();
      batch = writeBatch(db);
      batchCount = 0;
    }
  }
  if (batchCount > 0) {
    onProgress({ phase: 'writing', current: fresh.length, total: fresh.length, coversFound, detail: 'Saving to your library...' });
    await batch.commit();
  }

  return { imported, skipped, coversFound, noCover };
}

// ---------------------------------------------------------------------------
// Cover fix-up: repair books ALREADY in the library using the same CSV.
// Replaces the cover when Goodreads has the exact one (safe — it's the very
// edition that was logged); otherwise only fills covers that are missing.
// Never touches titles, statuses, ratings, notes, or anything else.
// ---------------------------------------------------------------------------

export interface CoverFixReport {
  replaced: number;      // wrong-or-not covers swapped for the exact Goodreads one
  filled: number;        // was missing, now has a catalog cover
  unchanged: number;
  stillNoCover: string[];
}

export function matchRowsToLibrary(books: GoodreadsBook[], existingItems: MediaItem[]) {
  const byName = new Map<string, MediaItem>();
  for (const m of existingItems) {
    if (typeGroupOf(m.mediaType) !== 'books') continue;
    byName.set(normalizeTitle(m.title), m);
    m.alternativeTitles.forEach(a => byName.set(normalizeTitle(a), m));
  }
  const targets: { book: GoodreadsBook; item: MediaItem }[] = [];
  const matchedItemIds = new Set<string>();
  for (const b of books) {
    const names = [b.title, b.seriesTitle].filter((t): t is string => !!t).map(normalizeTitle);
    const item = names.map(n => byName.get(n)).find(Boolean);
    if (item && !matchedItemIds.has(item.id)) {
      matchedItemIds.add(item.id);
      targets.push({ book: b, item });
    }
  }
  return targets;
}

export async function runCoverFix(
  uid: string,
  books: GoodreadsBook[],
  existingItems: MediaItem[],
  onProgress: (p: ImportProgress) => void,
  isCancelled: () => boolean,
): Promise<CoverFixReport | null> {
  const targets = matchRowsToLibrary(books, existingItems);
  const cache = loadCoverCache();

  let replaced = 0;
  let filled = 0;
  let unchanged = 0;
  const stillNoCover: string[] = [];
  let batch = writeBatch(db);
  let batchCount = 0;

  for (let i = 0; i < targets.length; i++) {
    if (isCancelled()) {
      if (batchCount > 0) await batch.commit();
      return null;
    }
    const { book, item } = targets[i];
    onProgress({ phase: 'enriching', current: i + 1, total: targets.length, coversFound: replaced + filled, detail: book.title });

    const match = await findCoverCached(book, cache);

    // Deliberately narrow update: cover + external ids only, and no
    // updatedAt bump — a cover repair isn't reading activity
    const update: Record<string, unknown> = {};
    if (match.coverUrl && match.source === 'goodreads' && item.coverUrl !== match.coverUrl) {
      update.coverUrl = match.coverUrl;
      replaced++;
    } else if (match.coverUrl && !item.coverUrl) {
      update.coverUrl = match.coverUrl;
      filled++;
    } else {
      unchanged++;
      if (!item.coverUrl && !match.coverUrl) {
        stillNoCover.push(book.author ? `${book.title} — ${book.author}` : book.title);
      }
    }
    if (book.goodreadsId && !item.externalIds?.goodreadsId) {
      update['externalIds.goodreadsId'] = book.goodreadsId;
    }

    if (Object.keys(update).length > 0) {
      batch.update(doc(db, 'users', uid, 'media', item.id), update);
      batchCount++;
      if (batchCount >= 100) {
        onProgress({ phase: 'writing', current: i + 1, total: targets.length, coversFound: replaced + filled, detail: 'Saving...' });
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
  }
  if (batchCount > 0) {
    onProgress({ phase: 'writing', current: targets.length, total: targets.length, coversFound: replaced + filled, detail: 'Saving...' });
    await batch.commit();
  }

  return { replaced, filled, unchanged, stillNoCover };
}

// ---------------------------------------------------------------------------
// Report files
// ---------------------------------------------------------------------------

function downloadMarkdown(lines: string[], name: string) {
  const uri = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
  const a = document.createElement('a');
  a.setAttribute('href', uri);
  a.setAttribute('download', `${name}-${new Date().toISOString().slice(0, 10)}.md`);
  a.click();
}

export function downloadImportReport(report: ImportReport) {
  const lines = [
    '# Goodreads Import Report',
    '',
    `- Imported: ${report.imported} books`,
    `- Skipped (already in your library): ${report.skipped}`,
    `- Covers found: ${report.coversFound}`,
    '',
  ];
  if (report.noCover.length > 0) {
    lines.push(
      `## Imported without a cover (${report.noCover.length})`,
      '',
      'None of the sources had a confident match. They imported fine — to add a',
      'cover, open the entry, hit Edit, and run a search.',
      '',
      ...report.noCover.map(t => `- ${t}`),
    );
  }
  downloadMarkdown(lines, 'goodreads-import-report');
}

export function downloadCoverFixReport(report: CoverFixReport) {
  const lines = [
    '# Cover Fix Report',
    '',
    `- Replaced with the exact Goodreads cover: ${report.replaced}`,
    `- Missing covers filled from catalogs: ${report.filled}`,
    `- Left as-is: ${report.unchanged}`,
    '',
  ];
  if (report.stillNoCover.length > 0) {
    lines.push(
      `## Still missing a cover (${report.stillNoCover.length})`,
      '',
      ...report.stillNoCover.map(t => `- ${t}`),
    );
  }
  downloadMarkdown(lines, 'cover-fix-report');
}
