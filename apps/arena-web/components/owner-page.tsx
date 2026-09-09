'use client';

import { AppShell } from './app-shell';
import { OwnerConsole } from './owner-console';
import { OwnerNavigation } from './owner-navigation';
import { OwnerGuard } from './owner-guard';

export function OwnerPage({ view, title }: { view: 'overview' | 'arena' | 'courts' | 'hours' | 'prices'; title: string }) {
  if (view === 'prices') return <main className="min-h-screen px-4 pb-28 pt-8 md:px-8 md:py-8"><section className="mx-auto w-full max-w-md"><OwnerGuard><OwnerNavigation/><OwnerConsole view={view}/></OwnerGuard></section></main>;
  return <AppShell eyebrow="Minha arena" title={title} subtitle="Configure os dados operacionais da sua arena."><OwnerGuard><OwnerNavigation/><OwnerConsole view={view}/></OwnerGuard></AppShell>;
}
