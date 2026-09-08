'use client';

import { ChangeEvent, useState } from 'react';

const quickTimes = ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'];
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function TimeField({ value, onChange, quick = false }: { value: string; onChange: (value: string) => void; quick?: boolean }) {
  const [display, setDisplay] = useState(value);
  const [message, setMessage] = useState('');
  function change(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setDisplay(next);
    if (!timePattern.test(next)) { setMessage('Informe um horário válido.'); return; }
    setMessage(''); onChange(next);
  }
  return <div>{quick && <div className="mb-2 flex flex-wrap gap-2">{quickTimes.map(time => <button className="rounded-lg bg-[#18212D] px-3 py-2 text-xs font-bold" key={time} onClick={() => { setDisplay(time); setMessage(''); onChange(time); }} type="button">{time}</button>)}</div>}<input inputMode="numeric" aria-invalid={Boolean(message)} placeholder="HH:mm" value={display} onChange={change} /><span className="mt-1 block text-xs text-[#FF4B4B]" aria-live="polite">{message}</span></div>;
}
