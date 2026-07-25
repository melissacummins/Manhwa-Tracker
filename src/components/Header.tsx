import { CheckCircle2, LogOut, Settings } from 'lucide-react';
import { logout, User } from '../firebase';

export function Header({ user, onOpenSettings }: { user: User; onOpenSettings: () => void }) {
  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-indigo-600" />
            <span className="text-xl font-bold hidden sm:block">Manhwa Tracker</span>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={onOpenSettings}
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
  );
}
