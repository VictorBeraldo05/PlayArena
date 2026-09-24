import type { Metadata } from 'next';

import { LandingPage } from '../components/landing-page';

export const metadata: Metadata = {
  alternates: {
    canonical: 'https://useplayarena.com.br',
  },
};

export default function IndexPage() {
  return <LandingPage />;
}
