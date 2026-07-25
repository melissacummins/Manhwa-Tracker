import { LibraryBig, LogOut, Settings } from 'lucide-react';
import { logout, User } from '../firebase';

export function Header({ user, onOpenSettings }: { user: User; onOpenSettings: () => void }) {
  const firstName = user.displayName?.split(' ')[0];
  return (
    <header className="sticky top-0 z-30 bg-cream/85 backdrop-blur-md border-b border-shelfline">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-2.5">
            <LibraryBig className="w-7 h-7 text-gold" />
            <span className="font-serif text-xl font-semibold">
              {firstName ? `${firstName}’s ` : 'My '}<span className="text-gold">Library</span>
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={onOpenSettings}
              className="p-2 text-stone-500 hover:bg-stone-100 rounded-xl transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
            <div className="h-8 w-px bg-stone-200" />
            <div className="flex items-center gap-3">
              <img
                src={user.photoURL || ''}
                alt={user.displayName || ''}
                className="w-8 h-8 rounded-full border border-stone-200"
                referrerPolicy="no-referrer"
              />
              <button
                onClick={logout}
                className="hidden sm:flex items-center gap-2 text-sm font-medium text-stone-600 hover:text-red-600 transition-colors"
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
