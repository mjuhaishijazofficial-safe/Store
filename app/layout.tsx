import type { Metadata, Viewport } from 'next';
import './globals.css';
import { cookies } from 'next/headers';
import { LanguageProvider } from '@/lib/i18n-context';
import { DEFAULT_LANG, Lang, LANG_COOKIE } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme-context';
import { DEFAULT_THEME, Theme, THEME_COOKIE } from '@/lib/theme';
import { PaletteProvider } from '@/lib/palette-context';
import { DEFAULT_PALETTE, Palette, PALETTE_COOKIE } from '@/lib/palette';
import { ToastProvider } from '@/lib/toast-context';
import { SITE_NAME, SITE_URL } from '@/lib/seo';

const DESCRIPTION =
  'Kiryana store ke liye Urdu mein POS aur khata app — udhaar ka hisaab, inventory, supplier, staff aur daily report ek hi jagah. 14 din free trial, card ki zaroorat nahi.';

export const metadata: Metadata = {
  // Without metadataBase, every og:image/canonical Next generates stays
  // relative — crawlers and WhatsApp/Facebook can't resolve those, which
  // is why a site can look fine in a browser and still never index or
  // render a share card.
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Dukaan ERP — Kiryana Store ka Hisaab Kitab, Phone Par',
    // Child pages set just their own name; this keeps the brand in the
    // tab and the search result without repeating it in every file.
    template: `%s — ${SITE_NAME}`
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'kiryana store software',
    'dukaan app',
    'khata app',
    'udhaar khata',
    'POS Pakistan',
    'inventory management Pakistan',
    'general store software',
    'kirana billing app',
    'dukaan ka hisaab'
  ],
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Dukaan ERP — Kiryana Store ka Hisaab Kitab, Phone Par',
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: 'website',
    locale: 'ur_PK'
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dukaan ERP — Kiryana Store ka Hisaab Kitab, Phone Par',
    description: DESCRIPTION
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 }
  },
  // iOS Safari's "Add to Home Screen" ignores app/manifest.ts entirely
  // (that's Android/Chrome's install path) — these are the tags it
  // actually reads, so the two need to agree (theme color, standalone
  // display) or the app looks different depending which platform
  // "installed" it.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Dukaan ERP'
  }
};

export const viewport: Viewport = {
  themeColor: '#B8791A'
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();

  const cookieLang = cookieStore.get(LANG_COOKIE)?.value;
  const initialLang: Lang = cookieLang === 'en' || cookieLang === 'ur' ? cookieLang : DEFAULT_LANG;

  const cookieTheme = cookieStore.get(THEME_COOKIE)?.value;
  const initialTheme: Theme = cookieTheme === 'dark' || cookieTheme === 'light' ? cookieTheme : DEFAULT_THEME;

  const cookiePalette = cookieStore.get(PALETTE_COOKIE)?.value;
  const initialPalette: Palette = cookiePalette === 'navy' || cookiePalette === 'spice' ? cookiePalette : DEFAULT_PALETTE;

  return (
    <html lang={initialLang === 'en' ? 'en' : 'ur'} data-theme={initialTheme} data-palette={initialPalette}>
      <body>
        <ThemeProvider initialTheme={initialTheme}>
          <PaletteProvider initialPalette={initialPalette}>
            <LanguageProvider initialLang={initialLang}>
              <ToastProvider>{children}</ToastProvider>
            </LanguageProvider>
          </PaletteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
