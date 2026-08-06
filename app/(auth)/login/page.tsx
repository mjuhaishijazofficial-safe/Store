'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signErr) {
      setError(signErr.message);
      setLoading(false);
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleLogin} className="card w-full max-w-sm p-7">
        <div className="font-display text-2xl font-700 text-haldi mb-6">Login</div>

        {error && <div className="text-mirch text-sm mb-4 bg-mirch/10 p-3 rounded-lg">{error}</div>}

        <label className="block text-xs text-chalkdim mb-1">Email</label>
        <input className="input mb-4" type="email" required value={email} onChange={e => setEmail(e.target.value)} />

        <label className="block text-xs text-chalkdim mb-1">Password</label>
        <input className="input mb-6" type="password" required value={password} onChange={e => setPassword(e.target.value)} />

        <button disabled={loading} className="btn-primary w-full mb-4">
          {loading ? 'Login ho raha hai...' : 'Login Karein'}
        </button>

        <div className="text-center text-sm text-chalkdim">
          Account nahi hai? <Link href="/signup" className="text-haldi">Free trial shuru karein</Link>
        </div>
      </form>
    </main>
  );
}
