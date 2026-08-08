import Link from 'next/link';
import type { Metadata } from 'next';
import { getServerT } from '@/lib/i18n-server';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Dukaan ERP aap ka data kaise mehfooz rakhta hai, kya store karta hai, aur delete karne ka tareeqa.',
  alternates: { canonical: '/privacy' }
};

export default async function PrivacyPage() {
  const t = await getServerT();

  const sections = [
    { title: t('privacy.s1Title'), body: t('privacy.s1Body') },
    { title: t('privacy.s2Title'), body: t('privacy.s2Body') },
    { title: t('privacy.s3Title'), body: t('privacy.s3Body') },
    { title: t('privacy.s4Title'), body: t('privacy.s4Body') },
    { title: t('privacy.s5Title'), body: t('privacy.s5Body') }
  ];

  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <Link href="/" className="text-xs text-chalkdim hover:text-haldi">{t('legal.back')}</Link>
      <h1 className="font-display text-3xl font-800 text-haldi mt-3 mb-1">{t('privacy.title')}</h1>
      <p className="text-chalkdim text-xs mb-8">{t('legal.lastUpdated')} August 2026</p>

      <div className="space-y-6">
        {sections.map(s => (
          <div key={s.title}>
            <h2 className="font-display text-lg font-700 mb-1">{s.title}</h2>
            <p className="text-chalkdim text-sm">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="card p-4 mt-10 text-xs text-chalkdim">{t('privacy.disclaimer')}</div>

      {/* The legal pages were only ever linked from the landing footer,
          leaving them as near-dead ends. Linking them to each other and
          back to signup keeps crawl paths (and readers) moving. */}
      <nav className="flex flex-wrap gap-4 mt-8 pt-6 border-t border-chalk/10 text-xs text-chalkdim">
        <Link href="/terms" className="hover:text-haldi">{t('landing.footerTerms')}</Link>
        <Link href="/signup" className="hover:text-haldi">{t('landing.freeTrialNav')}</Link>
        <Link href="/login" className="hover:text-haldi">{t('landing.login')}</Link>
      </nav>
    </main>
  );
}
