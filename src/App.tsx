import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  MoreVertical, 
  Star, 
  Trash2, 
  Edit2, 
  Download, 
  Upload, 
  LogOut, 
  LogIn,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Settings,
  RefreshCw,
  Copy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  login, 
  logout, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy,
  User,
  handleFirestoreError,
  OperationType
} from './firebase';
import { GoogleGenAI } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface Manhwa {
  id: string;
  title: string;
  alternativeTitles: string[];
  status: string;
  isFavorite: boolean;
  notes: string;
  createdAt: any;
  updatedAt: any;
  userId: string;
}

interface UserSettings {
  statusConfig: Record<string, string>;
  userId: string;
}

const DEFAULT_STATUSES = {
  'Reading': '#3b82f6', // Blue
  'Completed': '#10b981', // Emerald
  'On Hold': '#f59e0b', // Amber
  'Dropped': '#ef4444', // Red
  'Plan to Read': '#6366f1', // Indigo
};

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
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-12 max-w-md w-full text-center"
        >
          <div className="w-20 h-20 bg-indigo-100 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <CheckCircle2 className="w-10 h-10 text-indigo-600" />
          </div>
          <h1 className="text-3xl font-bold mb-4">Manhwa Tracker</h1>
          <p className="text-slate-600 mb-8">
            Keep track of your entire manhwa collection in one place. Sync across devices and never lose your progress.
          </p>
          <button 
            onClick={login}
            className="btn-primary w-full flex items-center justify-center gap-2 py-4 text-lg"
          >
            <LogIn className="w-5 h-5" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-indigo-600" />
              <span className="text-xl font-bold hidden sm:block">Manhwa Tracker</span>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-4">
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <Settings className="w-5 h-5" />
              </button>
              <div className="h-8 w-px bg-slate-200" />
              <div className="flex items-center gap-3">
                <img 
                  src={user.photoURL || ''} 
                  alt={user.displayName || ''} 
                  className="w-8 h-8 rounded-full border border-slate-200"
                  referrerPolicy="no-referrer"
                />
                <button 
                  onClick={logout}
                  className="hidden sm:flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-red-600 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

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

        {/* Stats Summary */}
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

        {/* List */}
        <div className="grid grid-cols-1 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredManhwas.map((manhwa) => (
              <motion.div 
                key={manhwa.id}
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
                    onClick={() => {
                      setEditingManhwa(manhwa);
                      setIsAddModalOpen(true);
                    }}
                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => handleDelete(manhwa.id)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
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
              <ManhwaForm 
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                <h2 className="text-xl font-bold">Settings</h2>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-slate-100 rounded-full">
                  <XCircle className="w-6 h-6 text-slate-400" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Status Colors</h3>
                  <div className="space-y-3">
                    {settings && Object.entries(settings.statusConfig).map(([status, color]) => (
                      <div key={status} className="flex items-center justify-between">
                        <span className="text-sm font-medium">{status}</span>
                        <input 
                          type="color" 
                          value={color}
                          onChange={async (e) => {
                            const newConfig = { ...settings.statusConfig, [status]: e.target.value };
                            await updateDoc(doc(db, 'userSettings', user.uid), { statusConfig: newConfig });
                          }}
                          className="w-8 h-8 rounded cursor-pointer"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-100">
                  <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Data Management</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={handleExport}
                      className="btn-secondary flex items-center justify-center gap-2 py-3"
                    >
                      <Download className="w-4 h-4" />
                      Export JSON
                    </button>
                    <label className="btn-secondary flex items-center justify-center gap-2 py-3 cursor-pointer">
                      <Upload className="w-4 h-4" />
                      Import JSON
                      <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                    </label>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Form Component
function ManhwaForm({ 
  user, 
  existingManhwas, 
  settings, 
  editingManhwa, 
  onClose 
}: { 
  user: User, 
  existingManhwas: Manhwa[], 
  settings: UserSettings | null,
  editingManhwa: Manhwa | null,
  onClose: () => void 
}) {
  const [title, setTitle] = useState(editingManhwa?.title || '');
  const [altTitles, setAltTitles] = useState<string[]>(editingManhwa?.alternativeTitles || []);
  const [status, setStatus] = useState(editingManhwa?.status || 'Plan to Read');
  const [isFavorite, setIsFavorite] = useState(editingManhwa?.isFavorite || false);
  const [notes, setNotes] = useState(editingManhwa?.notes || '');
  const [isSearchingAlt, setIsSearchingAlt] = useState(false);
  const [duplicateFound, setDuplicateFound] = useState<Manhwa | null>(null);

  // Gemini AI for alternative titles
  const fetchAltTitles = async () => {
    if (!title) return;
    setIsSearchingAlt(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `List alternative names for the manhwa titled "${title}". Return ONLY a comma-separated list of names. If none found, return "None".`,
      });
      const text = response.text || '';
      if (text !== 'None') {
        const names = text.split(',').map(n => n.trim()).filter(n => n && n.toLowerCase() !== title.toLowerCase());
        setAltTitles(Array.from(new Set([...altTitles, ...names])));
      }
    } catch (err) {
      console.error('AI Error:', err);
    } finally {
      setIsSearchingAlt(false);
    }
  };

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
          <div className="flex justify-between items-center">
            <label className="text-sm font-bold text-slate-700">Alternative Titles</label>
            <button 
              type="button"
              onClick={fetchAltTitles}
              disabled={isSearchingAlt || !title}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-50"
            >
              {isSearchingAlt ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              AI Fetch Names
            </button>
          </div>
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
