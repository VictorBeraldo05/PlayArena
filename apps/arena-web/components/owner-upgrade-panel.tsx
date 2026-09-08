'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { NoticePanel } from './notice-panel';
import { useAuth } from './use-auth';

export function OwnerUpgradePanel() {
  const router = useRouter();
  const { becomeArenaOwner, errorMessage, clearError } = useAuth();
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  async function handleUpgrade() {
    clearError();
    setInfoMessage(null);
    const success = await becomeArenaOwner();
    if (!success) {
      return;
    }
    setInfoMessage('Seu profile agora pode acessar o onboarding da arena.');
    router.replace('/onboarding');
  }

  return (
    <NoticePanel
      description="O painel web e exclusivo para proprietarios. No ambiente de desenvolvimento voce pode promover seu proprio profile para arena_owner sem acesso ao papel de admin."
      title="Area exclusiva para proprietarios"
    >
      <button
        className="h-14 rounded-2xl bg-[#8FFF3C] px-6 text-sm font-bold text-[#080D14] transition hover:brightness-95"
        onClick={handleUpgrade}
        type="button"
      >
        Tornar-me proprietario
      </button>
      {errorMessage ? <p className="mt-4 text-sm text-[#FF4B4B]">{errorMessage}</p> : null}
      {infoMessage ? <p className="mt-4 text-sm text-[#8FFF3C]">{infoMessage}</p> : null}
    </NoticePanel>
  );
}
