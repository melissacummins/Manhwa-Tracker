import { MediaItem, UserConfig } from '../types';

export function StatsBar({ items, settings }: { items: MediaItem[]; settings: UserConfig | null }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-8">
      <div className="glass-card p-4 text-center">
        <div className="text-2xl font-bold text-gold">{items.length}</div>
        <div className="text-xs text-stone-500 uppercase tracking-wider font-semibold">Total</div>
      </div>
      {settings && Object.keys(settings.statusConfig).map(status => (
        <div key={status} className="glass-card p-4 text-center">
          <div className="text-2xl font-bold" style={{ color: settings.statusConfig[status] }}>
            {items.filter(m => m.status === status).length}
          </div>
          <div className="text-xs text-stone-500 uppercase tracking-wider font-semibold">{status}</div>
        </div>
      ))}
    </div>
  );
}
