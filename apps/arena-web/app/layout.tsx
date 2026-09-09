import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '../providers/auth-provider';
import { PageReadyProvider } from '../providers/page-ready-provider';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'PlayArena',
  description: 'Painel operacional das arenas do PlayArena',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={spaceGrotesk.className}>
        <AuthProvider><PageReadyProvider>{children}</PageReadyProvider></AuthProvider>
      </body>
    </html>
  );
}
