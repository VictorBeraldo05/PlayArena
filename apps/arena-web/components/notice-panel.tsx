'use client';

import { ReactNode } from 'react';

export function NoticePanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-[18px] border border-white/5 bg-[#111923] p-6 shadow-2xl shadow-black/30">
      <h2 className="text-2xl font-bold text-white">{title}</h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[#9DA7B3]">{description}</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}
