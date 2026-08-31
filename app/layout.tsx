import type { Metadata } from 'next';
import Link from 'next/link';

import './styles.css';

export const metadata: Metadata = {
  title: 'Frankfurt Student Housing Radar',
  description: 'Fresh student-housing listings for Frankfurt UAS and Goethe students.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="siteHeader">
          <Link className="brand" href="/">Radar</Link>
          <nav aria-label="Primary navigation">
            <Link href="/housing">Housing</Link>
          </nav>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
