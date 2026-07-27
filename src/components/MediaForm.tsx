import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Image as ImageIcon, RefreshCw, RotateCcw, Search, Star, XCircle, Zap } from 'lucide-react';
import {
  collection,
  db,
  doc,
  handleFirestoreError,
  OperationType,
  serverTimestamp,
  setDoc,
  updateDoc,
  User,
} from '../firebase';
import { searchMetadata, MetadataError, MetadataResult } from '../lib/metadata';
import { cn } from '../lib/utils';
import { MediaItem, MediaType, MEDIA_TYPES, UserConfig, normalizeTitle } from '../types';

export function MediaForm({
  user,
  existingItems,
  allTags,
  settings,
  editingItem,
  onClose,
}: {
  user: User;
  existingItems: MediaItem[];
  allTags: string[];
  settings: UserConfig | null;
  editingItem: MediaItem | null;
  onClose: () => void;
}) {
  const [mediaType, setMediaType] = useState<MediaType>(editingItem?.mediaType || 'manhwa');
  const [title, setTitle] = useState(editingItem?.title || '');
  const [altTitles, setAltTitles] = useState<string[]>(editingItem?.alternativeTitles || []);
  const [coverUrl, setCoverUrl] = useState<string | null>(editingItem?.coverUrl || null);
  const [year, setYear] = useState<number | null>(editingItem?.year ?? null);
  const [externalIds, setExternalIds] = useState<MediaItem['externalIds']>(editingItem?.externalIds || {});
  const [status, setStatus] = useState(editingItem?.status || 'Plan to Read');
  const [isFavorite, setIsFavorite] = useState(editingItem?.isFavorite || false);
  const [wouldRevisit, setWouldRevisit] = useState(editingItem?.wouldRevisit || false);
  const [isExcited, setIsExcited] = useState(editingItem?.isExcited || false);
  const [rating, setRating] = useState<number | null>(editingItem?.rating ?? null);
  const [tags, setTags] = useState<string[]>(editingItem?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState(editingItem?.notes || '');
  const [duplicateFound, setDuplicateFound] = useState<MediaItem | null>(null);

  const tagSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    return allTags
      .filter(t => !tags.includes(t) && (!q || t.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [allTags, tags, tagInput]);

  const addTag = (raw: string) => {
    const val = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (val && !tags.includes(val) && tags.length < 20) {
      setTags([...tags, val]);
    }
    setTagInput('');
  };

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<MetadataResult[] | null>(null);

  // Duplicate Check — compares both directions: the new entry's title AND
  // alt titles against every existing entry's title and alt titles.
  useEffect(() => {
    if (!title) {
      setDuplicateFound(null);
      return;
    }
    const ourNames = new Set([title, ...altTitles].map(normalizeTitle).filter(Boolean));
    const found = existingItems.find(m =>
      m.id !== editingItem?.id &&
      [m.title, ...m.alternativeTitles].some(n => ourNames.has(normalizeTitle(n)))
    );
    setDuplicateFound(found || null);
  }, [title, altTitles, existingItems, editingItem]);

  const handleSearch = async () => {
    if (!title.trim()) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    try {
      const found = await searchMetadata(title, mediaType);
      setResults(found);
      if (found.length === 0) setSearchError('No matches found — you can still add it manually.');
    } catch (err) {
      setSearchError(err instanceof MetadataError ? err.message : 'Search unavailable — add manually.');
    } finally {
      setSearching(false);
    }
  };

  const applyResult = (r: MetadataResult) => {
    setTitle(r.title);
    setAltTitles(Array.from(new Set([...r.alternativeTitles])));
    setCoverUrl(r.coverUrl);
    setYear(r.year);
    setExternalIds(r.source === 'anilist' ? { anilistId: r.externalId } : { tmdbId: r.externalId });
    if (r.source === 'anilist' && mediaType !== 'anime' && mediaType !== 'webtoon') {
      setMediaType(r.suggestedMediaType);
    }
    setResults(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !user) return;

    const data = {
      mediaType,
      title,
      alternativeTitles: altTitles,
      coverUrl,
      year,
      externalIds,
      status,
      isFavorite,
      wouldRevisit,
      isExcited,
      rating,
      tags,
      notes,
      updatedAt: serverTimestamp(),
    };

    try {
      const mediaCollection = collection(db, 'users', user.uid, 'media');
      if (editingItem) {
        await updateDoc(doc(mediaCollection, editingItem.id), data);
      } else {
        const newDocRef = doc(mediaCollection);
        await setDoc(newDocRef, { ...data, createdAt: serverTimestamp() });
      }
      onClose();
    } catch (err) {
      handleFirestoreError(err, editingItem ? OperationType.UPDATE : OperationType.CREATE, 'users/media');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full max-h-[90vh]">
      <div className="p-6 border-b border-stone-100 flex justify-between items-center">
        <h2 className="font-serif text-xl font-bold">{editingItem ? 'Edit Entry' : 'Add New Entry'}</h2>
        <button type="button" onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full">
          <XCircle className="w-6 h-6 text-stone-400" />
        </button>
      </div>

      <div className="p-6 space-y-6 overflow-y-auto flex-1">
        {/* Media Type */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-stone-700">Type</label>
          <div className="flex flex-wrap gap-2">
            {MEDIA_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setMediaType(t.value)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                  mediaType === t.value
                    ? "bg-gold border-gold text-white"
                    : "bg-white border-stone-200 text-stone-500 hover:border-amber-300"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Title + Search */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-stone-700">Title</label>
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <input
                autoFocus
                required
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !searching) {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                className={cn(
                  "w-full px-4 pr-10 py-3 bg-stone-50 border rounded-2xl outline-none transition-all",
                  duplicateFound ? "border-amber-400 ring-2 ring-amber-100" : "border-stone-200 focus:ring-2 focus:ring-amber-500"
                )}
                placeholder="Enter a title, then search..."
              />
              {title && (
                <button
                  type="button"
                  onClick={() => {
                    setTitle('');
                    setResults(null);
                    setSearchError(null);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  title="Clear title and search again"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching || !title.trim()}
              className="btn-secondary flex-shrink-0 flex items-center gap-2 disabled:opacity-50"
              title="Search"
            >
              {searching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span className="hidden sm:inline">Search</span>
            </button>
          </div>
          {duplicateFound && (
            <div className="flex items-center gap-2 text-gold text-sm bg-amber-50 p-3 rounded-xl border border-amber-100">
              <AlertCircle className="w-4 h-4" />
              <span>Duplicate found: <strong>{duplicateFound.title}</strong> is already in your list.</span>
            </div>
          )}
          {searchError && (
            <div className="text-sm text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200">{searchError}</div>
          )}
        </div>

        {/* Search Results Picker */}
        {results && results.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-bold text-stone-700">Pick a match</label>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {results.map(r => (
                <button
                  key={`${r.source}-${r.externalId}`}
                  type="button"
                  onClick={() => applyResult(r)}
                  className="flex-shrink-0 w-28 text-left group"
                >
                  {r.coverUrl ? (
                    <img
                      src={r.coverUrl}
                      alt={r.title}
                      className="w-28 h-40 object-cover rounded-xl border border-stone-200 group-hover:ring-2 group-hover:ring-amber-500 transition-all"
                    />
                  ) : (
                    <div className="w-28 h-40 bg-stone-100 rounded-xl border border-stone-200 flex items-center justify-center group-hover:ring-2 group-hover:ring-amber-500 transition-all">
                      <ImageIcon className="w-8 h-8 text-stone-300" />
                    </div>
                  )}
                  <div className="mt-1 text-xs font-medium text-stone-700 line-clamp-2">{r.title}</div>
                  {r.year && <div className="text-xs text-stone-400">{r.year}</div>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Cover preview */}
        {coverUrl && (
          <div className="flex items-center gap-3">
            <img src={coverUrl} alt={title} className="w-16 h-24 object-cover rounded-lg border border-stone-200" />
            <button
              type="button"
              onClick={() => setCoverUrl(null)}
              className="text-xs text-stone-400 hover:text-red-500"
            >
              Remove cover
            </button>
          </div>
        )}

        {/* Alternative Titles */}
        <div className="space-y-3">
          <label className="text-sm font-bold text-stone-700">Alternative Titles</label>
          <div className="flex flex-wrap gap-2 min-h-[40px] p-3 bg-stone-50 border border-stone-200 rounded-2xl">
            {altTitles.map((alt, i) => (
              <span key={i} className="px-3 py-1 bg-white border border-stone-200 rounded-full text-xs font-medium flex items-center gap-2">
                {alt}
                <button
                  type="button"
                  onClick={() => setAltTitles(altTitles.filter((_, idx) => idx !== i))}
                  className="text-stone-400 hover:text-red-500"
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-bold text-stone-700">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl outline-none focus:ring-2 focus:ring-amber-500"
            >
              {settings && Object.keys(settings.statusConfig).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-stone-700">Favorite</label>
            <button
              type="button"
              onClick={() => setIsFavorite(!isFavorite)}
              className={cn(
                "w-full px-4 py-3 border rounded-2xl flex items-center justify-center gap-2 transition-all",
                isFavorite ? "bg-amber-50 border-amber-200 text-gold" : "bg-stone-50 border-stone-200 text-stone-400"
              )}
            >
              <Star className={cn("w-5 h-5", isFavorite && "fill-amber-500")} />
              {isFavorite ? 'Favorited' : 'Mark Favorite'}
            </button>
          </div>
        </div>

        {/* Rating & Would Revisit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-bold text-stone-700">Rating</label>
            <div className="flex items-center justify-center sm:justify-start gap-1 px-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(rating === n ? null : n)}
                  className="p-0.5"
                  title={`${n} star${n > 1 ? 's' : ''}`}
                >
                  <Star className={cn(
                    "w-6 h-6 transition-colors",
                    rating !== null && n <= rating ? "text-amber-400 fill-amber-400" : "text-stone-300"
                  )} />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-stone-700">Would Revisit</label>
            <button
              type="button"
              onClick={() => setWouldRevisit(!wouldRevisit)}
              className={cn(
                "w-full px-4 py-3 border rounded-2xl flex items-center justify-center gap-2 transition-all",
                wouldRevisit ? "bg-amber-50 border-amber-200 text-gold" : "bg-stone-50 border-stone-200 text-stone-400"
              )}
            >
              <RotateCcw className="w-5 h-5" />
              {wouldRevisit ? "Would read/watch again" : "One and done"}
            </button>
          </div>
        </div>

        {/* Most Excited */}
        <button
          type="button"
          onClick={() => setIsExcited(!isExcited)}
          className={cn(
            "w-full px-4 py-3 border rounded-2xl flex items-center justify-center gap-2 transition-all",
            isExcited ? "bg-wine/10 border-wine/30 text-wine" : "bg-stone-50 border-stone-200 text-stone-400"
          )}
        >
          <Zap className={cn("w-5 h-5", isExcited && "fill-current")} />
          {isExcited ? "On the Most Excited shelf" : "Pin to Most Excited For"}
        </button>

        {/* Vibe Tags */}
        <div className="space-y-3">
          <label className="text-sm font-bold text-stone-700">Vibe Tags</label>
          <div className="flex flex-wrap gap-2 min-h-[40px] p-3 bg-stone-50 border border-stone-200 rounded-2xl">
            {tags.map(tag => (
              <span key={tag} className="px-3 py-1 bg-amber-50 border border-amber-100 text-gold rounded-full text-xs font-medium flex items-center gap-2">
                {tag}
                <button
                  type="button"
                  onClick={() => setTags(tags.filter(t => t !== tag))}
                  className="text-amber-300 hover:text-red-500"
                >
                  <XCircle className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="cozy, revenge-arc, cried..."
              className="bg-transparent text-xs outline-none flex-1 min-w-[100px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
            />
          </div>
          {tagInput.trim() !== '' && tagSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tagSuggestions.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addTag(t)}
                  className="px-3 py-1 bg-white border border-stone-200 rounded-full text-xs text-stone-500 hover:border-amber-300 hover:text-gold transition-all"
                >
                  + {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-stone-700">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl outline-none focus:ring-2 focus:ring-amber-500 min-h-[100px] resize-none"
            placeholder="Add your thoughts, review, or progress..."
          />
        </div>
      </div>

      <div className="p-6 border-t border-stone-100 bg-stone-50/50 flex gap-3">
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
          {editingItem ? 'Save Changes' : 'Add Entry'}
        </button>
      </div>
    </form>
  );
}
