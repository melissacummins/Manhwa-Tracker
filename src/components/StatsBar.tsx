import { Manhwa, UserSettings } from '../types';

export function StatsBar({ manhwas, settings }: { manhwas: Manhwa[]; settings: UserSettings | null }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-8">
      <div className="glass-card p-4 text-center">
        <div className="text-2xl font-bold text-indigo-600">{manhwas.length}</div>
        <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Total</div>
      </div>
      {settings && Object.keys(settings.statusConfig).map(status => (
        <div key={status} className="glass-card p-4 text-center">
          <div className="text-2xl font-bold" style={{ color: settings.statusConfig[status] }}>
            {manhwas.filter(m => m.status === status).length}
          </div>
          <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">{status}</div>
        </div>
      ))}
    </div>
  );
}
