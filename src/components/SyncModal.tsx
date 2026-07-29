import { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Link2, RefreshCw, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { User } from '../firebase';
import { anilistAuthUrl, getStoredToken, pushToAniList, PushProgress, PushResult } from '../lib/anilistPush';
import { syncFromMal, MalSyncResult } from '../lib/malSync';
import { MediaItem, UserConfig } from '../types';

export function SyncModal({
  user,
  items,
  settings,
  onClose,
}: {
  user: User;
  items: MediaItem[];
  settings: UserConfig | null;
  onClose: () => void;
}) {
  // --- MAL pull state ---
  const [malUsername, setMalUsername] = useState(settings?.malUsername || '');
  const [malBusy, setMalBusy] = useState(false);
  const [malResult, setMalResult] = useState<MalSyncResult | null>(null);
  const [malError, setMalError] = useState<string | null>(null);

  // --- AniList push state ---
  const connected = !!getStoredToken();
  const authUrl = anilistAuthUrl();
  const [pushBusy, setPushBusy] = useState(false);
  const [pushProgress, setPushProgress] = useState<PushProgress | null>(null);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const runMalSync = async () => {
    if (!malUsername.trim()) return;
    setMalBusy(true);
    setMalError(null);
    setMalResult(null);
    try {
      setMalResult(await syncFromMal(user.uid, malUsername.trim(), items));
    } catch (err) {
      setMalError(err instanceof Error ? err.message : String(err));
    } finally {
      setMalBusy(false);
    }
  };

  const runPush = async () => {
    setPushBusy(true);
    setPushError(null);
    setPushResult(null);
    cancelled.current = false;
    try {
      const result = await pushToAniList(items, setPushProgress, () => cancelled.current);
      if (result) {
        setPushResult(result);
        if (result.tokenExpired) setPushError('Your AniList connection expired — connect again, then push.');
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushBusy(false);
      setPushProgress(null);
    }
  };

  const busy = malBusy || pushBusy;
  const pct = pushProgress && pushProgress.total > 0
    ? Math.round((pushProgress.current / pushProgress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={busy ? undefined : onClose}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-cream rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 border-b border-shelfline flex justify-between items-center">
          <h2 className="font-serif text-xl font-bold flex items-center gap-2">
            <Link2 className="w-5 h-5 text-gold" />
            Sync Connections
          </h2>
          {!busy && (
            <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full">
              <XCircle className="w-6 h-6 text-stone-400" />
            </button>
          )}
        </div>

        {/* ---- MAL pull ---- */}
        <div className="p-6 space-y-3 border-b border-shelfline">
          <div className="flex items-center gap-2 font-bold text-stone-800">
            <ArrowDownToLine className="w-4 h-4 text-gold" />
            Pull from MyAnimeList
          </div>
          <p className="text-sm text-stone-500">
            Brings in both your MAL lists — anime, and the manga list Mihon tracks to. New
            titles are added; statuses and scores update. Your favorites, tags, and notes
            here are never changed. Runs automatically about once a day after the first sync.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={malUsername}
              onChange={(e) => setMalUsername(e.target.value)}
              placeholder="Your MAL username"
              className="flex-1 min-w-0 px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button
              onClick={runMalSync}
              disabled={malBusy || !malUsername.trim()}
              className="btn-primary flex-shrink-0 flex items-center gap-2 disabled:opacity-50"
            >
              {malBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowDownToLine className="w-4 h-4" />}
              Sync
            </button>
          </div>
          {settings?.lastMalSync && !malResult && !malError && (
            <p className="text-xs text-stone-400">Last synced {new Date(settings.lastMalSync).toLocaleString()}</p>
          )}
          {malResult && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              {malResult.total} on MAL · {malResult.added} added · {malResult.updated} updated · {malResult.unchanged} already current
              {malResult.skippedNovels > 0 && ` · ${malResult.skippedNovels} novels skipped`}
            </p>
          )}
          {malError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">{malError}</p>
          )}
        </div>

        {/* ---- AniList push ---- */}
        <div className="p-6 space-y-3">
          <div className="flex items-center gap-2 font-bold text-stone-800">
            <ArrowUpFromLine className="w-4 h-4 text-gold" />
            Push to AniList
          </div>
          <p className="text-sm text-stone-500">
            Sends your statuses and ratings to your AniList account as a backup — anime and
            any manhwa/manga the library has matched. After the first push, only changed
            entries are sent, and it re-runs automatically with the daily MAL sync.
          </p>

          {!authUrl ? (
            <p className="text-sm text-stone-500 bg-stone-50 border border-stone-200 rounded-xl p-3">
              Not configured yet: add <code className="text-xs">VITE_ANILIST_CLIENT_ID</code> in
              Vercel's environment variables and redeploy.
            </p>
          ) : !connected ? (
            <a href={authUrl} className="btn-primary inline-flex items-center gap-2">
              <Link2 className="w-4 h-4" />
              Connect AniList
            </a>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <button
                  onClick={runPush}
                  disabled={pushBusy}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {pushBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowUpFromLine className="w-4 h-4" />}
                  Push now
                </button>
                <span className="text-xs text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                </span>
              </div>
              {pushBusy && pushProgress && (
                <div className="space-y-2">
                  <div className="h-2.5 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-stone-400">
                    <span className="truncate pr-3">{pushProgress.detail}</span>
                    <span className="flex-shrink-0">{pushProgress.current}/{pushProgress.total}</span>
                  </div>
                  <button
                    onClick={() => { cancelled.current = true; }}
                    className="btn-secondary w-full py-2 text-sm"
                  >
                    Pause (resumes where it left off)
                  </button>
                </div>
              )}
            </>
          )}

          {pushResult && !pushResult.tokenExpired && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
              Pushed {pushResult.pushed} · {pushResult.skipped} already current
              {pushResult.failed > 0 && ` · ${pushResult.failed} couldn't be matched`}
            </p>
          )}
          {pushError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">{pushError}</p>
          )}
          <p className="text-xs text-stone-400">
            First push covers everything and takes a while (AniList limits speed) — keep the tab open,
            or pause anytime. Later pushes only send what changed.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
