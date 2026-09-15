'use client';

import { useEffect, useState } from 'react';

import { usePwaInstall } from '../lib/use-pwa-install';

export function PwaInstallCard() {
  const { canInstall, isIOS, isInstalled, install } = usePwaInstall();
  const [isInstalling, setIsInstalling] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    if (!showIOSInstructions) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowIOSInstructions(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showIOSInstructions]);

  if (isInstalled || (!canInstall && !isIOS)) return null;

  async function handleInstall() {
    if (isIOS) {
      setShowIOSInstructions(true);
      return;
    }

    if (isInstalling) return;
    setIsInstalling(true);
    try {
      await install();
    } finally {
      setIsInstalling(false);
    }
  }

  return <>
    <section aria-labelledby="pwa-install-title" className="mt-5 overflow-hidden rounded-[18px] border border-white/[.09] bg-[linear-gradient(135deg,rgba(143,255,60,.09),transparent_58%),#111923] p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[#8FFF3C]/25 bg-[#8FFF3C]/10 text-[#8FFF3C]"><InstallIcon /></span>
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-white" id="pwa-install-title">Instale o PlayArena</h2>
          <p className="mt-1 text-sm leading-5 text-[#9DA7B3]">Acesse suas reservas mais rápido pela tela inicial do seu celular.</p>
        </div>
      </div>
      <button className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[13px] border border-[#8FFF3C]/35 bg-[#8FFF3C]/10 px-4 text-sm font-extrabold text-[#DFFFC9] transition-colors active:bg-[#8FFF3C]/18 disabled:cursor-not-allowed disabled:opacity-60" disabled={isInstalling} onClick={() => void handleInstall()} type="button">
        <span>{isInstalling ? 'Abrindo instalação...' : 'Instalar app'}</span>
        <ArrowIcon />
      </button>
    </section>
    {showIOSInstructions ? <IOSInstallSheet onClose={() => setShowIOSInstructions(false)} /> : null}
  </>;
}

function IOSInstallSheet({ onClose }: { onClose: () => void }) {
  return <div className="fixed inset-0 z-[110] flex items-end bg-[#02060A]/70 p-3 backdrop-blur-sm" role="presentation">
    <button aria-label="Fechar instruções de instalação" className="absolute inset-0 cursor-default" onClick={onClose} type="button" />
    <section aria-describedby="ios-install-description" aria-labelledby="ios-install-title" aria-modal="true" className="relative w-full rounded-[22px] border border-white/[.1] bg-[#111923] p-5 pb-[max(1.25rem,calc(1.25rem+env(safe-area-inset-bottom)))] shadow-2xl" role="dialog">
      <div className="mx-auto h-1 w-10 rounded-full bg-white/15" />
      <div className="mt-5 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#8FFF3C]/10 text-[#8FFF3C]"><ShareIcon /></span>
        <div>
          <h2 className="text-base font-extrabold text-white" id="ios-install-title">Instale no seu iPhone ou iPad</h2>
          <p className="mt-1 text-sm leading-5 text-[#9DA7B3]" id="ios-install-description">No Safari, siga estes três passos:</p>
        </div>
      </div>
      <ol className="mt-5 grid gap-3 text-sm leading-5 text-[#D3DCE5]">
        <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[.07] text-xs font-extrabold text-[#8FFF3C]">1</span><span>Toque no botão <strong className="font-bold text-white">Compartilhar</strong> do Safari.</span></li>
        <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[.07] text-xs font-extrabold text-[#8FFF3C]">2</span><span>Escolha <strong className="font-bold text-white">Adicionar à Tela de Início</strong>.</span></li>
        <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[.07] text-xs font-extrabold text-[#8FFF3C]">3</span><span>Confirme em <strong className="font-bold text-white">Adicionar</strong> para abrir o PlayArena como app.</span></li>
      </ol>
      <button className="mt-6 min-h-12 w-full rounded-[13px] bg-[#8FFF3C] px-4 text-sm font-extrabold text-[#080D14]" onClick={onClose} type="button">Agora não</button>
    </section>
  </div>;
}

function InstallIcon() {
  return <svg aria-hidden="true" fill="none" height="21" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="21"><path d="M12 3v11m0 0 4-4m-4 4-4-4" /><path d="M5 14.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4.5" /></svg>;
}

function ArrowIcon() {
  return <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>;
}

function ShareIcon() {
  return <svg aria-hidden="true" fill="none" height="21" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="21"><path d="M12 16V3m0 0L8 7m4-4 4 4" /><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" /></svg>;
}
