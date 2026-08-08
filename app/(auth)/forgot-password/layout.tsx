import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Password Bhool Gaye',
  // Deliberately not indexed: a password-recovery form has no search
  // value, and keeping it out of the index avoids it competing with
  // /login for the same intent.
  robots: { index: false, follow: true }
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
