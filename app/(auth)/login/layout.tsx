import type { Metadata } from 'next';

// The page itself is a client component, so its metadata has to live in
// a layout — otherwise it inherits the root's title/description verbatim
// and every public page looks like duplicate content to a crawler.
export const metadata: Metadata = {
  title: 'Login',
  description: 'Apne Dukaan ERP account mein login karein — khata, inventory aur reports tak rasai.',
  alternates: { canonical: '/login' }
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
