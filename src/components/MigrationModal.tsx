import { useRef, useState } from 'react';
import { CheckCircle2, Database, RefreshCw, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { User } from '../firebase';
import { MigrationProgress, MigrationReport, runMigration } from '../lib/migration';

export function MigrationModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [state, setState] = useState<'intro' | 'running' | 'done' | 'error'>('intro');
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [report, setReport] = useState<MigrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const start = async () => {
    setState('running');
    cancelled.current = false;
    try {
      const result = await runMigration(user.uid, setProgress, () => cancelled.current);
      if (result) {
        setReport(result);
        setState('done');
      } else {
        onClose(); // cancelled — safe to just rerun later, it resumes
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  };

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
            <Database className="w-5 h-5 text-amber-500" />
            Migrate Legacy Data
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
              This copies your old manhwa list into the new Command Center, cleans up the
              broken alternative names, and fetches official titles and cover art from AniList.
            </p>
            <ul className="text-sm text-stone-500 space-y-2 list-disc pl-5">
              <li>Your old data is <strong>never changed or deleted</strong> — this only makes an upgraded copy.</li>
              <li>A backup file downloads automatically before anything starts.</li>
              <li>It takes roughly <strong>an hour</strong> (AniList limits how fast we can ask). Keep this tab open; your screen can lock but the browser must stay running.</li>
              <li>If it gets interrupted, just run it again — it picks up where it left off.</li>
              <li>A report file downloads at the end listing anything that needs your eyes.</li>
            </ul>
            <button onClick={start} className="btn-primary w-full py-3">
              Start Migration
            </button>
          </div>
        )}

        {state === 'running' && progress && (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-amber-500 animate-spin flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-stone-800">
                  {progress.phase === 'reading' && 'Reading your collection...'}
                  {progress.phase === 'enriching' && `Looking up titles & covers (${progress.current} of ${progress.total})`}
                  {progress.phase === 'writing' && 'Saving your new library...'}
                </div>
                <div className="text-sm text-stone-400 truncate">{progress.detail}</div>
              </div>
            </div>
            {progress.total > 0 && (
              <>
                <div className="h-3 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between text-xs text-stone-400">
                  <span>{pct}% · {progress.matched} covers found</span>
                  {progress.phase === 'enriching' && (
                    <span>~{Math.ceil(((progress.total - progress.current) * 2.5) / 60)} min left</span>
                  )}
                </div>
              </>
            )}
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
              <div className="text-lg font-bold">Migration complete!</div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-stone-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-stone-800">{report.counts.written}</div>
                <div className="text-stone-500">entries migrated</div>
              </div>
              <div className="bg-stone-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-stone-800">{report.counts.anilistMatched}</div>
                <div className="text-stone-500">covers & official names found</div>
              </div>
              <div className="bg-stone-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-stone-800">{report.merges.length}</div>
                <div className="text-stone-500">duplicates merged</div>
              </div>
              <div className="bg-stone-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-stone-800">{report.counts.unmatched}</div>
                <div className="text-stone-500">kept as-is (no confident match)</div>
              </div>
            </div>
            {report.possibleDuplicates.length > 0 && (
              <p className="text-sm text-gold bg-amber-50 border border-amber-100 rounded-xl p-3">
                {report.possibleDuplicates.length} possible duplicate pairs were flagged for your review —
                see the downloaded report file. Nothing was merged automatically for those.
              </p>
            )}
            <p className="text-xs text-stone-400">
              Two files were downloaded: your backup and the full report. Your old data is untouched.
            </p>
            <button onClick={onClose} className="btn-primary w-full py-3">
              See My Library
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">{error}</p>
            <p className="text-sm text-stone-500">
              Nothing was harmed — you can safely try again. If this keeps happening, send this message to Claude.
            </p>
            <button onClick={start} className="btn-primary w-full py-3">Try Again</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
