'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function IndexPage() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  function start() {
    if (starting) return;
    setStarting(true);
    router.push('/buscar');
  }

  return <main className="landing-night relative min-h-[100dvh] overflow-hidden bg-[#080D14] text-white">
    <Image alt="Campo society iluminado pronto para uma partida" className="landing-night-image absolute inset-0 z-0 object-cover object-[58%_center]" fill priority sizes="100vw" src="/img/playarena-hero.png" />
    <div aria-hidden="true" className="landing-night-haze landing-night-haze-left absolute z-[2]" /><div aria-hidden="true" className="landing-night-haze landing-night-haze-right absolute z-[2]" />
    <div aria-hidden="true" className="landing-night-beam landing-night-beam-left absolute z-[3]" /><div aria-hidden="true" className="landing-night-beam landing-night-beam-right absolute z-[3]" /><div aria-hidden="true" className="landing-night-sweep absolute z-[3]" />
    <div aria-hidden="true" className="landing-night-particles absolute inset-0 z-[4]"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><div aria-hidden="true" className="landing-night-ball-glow absolute z-[5]" />
    <div aria-hidden="true" className="landing-night-floodlight landing-night-floodlight-left absolute z-[5]" /><div aria-hidden="true" className="landing-night-floodlight landing-night-floodlight-right absolute z-[5]" />
    <div aria-hidden="true" className="landing-night-overlay absolute inset-0 z-[6]" /><div aria-hidden="true" className="landing-night-field absolute inset-x-0 bottom-0 z-[6]" />

    <div className="relative z-10 mx-auto grid min-h-[100dvh] w-full max-w-6xl grid-rows-[auto_auto_1fr_auto] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8">
      <header className="landing-reveal landing-reveal-brand text-center">
        <div><b className="text-sm font-black uppercase tracking-[0.16em] text-[#8FFF3C]">PlayArena</b></div>
        <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.24em] text-white/75">Encontre. Reserve. Jogue.</p>
      </header>

      <h1 className="mx-auto mt-9 max-w-[390px] text-center text-[clamp(1.8rem,8.4vw,3.8rem)] font-extrabold leading-[1.08] tracking-[-0.045em] text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.58)]"><span className="landing-reveal landing-reveal-one block">A forma mais fácil</span><span className="landing-reveal landing-reveal-two block">de reservar sua quadra</span><span className="landing-reveal landing-reveal-three block">em <em className="not-italic text-[#8FFF3C]">Piracicaba.</em></span></h1>

      <div />

      <div className="landing-reveal landing-reveal-cta w-full max-w-[510px]">
        <div className="landing-benefits mb-3 grid grid-cols-3 gap-2"><Benefit icon="calendar" title="Horários" text="Em tempo real"/><Benefit icon="bolt" title="Reserve" text="Em poucos toques"/><Benefit icon="pin" title="Arenas" text="Tudo em um só lugar"/></div>
        <div aria-hidden="true" className="mb-3 flex justify-center"><span className="landing-night-chevron" /></div>
        <button className="landing-night-cta relative min-h-[58px] w-full overflow-hidden rounded-[18px] bg-[#8FFF3C] px-6 text-base font-black text-[#080D14] disabled:cursor-not-allowed disabled:opacity-70" disabled={starting} onClick={start} type="button"><span className="relative z-10">{starting ? 'Abrindo...' : 'Começar'}</span><i aria-hidden="true" className="landing-night-cta-light absolute inset-y-0 w-1/2" /></button>
      </div>
    </div>
  </main>;
}

function Benefit({ icon, title, text }: { icon: 'calendar' | 'bolt' | 'pin'; title: string; text: string }) { const paths={calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></>,bolt:<path d="m13 2-9 12h7l-1 8 9-12h-7z"/>,pin:<><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/></>}; return <article className="rounded-2xl border border-white/10 bg-[#080D14]/70 p-3 text-center backdrop-blur-md"><svg aria-hidden="true" className="mx-auto h-6 w-6 text-[#8FFF3C]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">{paths[icon]}</svg><b className="mt-2 block text-sm">{title}</b><span className="mt-1 block text-[10px] leading-3 text-[#9DA7B3]">{text}</span></article>; }
