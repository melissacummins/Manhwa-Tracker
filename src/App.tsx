import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, ChevronDown, ChevronUp, LayoutGrid, List, RefreshCw, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  serverTimestamp,
  User,
  handleFirestoreError,
  OperationType
} from './firebase';
import { MediaItem, MediaType, MEDIA_TYPES, UserConfig, DEFAULT_STATUSES, normalizeTitle } from './types';
import { cn } from './lib/utils';
import { Header } from './components/Header';
import { LoginScreen } from './components/LoginScreen';
import { StatsBar } from './components/StatsBar';
import { MediaCard } from './components/MediaCard';
import { MediaForm } from './components/MediaForm';
import { NostalgiaModal } from './components/NostalgiaModal';
import { SettingsModal } from './components/SettingsModal';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [settings, setSettings] = useState<UserConfig | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<MediaType | 'All'>('All');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isNostalgiaOpen, setIsNostalgiaOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [view, setView] = useState<'list' | 'grid'>(
    () => (localStorage.getItem('cc-view') === 'grid' ? 'grid' : 'list')
  );

  const setViewPersisted = (v: 'list' | 'grid') => {
    setView(v);
    localStorage.setItem('cc-view', v);
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Data Listeners
  useEffect(() => {
    if (!user) {
      setItems([]);
      setSettings(null);
      return;
    }

    // Settings Listener
    const settingsRef = doc(db, 'users', user.uid, 'settings', 'config');
    const unsubscribeSettings = onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        setSettings(snap.data() as UserConfig);
      } else {
        const initialSettings: UserConfig = { statusConfig: DEFAULT_STATUSES };
        setDoc(settingsRef, initialSettings).catch(e => handleFirestoreError(e, OperationType.WRITE, 'users/settings'));
      }
    }, (e) => handleFirestoreError(e, OperationType.GET, 'users/settings'));

    // Media Listener
    const mediaRef = collection(db, 'users', user.uid, 'media');
    const q = query(mediaRef, orderBy('title', 'asc'));
    const unsubscribeMedia = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MediaItem));
      setItems(data);
    }, (e) => handleFirestoreError(e, OperationType.GET, 'users/media'));

    return () => {
      unsubscribeSettings();
      unsubscribeMedia();
    };
  }, [user]);

  // Filtering and Sorting
  const typeFiltered = useMemo(
    () => typeFilter === 'All' ? items : items.filter(m => m.mediaType === typeFilter),
    [items, typeFilter]
  );

  const allTags = useMemo(
    () => Array.from(new Set(items.flatMap(m => m.tags || []))).sort(),
    [items]
  );

  const nostalgiaPool = useMemo(
    () => items.filter(m => m.isFavorite || m.wouldRevisit),
    [items]
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let result = typeFiltered.filter(m =>
      (m.title.toLowerCase().includes(q) ||
       m.alternativeTitles.some(alt => alt.toLowerCase().includes(q))) &&
      (statusFilter === 'All' || m.status === statusFilter) &&
      tagFilter.every(t => (m.tags || []).includes(t))
    );

    if (sortOrder === 'desc') {
      result = [...result].reverse();
    }

    return result;
  }, [typeFiltered, searchQuery, statusFilter, tagFilter, sortOrder]);

  // Actions
  const handleDelete = async (id: string) => {
    if (!user || !confirm('Are you sure you want to delete this entry?')) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'media', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'users/media');
    }
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(items, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const date = new Date().toISOString().slice(0, 10);
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', `command-center-backup-${date}.json`);
    linkElement.click();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string) as Partial<MediaItem>[];
        if (!Array.isArray(importedData)) throw new Error('Not an array');

        // Dedupe against existing items by normalized title (both directions)
        const existing = new Set<string>();
        for (const m of items) {
          existing.add(normalizeTitle(m.title));
          m.alternativeTitles.forEach(a => existing.add(normalizeTitle(a)));
        }

        const mediaRef = collection(db, 'users', user.uid, 'media');
        let imported = 0;
        let skipped = 0;
        let batch = writeBatch(db);
        let batchCount = 0;

        for (const item of importedData) {
          if (!item.title || typeof item.title !== 'string') { skipped++; continue; }
          const names = [item.title, ...(item.alternativeTitles || [])].map(normalizeTitle);
          if (names.some(n => existing.has(n))) { skipped++; continue; }
          names.forEach(n => existing.add(n));

          const { id, createdAt, updatedAt, ...rest } = item;
          batch.set(doc(mediaRef), {
            mediaType: item.mediaType || 'manhwa',
            alternativeTitles: [],
            coverUrl: null,
            isFavorite: false,
            wouldRevisit: false,
            rating: null,
            tags: [],
            year: null,
            externalIds: {},
            notes: '',
            ...rest,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          imported++;
          batchCount++;
          if (batchCount >= 450) {
            await batch.commit();
            batch = writeBatch(db);
            batchCount = 0;
          }
        }
        if (batchCount > 0) await batch.commit();
        alert(`Import complete: ${imported} added, ${skipped} skipped (duplicates or invalid).`);
      } catch (err) {
        alert('Failed to import data. Please check the file format.');
      }
    };
    reader.readAsText(file);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <RefreshCw className="w-8 h-8 text-indigo-600" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header user={user} onOpenSettings={() => setIsSettingsOpen(true)} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Controls */}
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by title or alternative name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="All">All Statuses</option>
              {settings && Object.keys(settings.statusConfig).map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>

            <button
              onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="btn-secondary flex items-center gap-2"
            >
              {sortOrder === 'asc' ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              Sort
            </button>

            <div className="flex rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <button
                onClick={() => setViewPersisted('list')}
                className={cn("px-3 py-3", view === 'list' ? "bg-indigo-50 text-indigo-600" : "text-slate-400 hover:text-slate-600")}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewPersisted('grid')}
                className={cn("px-3 py-3", view === 'grid' ? "bg-indigo-50 text-indigo-600" : "text-slate-400 hover:text-slate-600")}
                title="Shelf view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={() => setIsNostalgiaOpen(true)}
              disabled={nostalgiaPool.length === 0}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
              title="Pick something nostalgic"
            >
              <Sparkles className="w-4 h-4 text-indigo-500" />
              <span className="hidden sm:inline">Nostalgia</span>
            </button>

            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Add
            </button>
          </div>
        </div>

        {/* Media Type Filter */}
        <div className="flex flex-wrap gap-2 mb-8">
          <button
            onClick={() => setTypeFilter('All')}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
              typeFilter === 'All'
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "bg-white border-slate-200 text-slate-500 hover:border-indigo-300"
            )}
          >
            All
          </button>
          {MEDIA_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                typeFilter === t.value
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "bg-white border-slate-200 text-slate-500 hover:border-indigo-300"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tag Filter */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-8 -mt-4">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vibes:</span>
            {allTags.map(t => (
              <button
                key={t}
                onClick={() => setTagFilter(prev =>
                  prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
                )}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                  tagFilter.includes(t)
                    ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                    : "bg-white border-slate-200 text-slate-500 hover:border-indigo-300"
                )}
              >
                {t}
              </button>
            ))}
            {tagFilter.length > 0 && (
              <button onClick={() => setTagFilter([])} className="text-xs text-slate-400 hover:text-slate-600 underline">
                clear
              </button>
            )}
          </div>
        )}

        <StatsBar items={typeFiltered} settings={settings} />

        {/* List / Shelf */}
        <div className={cn(
          view === 'grid'
            ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
            : "grid grid-cols-1 gap-4"
        )}>
          <AnimatePresence mode="popLayout">
            {filteredItems.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                settings={settings}
                view={view}
                onEdit={() => {
                  setEditingItem(item);
                  setIsAddModalOpen(true);
                }}
                onDelete={() => handleDelete(item.id)}
              />
            ))}
          </AnimatePresence>

          {filteredItems.length === 0 && (
            <div className="col-span-full text-center py-20 bg-white rounded-3xl border border-dashed border-slate-300">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-medium text-slate-900">Nothing here yet</h3>
              <p className="text-slate-500">Try adjusting your search or filters, or add something new</p>
            </div>
          )}
        </div>
      </main>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsAddModalOpen(false);
                setEditingItem(null);
              }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
            >
              <MediaForm
                user={user}
                existingItems={items}
                allTags={allTags}
                settings={settings}
                editingItem={editingItem}
                onClose={() => {
                  setIsAddModalOpen(false);
                  setEditingItem(null);
                }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Nostalgia Modal */}
      <AnimatePresence>
        {isNostalgiaOpen && (
          <NostalgiaModal pool={nostalgiaPool} onClose={() => setIsNostalgiaOpen(false)} />
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <SettingsModal
            user={user}
            settings={settings}
            onClose={() => setIsSettingsOpen(false)}
            onExport={handleExport}
            onImport={handleImport}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
