import Link from 'next/link';
import { getServerT } from '@/lib/i18n-server';

export default async function TermsPage() {
  const t = await getServerT();

  const sections = [
    { title: t('terms.s1Title'), body: t('terms.s1Body') },
    { title: t('terms.s2Title'), body: t('terms.s2Body') },
    { title: t('terms.s3Title'), body: t('terms.s3Body') },
    { title: t('terms.s4Title'), body: t('terms.s4Body') },
    { title: t('terms.s5Title'), body: t('terms.s5Body') }
  ];

  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <Link href="/" className="text-xs text-chalkdim hover:text-haldi">{t('legal.back')}</Link>
      <h1 className="font-display text-3xl font-800 text-haldi mt-3 mb-1">{t('terms.title')}</h1>
      <p className="text-chalkdim text-xs mb-8">{t('legal.lastUpdated')} August 2026</p>

      <div className="space-y-6">
        {sections.map(s => (
          <div key={s.title}>
            <h2 className="font-display text-lg font-700 mb-1">{s.title}</h2>
            <p className="text-chalkdim text-sm">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="card p-4 mt-10 text-xs text-chalkdim">{t('terms.disclaimer')}</div>
    </main>
  );
}
