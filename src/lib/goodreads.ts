// Goodreads library import: parses the CSV that Goodreads' own
// "Export Library" produces (My Books → Import and Export), maps shelves and
// ratings onto our statuses, and enriches each book with a cover and Open
// Library id. Import only ADDS new book entries — it never edits or deletes
// anything — and re-running it is safe: books already in the library are
// skipped, so an interrupted run just resumes.

import { writeBatch, collection, doc, db, serverTimestamp } from '../firebase';
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
  goodreadsId: string;
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
      goodreadsId: get(row, idx.id),
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
// Open Library enrichment (covers + work ids), cached so re-runs are instant
// ---------------------------------------------------------------------------

interface OlMatch { olId: number | null; coverId: number | null; year: number | null }

const OL_CACHE_KEY = 'cc-goodreads-ol-cache';

function loadOlCache(): Record<string, OlMatch> {
  try { return JSON.parse(localStorage.getItem(OL_CACHE_KEY) || '{}'); } catch { return {}; }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function lookupOpenLibrary(book: GoodreadsBook): Promise<OlMatch> {
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
          olId: idMatch ? parseInt(idMatch[1], 10) : null,
          coverId: match.cover_i ?? null,
          year: match.first_publish_year ?? null,
        };
      }
    } catch { /* network hiccup — try the next url or give up gracefully */ }
  }
  return { olId: null, coverId: null, year: null };
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
  const cache = loadOlCache();
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

    const cacheKey = book.goodreadsId || normalizeTitle(book.title);
    let match = cache[cacheKey];
    if (match === undefined) {
      match = await lookupOpenLibrary(book);
      cache[cacheKey] = match;
      try { localStorage.setItem(OL_CACHE_KEY, JSON.stringify(cache)); } catch { /* cache is best-effort */ }
      await sleep(350); // stay polite to Open Library
    }

    if (match.coverId) coversFound++;
    else noCover.push(book.author ? `${book.title} — ${book.author}` : book.title);

    batch.set(doc(mediaRef), {
      mediaType: 'book',
      title: book.title,
      author: book.author,
      alternativeTitles: book.seriesTitle ? [book.seriesTitle] : [],
      coverUrl: match.coverId ? `https://covers.openlibrary.org/b/id/${match.coverId}-L.jpg` : null,
      status: book.status,
      isFavorite: book.isFavorite,
      wouldRevisit: false,
      isExcited: false,
      rating: book.rating,
      tags: [],
      year: book.year ?? match.year,
      externalIds: match.olId ? { openLibraryId: match.olId } : {},
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
      'Open Library had no confident match for these. They imported fine — to add a',
      'cover, open the entry, hit Edit, and run a search.',
      '',
      ...report.noCover.map(t => `- ${t}`),
    );
  }
  const uri = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
  const a = document.createElement('a');
  a.setAttribute('href', uri);
  a.setAttribute('download', `goodreads-import-report-${new Date().toISOString().slice(0, 10)}.md`);
  a.click();
}
