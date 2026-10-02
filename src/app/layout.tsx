import type { Metadata } from 'next';
import { Jost, Public_Sans } from 'next/font/google';
import 'material-symbols/rounded.css';
import './globals.css';

const jost = Jost({ subsets: ['latin'], weight: ['500'], variable: '--font-jost' });
const publicSans = Public_Sans({ subsets: ['latin'], variable: '--font-public-sans' });

export const metadata: Metadata = {
  title: 'Handovr.ai',
  description: 'Payment that releases when the work passes.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jost.variable} ${publicSans.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
