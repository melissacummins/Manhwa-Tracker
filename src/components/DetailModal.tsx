import { useState } from 'react';
import { Copy, Check, Edit2, ExternalLink, Image as ImageIcon, RotateCcw, Star, Trash2, XCircle, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { MediaItem, UserConfig, displayStatus, typeLabel } from '../types';
import { cn } from '../lib/utils';

function CopyText({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Click to copy"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={cn("text-left border-b border-dashed border-stone-300 hover:border-gold hover:text-gold transition-colors", className)}
    >
      {copied ? <span className="text-emerald-600">Copied!</span> : text}
    </button>
  );
}

export function DetailModal({
  item,
  settings,
  onClose,
  onEdit,
  onDelete,
}: {
  item: MediaItem;
  settings: UserConfig | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const statusColor = settings?.statusConfig[item.status] || '#94a3b8';
  const anilistUrl = item.externalIds?.anilistId ? `https://anilist.co/manga/${item.externalIds.anilistId}` : null;
  const tmdbUrl = item.externalIds?.tmdbId
    ? `https://www.themoviedb.org/${item.mediaType === 'tv' ? 'tv' : 'movie'}/${item.externalIds.tmdbId}`
    : null;

  const copyTitle = () => {
    navigator.clipboard.writeText(item.title).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-cream rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-stone-100 rounded-full z-10">
          <XCircle className="w-6 h-6 text-stone-400" />
        </button>

        <div className="p-6 sm:p-7 flex flex-col sm:flex-row gap-6 overflow-y-auto">
          {item.coverUrl ? (
            <img
              src={item.coverUrl}
              alt={item.title}
              className="w-36 sm:w-40 aspect-[2/3] object-cover rounded-xl border border-shelfline shadow-lg flex-shrink-0 mx-auto sm:mx-0"
            />
          ) : (
            <div className="w-36 sm:w-40 aspect-[2/3] bg-stone-100 rounded-xl border border-shelfline flex items-center justify-center flex-shrink-0 mx-auto sm:mx-0">
              <ImageIcon className="w-10 h-10 text-stone-300" />
            </div>
          )}

          <div className="min-w-0 flex-1 sm:pr-10">
            <div className="flex items-start gap-3 pr-10 sm:pr-0">
              <h2 className="font-serif text-2xl font-semibold leading-tight">{item.title}</h2>
              <button
                onClick={copyTitle}
                className="flex items-center gap-1.5 text-xs font-bold text-gold bg-goldsoft border border-shelfline rounded-lg px-2.5 py-1.5 mt-1 flex-shrink-0 hover:bg-shelf transition-colors"
                title="Copy title"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="text-sm text-stone-500 mt-1.5 flex items-center gap-2 flex-wrap">
              <span className="uppercase tracking-wider font-semibold text-xs">{typeLabel(item.mediaType)}</span>
              {item.year && <span>· {item.year}</span>}
              {anilistUrl && (
                <a href={anilistUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-gold hover:underline">
                  AniList <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {tmdbUrl && (
                <a href={tmdbUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-gold hover:underline">
                  TMDB <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {item.alternativeTitles.length > 0 && (
              <div className="mt-3 text-sm text-stone-600 italic leading-relaxed">
                Also known as:{' '}
                {item.alternativeTitles.map((alt, i) => (
                  <span key={i}>
                    <CopyText text={alt} />
                    {i < item.alternativeTitles.length - 1 && ' · '}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2 items-center">
              <span className="px-3 py-1 rounded-full text-xs font-bold text-white shadow-sm" style={{ backgroundColor: statusColor }}>
                {displayStatus(item.status, item.mediaType)}
              </span>
              {item.isFavorite && (
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-goldsoft text-gold flex items-center gap-1">
                  <Star className="w-3 h-3 fill-current" /> Favorite
                </span>
              )}
              {item.wouldRevisit && (
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-goldsoft text-gold flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" /> Would revisit
                </span>
              )}
              {item.isExcited && (
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-wine/10 text-wine flex items-center gap-1">
                  <Zap className="w-3 h-3 fill-current" /> Most excited
                </span>
              )}
              {item.rating != null && (
                <span className="flex items-center gap-0.5 text-sm font-bold text-amber-500">
                  {item.rating}
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                </span>
              )}
            </div>

            {item.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.tags.map(t => (
                  <span key={t} className="px-2.5 py-0.5 bg-wine/10 text-wine rounded-full text-xs font-medium">{t}</span>
                ))}
              </div>
            )}

            {item.notes && (
              <div className="mt-4 text-sm italic text-stone-600 bg-goldsoft border-l-[3px] border-gold rounded-r-lg px-4 py-2.5">
                &ldquo;{item.notes}&rdquo;
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-shelfline px-6 py-4 flex gap-2 justify-end bg-paper/60">
          <button onClick={onDelete} className="flex items-center gap-1.5 text-sm text-stone-400 hover:text-red-600 px-3 py-2 transition-colors">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
          <button onClick={onEdit} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Edit2 className="w-4 h-4" /> Edit
          </button>
          <button onClick={onClose} className="btn-primary text-sm px-6">Done</button>
        </div>
      </motion.div>
    </div>
  );
}
