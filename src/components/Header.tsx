import { LibraryBig, LogOut, Settings } from 'lucide-react';
import { logout, User } from '../firebase';

export function Header({
  user,
  activePage,
  onNavigate,
  onOpenSettings,
}: {
  user: User;
  activePage: 'continue' | 'shelves';
  onNavigate: (page: 'continue' | 'shelves') => void;
  onOpenSettings: () => void;
}) {
  const firstName = user.displayName?.split(' ')[0];
  const tab = (page: 'continue' | 'shelves', label: string) => (
    <button
      onClick={() => onNavigate(page)}
      className={
        activePage === page
          ? "text-sm font-bold text-wine border-b-2 border-wine pb-[19px] -mb-[21px]"
          : "text-sm font-medium text-stone-500 hover:text-stone-700 pb-[19px] -mb-[21px] border-b-2 border-transparent"
      }
    >
      {label}
    </button>
  );
  return (
    <header className="sticky top-0 z-30 bg-cream/85 backdrop-blur-md border-b border-shelfline">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-2.5">
            <LibraryBig className="w-7 h-7 text-gold" />
            <span className="font-serif text-xl font-semibold hidden xs:block sm:block">
              {firstName ? `${firstName}’s ` : 'My '}<span className="text-gold">Library</span>
            </span>
            <nav className="flex items-center gap-5 ml-4 sm:ml-8">
              {tab('continue', 'Continue')}
              {tab('shelves', 'Shelves')}
            </nav>
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
