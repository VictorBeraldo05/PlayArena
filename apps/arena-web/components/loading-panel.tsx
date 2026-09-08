'use client';

export function LoadingPanel({ message }: { message: string }) {
  return (
    <div className="rounded-[18px] border border-white/5 bg-[#111923] p-6">
      <p className="text-sm uppercase tracking-[0.24em] text-[#8FFF3C]">PlayArena</p>
      <p className="mt-4 text-base text-white">{message}</p>
    </div>
  );
}
