'use client';

import { AppShell } from './app-shell';
import { OwnerConsole } from './owner-console';
import { OwnerNavigation } from './owner-navigation';
import { OwnerGuard } from './owner-guard';

export function OwnerPage({ view, title }: { view: 'overview' | 'arena' | 'courts' | 'hours' | 'prices'; title: string }) {
  return <AppShell eyebrow="Minha arena" title={title} subtitle="Configure os dados operacionais da sua arena."><OwnerGuard><OwnerNavigation/><OwnerConsole view={view}/></OwnerGuard></AppShell>;
}
