'use client';

import { ChangeEvent, useState } from 'react';
import { formatDateBR, parseDateBR, todayInSaoPaulo } from '../lib/format';

export function DateField({ value, onChange, minToday = false }: { value: string; onChange: (isoDate: string) => void; minToday?: boolean }) {
  const [display, setDisplay] = useState(() => formatDateBR(value));
  const [message, setMessage] = useState('');
  function change(event: ChangeEvent<HTMLInputElement>) { const next = event.target.value; setDisplay(next); const parsed = parseDateBR(next); if (!parsed) { setMessage('Informe uma data válida no formato dd/MM/aaaa.'); return; } if (minToday && parsed < todayInSaoPaulo()) { setMessage('A data deve ser hoje ou uma data futura.'); return; } setMessage(''); onChange(parsed); }
  return <><input inputMode="numeric" aria-invalid={Boolean(message)} placeholder="dd/MM/aaaa" value={display} onChange={change} /><span className="mt-1 block text-xs text-[#FF4B4B]" aria-live="polite">{message}</span></>;
}
