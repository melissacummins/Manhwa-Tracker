import { CheckCircle2, LogIn } from 'lucide-react';
import { motion } from 'motion/react';
import { login } from '../firebase';

export function LoginScreen() {
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
