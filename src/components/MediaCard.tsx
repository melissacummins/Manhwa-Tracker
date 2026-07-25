import type { Ref } from 'react';
import { AlertCircle, Edit2, Star, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Manhwa, UserSettings } from '../types';

export function MediaCard({
  manhwa,
  settings,
  onEdit,
  onDelete,
  ref,
}: {
  manhwa: Manhwa;
  settings: UserSettings | null;
  onEdit: () => void;
  onDelete: () => void;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="glass-card p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:shadow-md transition-all"
    >
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-lg font-bold text-slate-900">{manhwa.title}</h3>
          {manhwa.isFavorite && <Star className="w-4 h-4 text-amber-400 fill-amber-400" />}
        </div>

        {manhwa.alternativeTitles.length > 0 && (
          <p className="text-sm text-slate-500 mb-2 italic">
            Also known as: {manhwa.alternativeTitles.join(', ')}
          </p>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <span
            className="px-3 py-1 rounded-full text-xs font-bold text-white shadow-sm"
            style={{ backgroundColor: settings?.statusConfig[manhwa.status] || '#94a3b8' }}
          >
            {manhwa.status}
          </span>
          {manhwa.notes && (
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Has notes
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
        >
          <Edit2 className="w-5 h-5" />
        </button>
        <button
          onClick={onDelete}
          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  );
}
