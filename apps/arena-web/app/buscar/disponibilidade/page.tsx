import { Suspense } from 'react';
import { LoadingPanel } from '../../../components/loading-panel';
import { AvailabilitySearchClient } from './availability-search-client';

export default function AvailabilityPage() {
  return <Suspense fallback={<main className="min-h-[100dvh] bg-[#080D14] px-5 py-8"><LoadingPanel message="Carregando disponibilidade..." /></main>}><AvailabilitySearchClient /></Suspense>;
}
