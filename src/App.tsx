import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
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
  where,
  orderBy,
  User,
  handleFirestoreError,
  OperationType
} from './firebase';
import { Manhwa, UserSettings, DEFAULT_STATUSES } from './types';
import { Header } from './components/Header';
import { LoginScreen } from './components/LoginScreen';
import { StatsBar } from './components/StatsBar';
import { MediaCard } from './components/MediaCard';
import { MediaForm } from './components/MediaForm';
import { SettingsModal } from './components/SettingsModal';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [manhwas, setManhwas] = useState<Manhwa[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingManhwa, setEditingManhwa] = useState<Manhwa | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

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
      setManhwas([]);
      setSettings(null);
      return;
    }

    // Settings Listener
    const settingsRef = doc(db, 'userSettings', user.uid);
    const unsubscribeSettings = onSnapshot(settingsRef, (doc) => {
      if (doc.exists()) {
        setSettings(doc.data() as UserSettings);
      } else {
        // Initialize default settings
        const initialSettings: UserSettings = {
          statusConfig: DEFAULT_STATUSES,
          userId: user.uid
        };
        setDoc(settingsRef, initialSettings).catch(e => handleFirestoreError(e, OperationType.WRITE, 'userSettings'));
      }
    }, (e) => handleFirestoreError(e, OperationType.GET, 'userSettings'));

    // Manhwas Listener
    const manhwasRef = collection(db, 'manhwas');
    const q = query(manhwasRef, where('userId', '==', user.uid), orderBy('title', 'asc'));
    const unsubscribeManhwas = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Manhwa));
      setManhwas(data);
    }, (e) => handleFirestoreError(e, OperationType.GET, 'manhwas'));

    return () => {
      unsubscribeSettings();
      unsubscribeManhwas();
    };
  }, [user]);

  // Filtering and Sorting
  const filteredManhwas = useMemo(() => {
    let result = manhwas.filter(m =>
      (m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
       m.alternativeTitles.some(alt => alt.toLowerCase().includes(searchQuery.toLowerCase()))) &&
      (statusFilter === 'All' || m.status === statusFilter)
    );

    if (sortOrder === 'desc') {
      result = [...result].reverse();
    }

    return result;
  }, [manhwas, searchQuery, statusFilter, sortOrder]);

  // Actions
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;
    try {
      await deleteDoc(doc(db, 'manhwas', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'manhwas');
    }
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(manhwas, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'manhwa-tracker-backup.json';
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string) as Manhwa[];
        for (const item of importedData) {
          const { id, ...data } = item;
          const newDocRef = doc(collection(db, 'manhwas'));
          await setDoc(newDocRef, {
            ...data,
            userId: user.uid,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
        alert('Import successful!');
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
        <div className="flex flex-col md:flex-row gap-4 mb-8">
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

          <div className="flex gap-2">
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

            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Add Manhwa
            </button>
          </div>
        </div>

        <StatsBar manhwas={manhwas} settings={settings} />

        {/* List */}
        <div className="grid grid-cols-1 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredManhwas.map((manhwa) => (
              <MediaCard
                key={manhwa.id}
                manhwa={manhwa}
                settings={settings}
                onEdit={() => {
                  setEditingManhwa(manhwa);
                  setIsAddModalOpen(true);
                }}
                onDelete={() => handleDelete(manhwa.id)}
              />
            ))}
          </AnimatePresence>

          {filteredManhwas.length === 0 && (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-300">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-medium text-slate-900">No manhwas found</h3>
              <p className="text-slate-500">Try adjusting your search or filters</p>
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
                setEditingManhwa(null);
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
                existingManhwas={manhwas}
                settings={settings}
                editingManhwa={editingManhwa}
                onClose={() => {
                  setIsAddModalOpen(false);
                  setEditingManhwa(null);
                }}
              />
            </motion.div>
          </div>
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
