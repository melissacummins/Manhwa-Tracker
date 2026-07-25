import React from 'react';
import { Database, Download, Upload, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { db, doc, updateDoc, User } from '../firebase';
import { UserConfig } from '../types';

export function SettingsModal({
  user,
  settings,
  onClose,
  onExport,
  onImport,
  onMigrate,
}: {
  user: User;
  settings: UserConfig | null;
  onClose: () => void;
  onExport: () => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onMigrate: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="p-6 border-b border-stone-100 flex justify-between items-center">
          <h2 className="font-serif text-xl font-bold">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full">
            <XCircle className="w-6 h-6 text-stone-400" />
          </button>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-sm font-bold text-stone-500 uppercase tracking-wider mb-4">Status Colors</h3>
            <div className="space-y-3">
              {settings && Object.entries(settings.statusConfig).map(([status, color]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{status}</span>
                  <input
                    type="color"
                    value={color}
                    onChange={async (e) => {
                      const newConfig = { ...settings.statusConfig, [status]: e.target.value };
                      await updateDoc(doc(db, 'users', user.uid, 'settings', 'config'), { statusConfig: newConfig });
                    }}
                    className="w-8 h-8 rounded cursor-pointer"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="pt-6 border-t border-stone-100">
            <h3 className="text-sm font-bold text-stone-500 uppercase tracking-wider mb-4">Data Management</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={onExport}
                className="btn-secondary flex items-center justify-center gap-2 py-3"
              >
                <Download className="w-4 h-4" />
                Export JSON
              </button>
              <label className="btn-secondary flex items-center justify-center gap-2 py-3 cursor-pointer">
                <Upload className="w-4 h-4" />
                Import JSON
                <input type="file" accept=".json" onChange={onImport} className="hidden" />
              </label>
            </div>
            <button
              onClick={onMigrate}
              className="btn-secondary w-full mt-3 flex items-center justify-center gap-2 py-3"
            >
              <Database className="w-4 h-4" />
              Migrate legacy manhwa data
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
