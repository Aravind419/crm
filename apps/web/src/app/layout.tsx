import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SupportOS — Modern Customer Support SaaS',
  description: 'Enterprise multi-tenant customer support and ticketing platform.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 antialiased font-sans text-slate-900 selection:bg-blue-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
