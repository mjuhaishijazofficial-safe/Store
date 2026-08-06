import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dukaan ERP — Apni Dukaan Digitalize Karein',
  description: 'Inventory, budget aur bikri ka poora hisaab — ek jagah.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
