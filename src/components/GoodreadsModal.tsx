import { useRef, useState } from 'react';
import { BookOpen, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { User } from '../firebase';
import { MediaItem } from '../types';
import {
  GoodreadsBook,
  ImportProgress,
  ImportReport,
  downloadImportReport,
  parseGoodreadsCsv,
  runGoodreadsImport,
  splitNewAndSkipped,
} from '../lib/goodreads';

export function GoodreadsModal({
  user,
  existingItems,
  onClose,
}: {
  user: User;
  existingItems: MediaItem[];
  onClose: () => void;
}) {
  const [state, setState] = useState<'intro' | 'preview' | 'running' | 'done' | 'error'>('intro');
  const [books, setBooks] = useState<GoodreadsBook[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseGoodreadsCsv(e.target?.result as string);
        if (parsed.length === 0) throw new Error('No books found in that file.');
        setBooks(parsed);
        setState('preview');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      }
    };
    reader.readAsText(file);
  };

  const start = async () => {
    setState('running');
    cancelled.current = false;
    try {
      const result = await runGoodreadsImport(user.uid, books, existingItems, setProgress, () => cancelled.current);
      if (result) {
        setReport(result);
        if (result.noCover.length > 0) downloadImportReport(result);
        setState('done');
      } else {
        onClose(); // paused — rerunning resumes, already-imported books are skipped
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  };

  const preview = state === 'preview' ? splitNewAndSkipped(books, existingItems) : null;
  const statusCounts = preview
    ? preview.fresh.reduce<Record<string, number>>((acc, b) => {
        acc[b.status] = (acc[b.status] || 0) + 1;
        return acc;
      }, {})
    : null;
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={state === 'running' ? undefined : onClose}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="p-6 border-b border-stone-100 flex justify-between items-center">
          <h2 className="font-serif text-xl font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-500" />
            Import from Goodreads
          </h2>
          {state !== 'running' && (
            <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full">
              <XCircle className="w-6 h-6 text-stone-400" />
            </button>
          )}
        </div>

        {state === 'intro' && (
          <div className="p-6 space-y-4">
            <p className="text-stone-600">
              Bring your whole Goodreads library in — shelves become statuses, star
              ratings and reviews carry over, and covers come from Open Library.
            </p>
            <ol className="text-sm text-stone-500 space-y-2 list-decimal pl-5">
              <li>
                On the Goodreads website, go to <strong>My Books → Import and Export →
                Export Library</strong> and download the CSV (they email a link when it's ready).
              </li>
              <li>Pick that file below. You'll see a summary before anything is saved.</li>
            </ol>
            <ul className="text-sm text-stone-500 space-y-2 list-disc pl-5">
              <li>Import only <strong>adds</strong> books — nothing you already have is changed or deleted.</li>
              <li>Books already in your library are skipped, so it's safe to re-run anytime with a fresh export.</li>
              <li>If you pause or lose connection, just run it again — it picks up where it left off.</li>
            </ul>
            <label className="btn-primary w-full py-3 flex items-center justify-center cursor-pointer">
              Choose Goodreads CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </label>
          </div>
        )}

        {state === 'preview' && preview && statusCounts && (
          <div className="p-6 space-y-4">
            <p className="text-stone-600">
              Found <strong>{books.length}</strong> books in your export.
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-stone-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-stone-800">{preview.fresh.length}</div>
                <div className="text-stone-500">new — will be imported</div>
              </div>
              <div className="bg-stone-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-stone-800">{preview.skipped}</div>
                <div className="text-stone-500">already in your library</div>
              </div>
            </div>
            {preview.fresh.length > 0 && (
              <div className="text-sm text-stone-500 bg-stone-50 rounded-xl p-3">
                {Object.entries(statusCounts).map(([status, n]) => (
                  <div key={status} className="flex justify-between">
                    <span>{status}</span>
                    <span className="font-semibold text-stone-700">{n}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-stone-400">
              Cover lookup takes about a second per book
              {preview.fresh.length > 60 ? ` — roughly ${Math.ceil(preview.fresh.length / 120)} min for your list` : ''}.
              Keep this tab open while it runs.
            </p>
            <button
              onClick={start}
              disabled={preview.fresh.length === 0}
              className="btn-primary w-full py-3 disabled:opacity-50"
            >
              {preview.fresh.length === 0 ? 'Nothing new to import' : `Import ${preview.fresh.length} books`}
            </button>
          </div>
        )}

        {state === 'running' && progress && (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-amber-500 animate-spin flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-stone-800">
                  {progress.phase === 'enriching'
                    ? `Fetching covers (${progress.current} of ${progress.total})`
                    : 'Saving to your library...'}
                </div>
                <div className="text-sm text-stone-400 truncate">{progress.detail}</div>
              </div>
            </div>
            <div className="h-3 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between text-xs text-stone-400">
              <span>{pct}% · {progress.coversFound} covers found</span>
            </div>
            <button
              onClick={() => { cancelled.current = true; }}
              className="btn-secondary w-full py-2 text-sm"
            >
              Pause (safe — resumes where it left off)
            </button>
          </div>
        )}

        {state === 'done' && report && (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3 text-emerald-600">
              <CheckCircle2 className="w-8 h-8" />
              <div className="text-lg font-bold">Import complete!</div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-stone-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-stone-800">{report.imported}</div>
                <div className="text-stone-500">books imported</div>
              </div>
              <div className="bg-stone-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-stone-800">{report.coversFound}</div>
                <div className="text-stone-500">covers found</div>
              </div>
            </div>
            {report.noCover.length > 0 && (
              <p className="text-sm text-gold bg-amber-50 border border-amber-100 rounded-xl p-3">
                {report.noCover.length} books imported without a cover — a report file
                listing them was downloaded. Add covers anytime via Edit → Search.
              </p>
            )}
            <button onClick={onClose} className="btn-primary w-full py-3">
              See My Books
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">{error}</p>
            <p className="text-sm text-stone-500">
              Nothing was harmed — you can safely try again. If this keeps happening, send this message to Claude.
            </p>
            <button onClick={() => { setError(null); setState('intro'); }} className="btn-primary w-full py-3">
              Try Again
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
