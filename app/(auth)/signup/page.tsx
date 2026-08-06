'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [shopName, setShopName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: signErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { shop_name: shopName || 'Meri Dukaan', full_name: fullName }
      }
    });

    if (signErr) {
      setError(signErr.message);
      setLoading(false);
      return;
    }

    // If email confirmation is off, session exists immediately
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSignup} className="card w-full max-w-sm p-7">
        <div className="font-display text-2xl font-700 text-haldi mb-1">Naya Account</div>
        <div className="text-chalkdim text-sm mb-6">14 din free trial — koi card nahi chahiye</div>

        {error && <div className="text-mirch text-sm mb-4 bg-mirch/10 p-3 rounded-lg">{error}</div>}

        <label className="block text-xs text-chalkdim mb-1">Dukaan ka naam</label>
        <input className="input mb-4" value={shopName} onChange={e => setShopName(e.target.value)} placeholder="Chachu Kiryana Store" />

        <label className="block text-xs text-chalkdim mb-1">Aap ka naam</label>
        <input className="input mb-4" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Aap ka naam" />

        <label className="block text-xs text-chalkdim mb-1">Email</label>
        <input className="input mb-4" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />

        <label className="block text-xs text-chalkdim mb-1">Password</label>
        <input className="input mb-6" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Kam se kam 6 characters" />

        <button disabled={loading} className="btn-primary w-full mb-4">
          {loading ? 'Bana rahe hain...' : 'Account Banayein'}
        </button>

        <div className="text-center text-sm text-chalkdim">
          Pehle se account hai? <Link href="/login" className="text-haldi">Login karein</Link>
        </div>
      </form>
    </main>
  );
}
