'use client';

import { ReactNode } from 'react';

export function AppShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen px-4 pb-28 pt-8 md:px-8 md:py-8">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col justify-center">
        <div className="mb-8 max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-[#8FFF3C]">
            {eyebrow}
          </p>
          <h1 className="text-3xl font-bold leading-tight text-white md:text-5xl">{title}</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-[#9DA7B3] md:text-base">{subtitle}</p>
        </div>
        {children}
      </section>
    </main>
  );
}
