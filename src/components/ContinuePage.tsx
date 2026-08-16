import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Zap } from 'lucide-react';
import { MediaItem, typeGroupOf } from '../types';
import { AiringInfo, airingLabel, fetchAiringInfo } from '../lib/airing';
import { cn } from '../lib/utils';

const SECTION_CAP = 12;
type SortMode = 'recent' | 'neglected' | 'az';

function agoLabel(item: MediaItem): { text: string; fresh: boolean } {
  const ms = item.updatedAt?.toMillis?.();
  if (!ms) return { text: '', fresh: false };
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return { text: 'today', fresh: true };
  if (days === 1) return { text: 'yesterday', fresh: true };
  if (days < 7) return { text: `${days} days ago`, fresh: true };
  if (days < 30) return { text: `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`, fresh: false };
  if (days < 365) return { text: `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago 💤`, fresh: false };
  return { text: 'over a year ago 💤', fresh: false };
}

function Card({ item, airing, onOpen }: { item: MediaItem; airing?: AiringInfo; onOpen: () => void }) {
  const ago = agoLabel(item);
  const info = airingLabel(item, airing);
  return (
    <button
      onClick={onOpen}
      className="flex gap-3 items-start bg-white border border-shelfline rounded-xl p-2.5 text-left shadow-sm hover:shadow-md transition-all min-w-0"
    >
      {item.coverUrl ? (
        <img src={item.coverUrl} alt={item.title} loading="lazy" className="w-12 h-[72px] object-cover rounded-md border border-shelfline shadow flex-shrink-0" />
      ) : (
        <div className="w-12 h-[72px] bg-stone-100 rounded-md border border-shelfline flex items-center justify-center flex-shrink-0">
          <ImageIcon className="w-4 h-4 text-stone-300" />
        </div>
      )}
      <div className="min-w-0">
        <div className="font-serif font-semibold text-[13px] leading-snug line-clamp-2">{item.title}</div>
        <div className={cn("text-[11px] mt-1", ago.fresh ? "text-sky-700 font-semibold" : "text-stone-400 italic")}>
          {ago.text}
        </div>
        {info && <div className="text-[11px] text-gold font-semibold mt-0.5">{info}</div>}
      </div>
    </button>
  );
}

function Section({
  title,
  items,
  airing,
  sortMode,
  onOpen,
}: {
  title: string;
  items: MediaItem[];
  airing: Record<number, AiringInfo>;
  sortMode: SortMode;
  onOpen: (item: MediaItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => {
    const list = [...items];
    switch (sortMode) {
      case 'neglected': return list.sort((a, b) => (a.updatedAt?.toMillis?.() ?? 0) - (b.updatedAt?.toMillis?.() ?? 0));
      case 'az': return list.sort((a, b) => a.title.localeCompare(b.title));
      default: return list.sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
    }
  }, [items, sortMode]);

  if (items.length === 0) return null;
  const visible = expanded ? sorted : sorted.slice(0, SECTION_CAP);
  const hidden = sorted.length - visible.length;

  return (
    <div className="mb-10">
      <div className="kicker mb-4">{title} <span className="normal-case tracking-normal font-semibold text-stone-400">· {items.length}</span></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
        {visible.map(item => (
          <Card
            key={item.id}
            item={item}
            airing={item.externalIds?.anilistId ? airing[item.externalIds.anilistId] : undefined}
            onOpen={() => onOpen(item)}
          />
        ))}
        {hidden > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="flex flex-col items-center justify-center border-[1.5px] border-dashed border-shelf rounded-xl bg-goldsoft/60 text-gold font-bold text-sm py-6 hover:bg-goldsoft transition-colors"
          >
            +{hidden} more
            <span className="text-[10px] font-semibold text-stone-400">show all</span>
          </button>
        )}
        {expanded && sorted.length > SECTION_CAP && (
          <button
            onClick={() => setExpanded(false)}
            className="flex items-center justify-center border-[1.5px] border-dashed border-shelfline rounded-xl text-stone-400 font-semibold text-xs py-6 hover:text-stone-600 transition-colors"
          >
            collapse
          </button>
        )}
      </div>
    </div>
  );
}

export function ContinuePage({
  items,
  onOpen,
}: {
  items: MediaItem[];
  onOpen: (item: MediaItem) => void;
}) {
  const reading = useMemo(
    () => items.filter(m => m.status === 'Reading' && typeGroupOf(m.mediaType) === 'comics'),
    [items]
  );
  const watching = useMemo(
    () => items.filter(m => m.status === 'Reading' && typeGroupOf(m.mediaType) !== 'comics'),
    [items]
  );
  const excited = useMemo(
    () => items.filter(m => m.isExcited && m.status !== 'Reading'),
    [items]
  );

  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [airing, setAiring] = useState<Record<number, AiringInfo>>({});

  useEffect(() => {
    let alive = true;
    fetchAiringInfo([...reading, ...watching]).then(info => {
      if (alive) setAiring(info);
    });
    return () => { alive = false; };
  }, [reading, watching]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Sort:</span>
        {([['recent', 'Recent first'], ['az', 'A → Z']] as [SortMode, string][]).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => setSortMode(mode)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-bold border transition-all",
              sortMode === mode
                ? "bg-goldsoft border-shelf text-gold"
                : "bg-white border-stone-200 text-stone-500 hover:border-amber-300"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Section title="Currently Reading" items={reading} airing={airing} sortMode={sortMode} onOpen={onOpen} />
      <Section title="Currently Watching" items={watching} airing={airing} sortMode={sortMode} onOpen={onOpen} />

      {excited.length > 0 && (
        <div className="mb-10">
          <div className="kicker mb-4">
            <span className="flex items-center gap-1.5">Most Excited For <Zap className="w-3 h-3 fill-current text-wine" /></span>
            <span className="normal-case tracking-normal font-semibold text-stone-400">· {excited.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {excited.map(item => (
              <Card
                key={item.id}
                item={item}
                airing={item.externalIds?.anilistId ? airing[item.externalIds.anilistId] : undefined}
                onOpen={() => onOpen(item)}
              />
            ))}
          </div>
        </div>
      )}

      {reading.length === 0 && watching.length === 0 && excited.length === 0 && (
        <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-stone-300 text-stone-500">
          Nothing in progress — mark something as Reading or Watching and it'll appear here.
        </div>
      )}
    </div>
  );
}
