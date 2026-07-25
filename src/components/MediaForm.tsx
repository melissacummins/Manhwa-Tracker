import React, { useEffect, useState } from 'react';
import { AlertCircle, Star, XCircle } from 'lucide-react';
import {
  collection,
  db,
  doc,
  handleFirestoreError,
  OperationType,
  setDoc,
  updateDoc,
  User,
} from '../firebase';
import { cn } from '../lib/utils';
import { Manhwa, UserSettings } from '../types';

export function MediaForm({
  user,
  existingManhwas,
  settings,
  editingManhwa,
  onClose,
}: {
  user: User;
  existingManhwas: Manhwa[];
  settings: UserSettings | null;
  editingManhwa: Manhwa | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(editingManhwa?.title || '');
  const [altTitles, setAltTitles] = useState<string[]>(editingManhwa?.alternativeTitles || []);
  const [status, setStatus] = useState(editingManhwa?.status || 'Plan to Read');
  const [isFavorite, setIsFavorite] = useState(editingManhwa?.isFavorite || false);
  const [notes, setNotes] = useState(editingManhwa?.notes || '');
  const [duplicateFound, setDuplicateFound] = useState<Manhwa | null>(null);

  // Duplicate Check
  useEffect(() => {
    if (!title) {
      setDuplicateFound(null);
      return;
    }
    const normalizedTitle = title.toLowerCase().trim();
    const found = existingManhwas.find(m =>
      m.id !== editingManhwa?.id && (
        m.title.toLowerCase().trim() === normalizedTitle ||
        m.alternativeTitles.some(alt => alt.toLowerCase().trim() === normalizedTitle)
      )
    );
    setDuplicateFound(found || null);
  }, [title, existingManhwas, editingManhwa]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !user) return;

    const data = {
      title,
      alternativeTitles: altTitles,
      status,
      isFavorite,
      notes,
      updatedAt: new Date(),
      userId: user.uid
    };

    try {
      if (editingManhwa) {
        await updateDoc(doc(db, 'manhwas', editingManhwa.id), data);
      } else {
        const newDocRef = doc(collection(db, 'manhwas'));
        await setDoc(newDocRef, { ...data, createdAt: new Date() });
      }
      onClose();
    } catch (err) {
      handleFirestoreError(err, editingManhwa ? OperationType.UPDATE : OperationType.CREATE, 'manhwas');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full max-h-[90vh]">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center">
        <h2 className="text-xl font-bold">{editingManhwa ? 'Edit Manhwa' : 'Add New Manhwa'}</h2>
        <button type="button" onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full">
          <XCircle className="w-6 h-6 text-slate-400" />
        </button>
      </div>

      <div className="p-6 space-y-6 overflow-y-auto flex-1">
        {/* Title & Duplicate Warning */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">Title</label>
          <div className="relative">
            <input
              autoFocus
              required
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={cn(
                "w-full px-4 py-3 bg-slate-50 border rounded-2xl outline-none transition-all",
                duplicateFound ? "border-amber-400 ring-2 ring-amber-100" : "border-slate-200 focus:ring-2 focus:ring-indigo-500"
              )}
              placeholder="Enter manhwa title..."
            />
            {duplicateFound && (
              <div className="mt-2 flex items-center gap-2 text-amber-600 text-sm bg-amber-50 p-3 rounded-xl border border-amber-100">
                <AlertCircle className="w-4 h-4" />
                <span>Duplicate found: <strong>{duplicateFound.title}</strong> is already in your list.</span>
              </div>
            )}
          </div>
        </div>

        {/* Alternative Titles */}
        <div className="space-y-3">
          <label className="text-sm font-bold text-slate-700">Alternative Titles</label>
          <div className="flex flex-wrap gap-2 min-h-[40px] p-3 bg-slate-50 border border-slate-200 rounded-2xl">
            {altTitles.map((alt, i) => (
              <span key={i} className="px-3 py-1 bg-white border border-slate-200 rounded-full text-xs font-medium flex items-center gap-2">
                {alt}
                <button
                  type="button"
                  onClick={() => setAltTitles(altTitles.filter((_, idx) => idx !== i))}
                  className="text-slate-400 hover:text-red-500"
                >
                  <XCircle className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              placeholder="Add name..."
              className="bg-transparent text-xs outline-none flex-1 min-w-[100px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const val = e.currentTarget.value.trim();
                  if (val && !altTitles.includes(val)) {
                    setAltTitles([...altTitles, val]);
                    e.currentTarget.value = '';
                  }
                }
              }}
            />
          </div>
        </div>

        {/* Status & Favorite */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {settings && Object.keys(settings.statusConfig).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Favorite</label>
            <button
              type="button"
              onClick={() => setIsFavorite(!isFavorite)}
              className={cn(
                "w-full px-4 py-3 border rounded-2xl flex items-center justify-center gap-2 transition-all",
                isFavorite ? "bg-amber-50 border-amber-200 text-amber-600" : "bg-slate-50 border-slate-200 text-slate-400"
              )}
            >
              <Star className={cn("w-5 h-5", isFavorite && "fill-amber-500")} />
              {isFavorite ? 'Favorited' : 'Mark Favorite'}
            </button>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 min-h-[100px] resize-none"
            placeholder="Add your thoughts, review, or progress..."
          />
        </div>
      </div>

      <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="btn-secondary flex-1"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary flex-1"
        >
          {editingManhwa ? 'Save Changes' : 'Add Manhwa'}
        </button>
      </div>
    </form>
  );
}
