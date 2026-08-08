import type { Metadata } from 'next';
import './globals.css';
import { cookies } from 'next/headers';
import { LanguageProvider } from '@/lib/i18n-context';
import { DEFAULT_LANG, Lang, LANG_COOKIE } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme-context';
import { DEFAULT_THEME, Theme, THEME_COOKIE } from '@/lib/theme';
import { ToastProvider } from '@/lib/toast-context';

export const metadata: Metadata = {
  title: 'Dukaan ERP — Apni Dukaan Digitalize Karein',
  description: 'Inventory + Khata + Suppliers + Staff + Reports — sab ek jagah, kiryana dukaanon ke liye.',
  openGraph: {
    title: 'Dukaan ERP — Apni Dukaan Digitalize Karein',
    description: 'Inventory + Khata + Suppliers + Staff + Reports — sab ek jagah, kiryana dukaanon ke liye.',
    type: 'website',
    locale: 'ur_PK'
  },
  twitter: {
    card: 'summary',
    title: 'Dukaan ERP',
    description: 'Inventory + Khata + Suppliers + Staff + Reports — sab ek jagah, kiryana dukaanon ke liye.'
  }
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();

  const cookieLang = cookieStore.get(LANG_COOKIE)?.value;
  const initialLang: Lang = cookieLang === 'en' || cookieLang === 'ur' ? cookieLang : DEFAULT_LANG;

  const cookieTheme = cookieStore.get(THEME_COOKIE)?.value;
  const initialTheme: Theme = cookieTheme === 'dark' || cookieTheme === 'light' ? cookieTheme : DEFAULT_THEME;

  return (
    <html lang={initialLang === 'en' ? 'en' : 'ur'} data-theme={initialTheme}>
      <body>
        <ThemeProvider initialTheme={initialTheme}>
          <LanguageProvider initialLang={initialLang}>
            <ToastProvider>{children}</ToastProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
