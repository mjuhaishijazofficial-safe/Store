import type { Metadata } from 'next';
import './globals.css';
import { cookies } from 'next/headers';
import { LanguageProvider } from '@/lib/i18n-context';
import { DEFAULT_LANG, Lang, LANG_COOKIE } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Dukaan ERP — Apni Dukaan Digitalize Karein',
  description: 'Inventory, budget aur bikri ka poora hisaab — ek jagah.'
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieLang = cookieStore.get(LANG_COOKIE)?.value;
  const initialLang: Lang = cookieLang === 'en' || cookieLang === 'ur' ? cookieLang : DEFAULT_LANG;

  return (
    <html lang={initialLang === 'en' ? 'en' : 'ur'}>
      <body>
        <LanguageProvider initialLang={initialLang}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
