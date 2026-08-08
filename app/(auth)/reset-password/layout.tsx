import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Naya Password',
  // Never indexed — this URL is only ever reached carrying a recovery
  // token, and an indexed copy would be both useless and a token leak.
  robots: { index: false, follow: false }
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
