import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { Plus, Search, LayoutGrid, List, RefreshCw, Sparkles } from 'lucide-react';
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
import { DetailModal } from './components/DetailModal';
import { Header } from './components/Header';
import { LoginScreen } from './components/LoginScreen';
import { TopShelf } from './components/TopShelf';
import { StatsBar } from './components/StatsBar';
import { MediaCard } from './components/MediaCard';
import { MediaForm } from './components/MediaForm';
import { MigrationModal } from './components/MigrationModal';
import { NostalgiaModal } from './components/NostalgiaModal';
import { SettingsModal } from './components/SettingsModal';

// Restore browsing state after a reload — phone browsers discard background
// tabs, and without this the search and filters reset every time you return.
const UI_STATE_KEY = 'cc-ui-state';
function loadUiState(): Record<string, any> {
  try {
    return JSON.parse(sessionStorage.getItem(UI_STATE_KEY) || '{}');
  } catch {
    return {};
  }
}

const PAGE_SIZE = 120;

export default function App() {
  const savedUi = useMemo(loadUiState, []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [settings, setSettings] = useState<UserConfig | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>(savedUi.searchQuery || '');
  const [statusFilter, setStatusFilter] = useState<string>(savedUi.statusFilter || 'All');
  const [typeFilter, setTypeFilter] = useState<MediaType | 'All'>(savedUi.typeFilter || 'All');
  const [tagFilter, setTagFilter] = useState<string[]>(Array.isArray(savedUi.tagFilter) ? savedUi.tagFilter : []);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isNostalgiaOpen, setIsNostalgiaOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMigrationOpen, setIsMigrationOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [detailItem, setDetailItem] = useState<MediaItem | null>(null);
  const [sortBy, setSortBy] = useState<'title-asc' | 'title-desc' | 'updated' | 'added' | 'year'>(savedUi.sortBy || 'title-asc');
  const [letterFilter, setLetterFilter] = useState<string>(savedUi.letterFilter || 'All');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Filtering waits for a typing pause instead of running on every keystroke
  const deferredQuery = useDeferredValue(searchQuery);

  // Persist browsing state so a tab reload puts you back where you were
  useEffect(() => {
    try {
      sessionStorage.setItem(UI_STATE_KEY, JSON.stringify({
        searchQuery, statusFilter, typeFilter, tagFilter, sortBy, letterFilter,
      }));
    } catch { /* storage full or unavailable — browsing still works */ }
  }, [searchQuery, statusFilter, typeFilter, tagFilter, sortBy, letterFilter]);
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

  const readingItems = useMemo(
    () => items
      .filter(m => m.status === 'Reading')
      .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0)),
    [items]
  );

  const excitedItems = useMemo(
    () => items.filter(m => m.isExcited && m.status !== 'Reading'),
    [items]
  );

  const firstLetterOf = (title: string): string => {
    const c = normalizeTitle(title).charAt(0);
    return /[a-z]/.test(c) ? c.toUpperCase() : '#';
  };

  const availableLetters = useMemo(
    () => new Set(typeFiltered.map(m => firstLetterOf(m.title))),
    [typeFiltered]
  );

  // Precomputed lowercase haystack per item — rebuilt only when data changes,
  // so keystrokes don't pay the toLowerCase cost across 5,000+ alt titles.
  const searchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const m of items) {
      index.set(m.id, [m.title, ...m.alternativeTitles].join('\n').toLowerCase());
    }
    return index;
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const result = typeFiltered.filter(m =>
      (!q || (searchIndex.get(m.id) || '').includes(q)) &&
      (statusFilter === 'All' || m.status === statusFilter) &&
      (letterFilter === 'All' || firstLetterOf(m.title) === letterFilter) &&
      tagFilter.every(t => (m.tags || []).includes(t))
    );

    // Base order from Firestore is title A→Z
    switch (sortBy) {
      case 'title-desc': return [...result].reverse();
      case 'updated': return [...result].sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
      case 'added': return [...result].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      case 'year': return [...result].sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));
      default: return result;
    }
  }, [typeFiltered, deferredQuery, searchIndex, statusFilter, letterFilter, tagFilter, sortBy]);

  // Show results in pages — rendering all ~1,400 cards at once is what made
  // browsing feel slow, especially on phones.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [deferredQuery, statusFilter, typeFilter, letterFilter, tagFilter, sortBy]);
  const visibleItems = useMemo(() => filteredItems.slice(0, visibleCount), [filteredItems, visibleCount]);

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
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <RefreshCw className="w-8 h-8 text-gold" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <Header user={user} onOpenSettings={() => setIsSettingsOpen(true)} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <TopShelf reading={readingItems} excited={excitedItems} onOpen={setDetailItem} />

        {/* Controls */}
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -transtone-y-1/2 w-5 h-5 text-stone-400" />
            <input
              type="text"
              placeholder="Search by title or alternative name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white border border-stone-200 rounded-2xl focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all outline-none"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-stone-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="All">All Statuses</option>
              {settings && Object.keys(settings.statusConfig).map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="bg-white border border-stone-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-amber-500"
              title="Sort"
            >
              <option value="title-asc">A → Z</option>
              <option value="title-desc">Z → A</option>
              <option value="updated">Recently updated</option>
              <option value="added">Recently added</option>
              <option value="year">By year</option>
            </select>

            <div className="flex rounded-2xl border border-stone-200 bg-white overflow-hidden">
              <button
                onClick={() => setViewPersisted('list')}
                className={cn("px-3 py-3", view === 'list' ? "bg-amber-50 text-gold" : "text-stone-400 hover:text-stone-600")}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewPersisted('grid')}
                className={cn("px-3 py-3", view === 'grid' ? "bg-amber-50 text-gold" : "text-stone-400 hover:text-stone-600")}
                title="Shelf view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={() => setIsNostalgiaOpen(true)}
              disabled={nostalgiaPool.length === 0}
              className="btn-wine flex items-center gap-2 disabled:opacity-50"
              title="Pick something nostalgic"
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">Pick for me</span>
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
                ? "bg-gold border-gold text-white"
                : "bg-white border-stone-200 text-stone-500 hover:border-amber-300"
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
                  ? "bg-gold border-gold text-white"
                  : "bg-white border-stone-200 text-stone-500 hover:border-amber-300"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Starts-with letter strip */}
        <div className="flex flex-wrap items-center gap-1 mb-4 -mt-3">
          <button
            onClick={() => setLetterFilter('All')}
            className={cn(
              "px-2 py-1 rounded-md text-xs font-bold transition-all",
              letterFilter === 'All' ? "bg-walnut text-cream" : "text-stone-500 hover:bg-stone-100"
            )}
          >
            All
          </button>
          {['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(l => (
            <button
              key={l}
              onClick={() => setLetterFilter(letterFilter === l ? 'All' : l)}
              disabled={!availableLetters.has(l)}
              className={cn(
                "w-6 py-1 rounded-md text-xs font-bold transition-all",
                letterFilter === l
                  ? "bg-walnut text-cream"
                  : availableLetters.has(l)
                    ? "text-gold hover:bg-goldsoft"
                    : "text-stone-300 cursor-default"
              )}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Tag Filter */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-8 -mt-4">
            <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Vibes:</span>
            {allTags.map(t => (
              <button
                key={t}
                onClick={() => setTagFilter(prev =>
                  prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
                )}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                  tagFilter.includes(t)
                    ? "bg-amber-50 border-amber-300 text-gold"
                    : "bg-white border-stone-200 text-stone-500 hover:border-amber-300"
                )}
              >
                {t}
              </button>
            ))}
            {tagFilter.length > 0 && (
              <button onClick={() => setTagFilter([])} className="text-xs text-stone-400 hover:text-stone-600 underline">
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
          {visibleItems.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              settings={settings}
              view={view}
              onOpen={() => setDetailItem(item)}
              onEdit={() => {
                setEditingItem(item);
                setIsAddModalOpen(true);
              }}
              onDelete={() => handleDelete(item.id)}
            />
          ))}

          {filteredItems.length > visibleCount && (
            <div className="col-span-full flex justify-center pt-2">
              <button
                onClick={() => setVisibleCount(c => c + PAGE_SIZE * 2)}
                className="btn-secondary px-8"
              >
                Show more ({filteredItems.length - visibleCount} remaining)
              </button>
            </div>
          )}

          {filteredItems.length === 0 && (
            <div className="col-span-full text-center py-20 bg-white rounded-3xl border border-dashed border-stone-300">
              <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-stone-400" />
              </div>
              <h3 className="text-lg font-medium text-stone-900">Nothing here yet</h3>
              <p className="text-stone-500">Try adjusting your search or filters, or add something new</p>
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
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
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

      {/* Detail Modal */}
      <AnimatePresence>
        {detailItem && (
          <DetailModal
            item={items.find(m => m.id === detailItem.id) || detailItem}
            settings={settings}
            onClose={() => setDetailItem(null)}
            onEdit={() => {
              setEditingItem(items.find(m => m.id === detailItem.id) || detailItem);
              setDetailItem(null);
              setIsAddModalOpen(true);
            }}
            onDelete={() => {
              setDetailItem(null);
              handleDelete(detailItem.id);
            }}
          />
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
            onMigrate={() => {
              setIsSettingsOpen(false);
              setIsMigrationOpen(true);
            }}
          />
        )}
      </AnimatePresence>

      {/* Migration Modal */}
      <AnimatePresence>
        {isMigrationOpen && (
          <MigrationModal user={user} onClose={() => setIsMigrationOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
