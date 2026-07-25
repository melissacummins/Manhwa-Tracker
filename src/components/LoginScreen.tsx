import { CheckCircle2, LogIn } from 'lucide-react';
import { motion } from 'motion/react';
import { login } from '../firebase';

export function LoginScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-12 max-w-md w-full text-center"
      >
        <div className="w-20 h-20 bg-amber-100 rounded-3xl flex items-center justify-center mx-auto mb-8">
          <CheckCircle2 className="w-10 h-10 text-gold" />
        </div>
        <h1 className="font-serif text-3xl font-bold mb-4">The Library</h1>
        <p className="text-stone-600 mb-8">
          Every manhwa, show, and movie you love — on one shelf, with covers. Sign in to open yours.
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
