import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Milo & Friends BingoShow',
  description: 'Eén magische showwereld, twaalf vrienden en samen bingo spelen.',
  icons: { icon: '/assets/milo-friends/logo.png' },
  referrer: 'same-origin',
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#321c4e',
};
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="nl" data-workspace="react-sterrenplein"><body><div id="root">{children}</div><noscript>Schakel JavaScript in om de showstudio en familie-app te gebruiken.</noscript></body></html>;
}
