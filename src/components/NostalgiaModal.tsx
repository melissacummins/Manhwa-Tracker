import { useState } from 'react';
import { Image as ImageIcon, RotateCcw, Sparkles, Star, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { MediaItem } from '../types';

// Weighted random pick from favorites / would-revisit items, biased toward
// the ones touched longest ago — the deeper the nostalgia, the higher the odds.
function pickNostalgic(pool: MediaItem[], excludeId?: string): MediaItem | null {
  const candidates = pool.filter(m => m.id !== excludeId);
  const source = candidates.length > 0 ? candidates : pool;
  if (source.length === 0) return null;
  const byAge = [...source].sort((a, b) =>
    (a.updatedAt?.toMillis?.() ?? 0) - (b.updatedAt?.toMillis?.() ?? 0)
  );
  const n = byAge.length;
  const totalWeight = (n * (n + 1)) / 2;
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < n; i++) {
    roll -= n - i; // oldest first, weight n..1
    if (roll <= 0) return byAge[i];
  }
  return byAge[n - 1];
}

export function NostalgiaModal({ pool, onClose }: { pool: MediaItem[]; onClose: () => void }) {
  const [pick, setPick] = useState<MediaItem | null>(() => pickNostalgic(pool));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-500" />
            Something Nostalgic
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full">
            <XCircle className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        {pick ? (
          <div className="p-6 text-center">
            {pick.coverUrl ? (
              <img
                src={pick.coverUrl}
                alt={pick.title}
                className="w-40 mx-auto aspect-[2/3] object-cover rounded-2xl border border-slate-200 shadow-md"
              />
            ) : (
              <div className="w-40 mx-auto aspect-[2/3] bg-slate-100 rounded-2xl border border-slate-200 flex items-center justify-center">
                <ImageIcon className="w-10 h-10 text-slate-300" />
              </div>
            )}
            <h3 className="mt-4 text-lg font-bold text-slate-900">{pick.title}</h3>
            <div className="mt-1 flex items-center justify-center gap-2 text-sm text-slate-400">
              <span className="uppercase tracking-wider font-semibold text-xs">{pick.mediaType}</span>
              {pick.year && <span>{pick.year}</span>}
              {pick.isFavorite && <Star className="w-4 h-4 text-amber-400 fill-amber-400" />}
            </div>
            {pick.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {pick.tags.map(t => (
                  <span key={t} className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium">{t}</span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500">
            Nothing to pick from yet — mark some favorites or "would revisit" items first.
          </div>
        )}

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex gap-3">
          <button
            onClick={() => setPick(pickNostalgic(pool, pick?.id))}
            disabled={!pick}
            className="btn-secondary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" />
            Pick again
          </button>
          <button onClick={onClose} disabled={!pick} className="btn-primary flex-1 disabled:opacity-50">
            This one!
          </button>
        </div>
      </motion.div>
    </div>
  );
}
