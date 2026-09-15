import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '../providers/auth-provider';
import { PageReadyProvider } from '../providers/page-ready-provider';
import { PwaServiceWorker } from '../components/pwa-service-worker';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'PlayArena',
  description: 'Encontre arenas, horários e reserve onde jogar.',
  applicationName: 'PlayArena',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'PlayArena',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#080D14',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={spaceGrotesk.className}>
        <AuthProvider><PageReadyProvider>{children}</PageReadyProvider></AuthProvider>
        <PwaServiceWorker />
      </body>
    </html>
  );
}
