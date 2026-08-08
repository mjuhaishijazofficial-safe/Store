import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Free Trial Shuru Karein',
  description:
    'Apni kiryana dukaan ka account banayein — 14 din free trial, credit card ki zaroorat nahi. Khata, inventory, supplier aur reports ek hi app mein.',
  alternates: { canonical: '/signup' }
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
