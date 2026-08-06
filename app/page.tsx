import Link from 'next/link';

export default function Home() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-16">
      <div className="flex items-center justify-between mb-20">
        <div className="font-display text-2xl font-800 text-haldi">Dukaan ERP</div>
        <div className="flex gap-3">
          <Link href="/login" className="btn-secondary text-sm">Login</Link>
          <Link href="/signup" className="btn-primary text-sm">Free Trial Shuru Karein</Link>
        </div>
      </div>

      <section className="text-center mb-20">
        <h1 className="font-display text-5xl font-800 leading-tight mb-6">
          Apni Dukaan ka <span className="text-haldi">Poora Hisaab</span><br />Phone Par
        </h1>
        <p className="text-chalkdim text-lg max-w-xl mx-auto mb-8">
          Stock, budget, purchases aur bikri — sab digital, sab live. 14 din free trial, phir mahana subscription.
        </p>
        <Link href="/signup" className="btn-primary text-base inline-block">Abhi Shuru Karein — Free</Link>
      </section>

      <section className="grid md:grid-cols-3 gap-6 mb-20">
        {[
          { t: 'Stock Tracking', d: 'Kitna saman hai, kitna baki hai — real-time.' },
          { t: 'Reorder Alerts', d: 'Jo saman kam ho jaye, automatically list mein aa jaye.' },
          { t: 'Budget Control', d: 'Kitna kharch hua, kitna baki budget hai — ek nazar mein.' }
        ].map(f => (
          <div key={f.t} className="card p-6">
            <div className="font-display text-lg font-700 text-haldi mb-2">{f.t}</div>
            <div className="text-chalkdim text-sm">{f.d}</div>
          </div>
        ))}
      </section>

      <section className="card p-10 text-center max-w-md mx-auto">
        <div className="font-display text-xl font-700 mb-2">Simple Pricing</div>
        <div className="font-mono text-4xl font-700 text-haldi mb-1">₨999<span className="text-base text-chalkdim">/mahina</span></div>
        <div className="text-chalkdim text-sm mb-6">Per dukaan. 14 din free trial, koi card nahi chahiye.</div>
        <Link href="/signup" className="btn-primary block">Free Trial Shuru Karein</Link>
      </section>
    </main>
  );
}
