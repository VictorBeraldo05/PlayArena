import { Suspense } from 'react';
import { CourtsList } from '../../../components/court-management';

export default function CourtsPage() { return <Suspense fallback={<main className="min-h-[100dvh] bg-[#080D14]" />}><CourtsList /></Suspense>; }
