import { MediaItem, TypeGroup, UserConfig, isWatchGroup, statusLabelFor, typeGroupOf } from '../types';

export function StatsBar({
  items,
  settings,
  typeFilter,
}: {
  items: MediaItem[];
  settings: UserConfig | null;
  typeFilter: TypeGroup | 'All';
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-8">
      <div className="glass-card p-4 text-center">
        <div className="text-2xl font-bold text-gold">{items.length}</div>
        <div className="text-xs text-stone-500 uppercase tracking-wider font-semibold">Total</div>
      </div>
      {settings && Object.keys(settings.statusConfig).map(status => {
        const matching = items.filter(m => m.status === status);
        // On the All view, "Reading" spans two worlds — show the split
        const showSplit = typeFilter === 'All' && (status === 'Reading' || status === 'Plan to Read');
        const readCount = showSplit ? matching.filter(m => typeGroupOf(m.mediaType) === 'comics').length : 0;
        const watchCount = showSplit ? matching.length - readCount : 0;
        return (
          <div key={status} className="glass-card p-4 text-center">
            <div className="text-2xl font-bold" style={{ color: settings.statusConfig[status] }}>
              {matching.length}
            </div>
            <div className="text-xs text-stone-500 uppercase tracking-wider font-semibold">
              {statusLabelFor(status, typeFilter)}
            </div>
            {showSplit && matching.length > 0 && (
              <div className="text-[10px] text-stone-400 mt-0.5">
                {status === 'Reading'
                  ? `${readCount} reading · ${watchCount} watching`
                  : `${readCount} to read · ${watchCount} to watch`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
