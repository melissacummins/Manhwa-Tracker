import { AlertCircle, BookOpen, Clapperboard, Edit2, RotateCcw, Star, Trash2, Tv } from 'lucide-react';
import { MediaItem, MediaType, UserConfig, displayStatus, typeLabel } from '../types';

function TypeIcon({ mediaType, className }: { mediaType: MediaType; className?: string }) {
  if (mediaType === 'movie') return <Clapperboard className={className} />;
  if (mediaType === 'tv' || mediaType === 'anime') return <Tv className={className} />;
  return <BookOpen className={className} />;
}

function Cover({ item, className }: { item: MediaItem; className: string }) {
  if (item.coverUrl) {
    return <img src={item.coverUrl} alt={item.title} loading="lazy" className={`${className} object-cover`} />;
  }
  return (
    <div className={`${className} bg-stone-100 flex items-center justify-center`}>
      <TypeIcon mediaType={item.mediaType} className="w-8 h-8 text-stone-300" />
    </div>
  );
}

// Plain divs on purpose: with ~1,400 cards, per-card layout animation makes
// every keystroke re-animate the whole shelf, which crawls on phones.
export function MediaCard({
  item,
  settings,
  view,
  onOpen,
  onEdit,
  onDelete,
}: {
  item: MediaItem;
  settings: UserConfig | null;
  view: 'list' | 'grid';
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const statusColor = settings?.statusConfig[item.status] || '#94a3b8';

  if (view === 'grid') {
    return (
      <div
        onClick={onOpen}
        className="glass-card overflow-hidden group hover:shadow-md transition-all flex flex-col cursor-pointer"
      >
        <div className="relative">
          <Cover item={item} className="w-full aspect-[2/3]" />
          {item.isFavorite && (
            <div className="absolute top-2 right-2 bg-white/90 rounded-full p-1 shadow-sm">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 p-2 bg-gradient-to-t from-stone-900/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-2 bg-white/90 text-stone-600 hover:text-gold rounded-xl">
              <Edit2 className="w-4 h-4" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-2 bg-white/90 text-stone-600 hover:text-red-600 rounded-xl">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="p-3">
          <h3 className="font-serif text-sm font-bold text-stone-900 line-clamp-2">{item.title}</h3>
          <div className="mt-2 flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-sm"
              style={{ backgroundColor: statusColor }}
            >
              {displayStatus(item.status, item.mediaType)}
            </span>
            {item.year && <span className="text-xs text-stone-400">{item.year}</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onOpen}
      className="glass-card p-4 sm:p-6 flex items-center justify-between gap-4 group hover:shadow-md transition-all cursor-pointer"
    >
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <Cover item={item} className="w-14 h-20 rounded-lg border border-stone-200 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-serif text-lg font-bold text-stone-900 truncate">{item.title}</h3>
            {item.isFavorite && <Star className="w-4 h-4 flex-shrink-0 text-amber-400 fill-amber-400" />}
            {item.wouldRevisit && <RotateCcw className="w-4 h-4 flex-shrink-0 text-amber-400" />}
            {item.rating != null && (
              <span className="flex items-center gap-0.5 text-xs font-bold text-amber-500 flex-shrink-0">
                {item.rating}
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              </span>
            )}
          </div>

          {item.alternativeTitles.length > 0 && (
            <p className="text-sm text-stone-500 mb-2 italic line-clamp-1">
              Also known as: {item.alternativeTitles.join(', ')}
            </p>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <span
              className="px-3 py-1 rounded-full text-xs font-bold text-white shadow-sm"
              style={{ backgroundColor: statusColor }}
            >
              {displayStatus(item.status, item.mediaType)}
            </span>
            <span className="text-xs text-stone-400 uppercase tracking-wider font-semibold">{typeLabel(item.mediaType)}</span>
            {item.year && <span className="text-xs text-stone-400">{item.year}</span>}
            {item.tags.map(t => (
              <span key={t} className="px-2 py-0.5 bg-amber-50 text-gold rounded-full text-xs font-medium">{t}</span>
            ))}
            {item.notes && (
              <span className="text-xs text-stone-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Has notes
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-2 text-stone-400 hover:text-gold hover:bg-amber-50 rounded-xl transition-all"
        >
          <Edit2 className="w-5 h-5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
