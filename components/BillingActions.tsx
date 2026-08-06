'use client';

import { useState } from 'react';

export default function BillingActions({ hasSubscription }: { hasSubscription: boolean }) {
  const [loading, setLoading] = useState(false);

  async function goToCheckout() {
    setLoading(true);
    const res = await fetch('/api/stripe/checkout', { method: 'POST' });
    const { url } = await res.json();
    if (url) window.location.href = url;
    setLoading(false);
  }

  async function goToPortal() {
    setLoading(true);
    const res = await fetch('/api/stripe/portal', { method: 'POST' });
    const { url } = await res.json();
    if (url) window.location.href = url;
    setLoading(false);
  }

  return hasSubscription ? (
    <button onClick={goToPortal} disabled={loading} className="btn-secondary w-full">
      {loading ? 'Loading...' : 'Subscription Manage Karein'}
    </button>
  ) : (
    <button onClick={goToCheckout} disabled={loading} className="btn-primary w-full">
      {loading ? 'Loading...' : 'Subscribe Karein'}
    </button>
  );
}
