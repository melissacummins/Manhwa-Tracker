import { Image as ImageIcon, Zap } from 'lucide-react';
import { MediaItem, displayStatus, typeLabel } from '../types';

function ShelfCard({ item, badge, sub, onOpen }: { item: MediaItem; badge: React.ReactNode; sub: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex gap-3 items-start bg-white border border-shelfline rounded-xl p-2.5 pr-4 min-w-[230px] max-w-[260px] shadow-sm hover:shadow-md transition-all text-left flex-shrink-0"
    >
      {item.coverUrl ? (
        <img src={item.coverUrl} alt={item.title} loading="lazy" className="w-14 h-20 object-cover rounded-md border border-shelfline shadow flex-shrink-0" />
      ) : (
        <div className="w-14 h-20 bg-stone-100 rounded-md border border-shelfline flex items-center justify-center flex-shrink-0">
          <ImageIcon className="w-5 h-5 text-stone-300" />
        </div>
      )}
      <div className="min-w-0">
        {badge}
        <div className="font-serif font-semibold text-sm leading-snug mt-0.5 line-clamp-2">{item.title}</div>
        <div className="text-xs text-stone-400 italic mt-1 truncate">{sub}</div>
      </div>
    </button>
  );
}

export function TopShelf({
  reading,
  excited,
  onOpen,
}: {
  reading: MediaItem[];
  excited: MediaItem[];
  onOpen: (item: MediaItem) => void;
}) {
  if (reading.length === 0 && excited.length === 0) return null;

  return (
    <div className="space-y-5 mb-8">
      {reading.length > 0 && (
        <div>
          <div className="kicker mb-3">Currently Reading</div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {reading.map(item => (
              <ShelfCard
                key={item.id}
                item={item}
                onOpen={() => onOpen(item)}
                badge={<span className="text-[10px] font-bold uppercase tracking-wider text-sky-700">● {displayStatus(item.status, item.mediaType)}</span>}
                sub={item.isFavorite ? 'a favorite' : typeLabel(item.mediaType)}
              />
            ))}
          </div>
        </div>
      )}
      {excited.length > 0 && (
        <div>
          <div className="kicker mb-3">Most Excited For</div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {excited.map(item => (
              <ShelfCard
                key={item.id}
                item={item}
                onOpen={() => onOpen(item)}
                badge={
                  <span className="text-[10px] font-bold uppercase tracking-wider text-wine flex items-center gap-1">
                    <Zap className="w-3 h-3 fill-current" /> Excited
                  </span>
                }
                sub={displayStatus(item.status, item.mediaType)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
