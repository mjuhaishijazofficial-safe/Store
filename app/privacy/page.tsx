import Link from 'next/link';
import { getServerT } from '@/lib/i18n-server';

export default async function PrivacyPage() {
  const t = await getServerT();

  const sections = [
    { title: t('privacy.s1Title'), body: t('privacy.s1Body') },
    { title: t('privacy.s2Title'), body: t('privacy.s2Body') },
    { title: t('privacy.s3Title'), body: t('privacy.s3Body') },
    { title: t('privacy.s4Title'), body: t('privacy.s4Body') }
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
    </main>
  );
}
