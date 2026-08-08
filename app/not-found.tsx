import Link from 'next/link';
import { getServerT } from '@/lib/i18n-server';

export default async function NotFound() {
  const t = await getServerT();

  return (
    <main className="min-h-screen flex items-center justify-center px-6 text-center">
      <div>
        <div className="font-display text-6xl font-800 text-haldi mb-4">404</div>
        <h1 className="font-display text-2xl font-700 mb-2">{t('notFound.title')}</h1>
        <p className="text-chalkdim text-sm max-w-sm mx-auto mb-8">{t('notFound.body')}</p>
        <Link href="/" className="btn-primary inline-block">{t('notFound.home')}</Link>
      </div>
    </main>
  );
}
