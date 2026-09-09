'use client';

import { useState } from 'react';
import { Arena, OpeningHour } from '@playarena/types';
import { apiRequest } from '../lib/api';

const weekDays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

type HourDraft = Pick<OpeningHour, 'weekday' | 'open_time' | 'close_time' | 'active'>;

type OwnerHoursPanelProps = {
  arena: Arena;
  token: string;
  hours: OpeningHour[];
  done: (message: string) => void;
};

export function OwnerHoursPanel({ arena, token, hours, done }: OwnerHoursPanelProps) {
  const [items, setItems] = useState<HourDraft[]>(() => normalizeHours(hours));
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function persist(next: HourDraft[], message: string) {
    const invalid = next.find((item) => item.active && item.open_time.slice(0, 5) >= item.close_time.slice(0, 5));
    if (invalid) {
      setError('O horário final deve ser depois do horário inicial.');
      return false;
    }

    setBusy(true);
    setError('');
    try {
      await apiRequest(`/owner/arenas/${arena.id}/opening-hours`, token, {
        method: 'PUT',
        body: JSON.stringify({ hours: next }),
      });
      setItems(next);
      done(message);
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível salvar os horários.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDay(next: HourDraft) {
    const nextItems = items.map((item) => item.weekday === next.weekday ? next : item);
    if (await persist(nextItems, 'Horário atualizado.')) setEditingDay(null);
  }

  async function saveBulk(range: Pick<HourDraft, 'open_time' | 'close_time'>, weekdays: number[]) {
    if (!weekdays.length) {
      setError('Selecione ao menos um dia para aplicar o horário.');
      return;
    }
    const nextItems = items.map((item) => weekdays.includes(item.weekday) ? { ...item, ...range, active: true } : item);
    if (await persist(nextItems, 'Horários aplicados aos dias selecionados.')) setBulkOpen(false);
  }

  const activeDay = editingDay === null ? null : items.find((item) => item.weekday === editingDay) ?? null;

  return <section className="overflow-hidden rounded-[20px] border border-white/7 bg-[#111923] shadow-xl shadow-black/20">
    <div className="border-b border-white/8 px-5 py-5">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8FFF3C]">Funcionamento semanal</p>
      <h2 className="mt-1 text-2xl font-bold text-white">Horários</h2>
      <p className="mt-1 text-sm text-[#9DA7B3]">Toque em um dia para editar.</p>
    </div>

    {error && <p aria-live="polite" className="mx-5 mt-4 rounded-xl border border-[#FF4B4B]/30 bg-[#FF4B4B]/10 px-3 py-2 text-sm font-semibold text-[#FF8585]">{error}</p>}

    <div className="divide-y divide-white/7 px-5">
      {items.map((item) => <button className="flex min-h-[68px] w-full items-center justify-between gap-4 py-3 text-left" key={item.weekday} onClick={() => { setError(''); setEditingDay(item.weekday); }} type="button">
        <span className="font-semibold text-white">{weekDays[item.weekday]}</span>
        <span className={`text-sm font-bold ${item.active ? 'text-[#8FFF3C]' : 'text-[#73808E]'}`}>{item.active ? `${item.open_time.slice(0, 5)} - ${item.close_time.slice(0, 5)}` : 'Fechado'}</span>
      </button>)}
    </div>

    <div className="border-t border-white/8 px-5 py-4">
      <button className="min-h-[46px] w-full rounded-xl border border-[#8FFF3C]/40 px-4 text-sm font-bold text-[#8FFF3C]" onClick={() => { setError(''); setBulkOpen(true); }} type="button">Aplicar horário a vários dias</button>
    </div>

    {activeDay && <DaySheet busy={busy} error={error} hour={activeDay} onClose={() => setEditingDay(null)} onSave={saveDay} onCopy={async (source, weekdays) => {
      const nextItems = items.map((item) => weekdays.includes(item.weekday) ? { ...item, active: source.active, open_time: source.open_time, close_time: source.close_time } : item);
      if (await persist(nextItems, 'Horário copiado para os dias selecionados.')) setEditingDay(null);
    }} />}
    {bulkOpen && <BulkSheet busy={busy} error={error} onClose={() => setBulkOpen(false)} onSave={saveBulk} />}
  </section>;
}

function DaySheet({ busy, error, hour, onClose, onSave, onCopy }: { busy: boolean; error: string; hour: HourDraft; onClose: () => void; onSave: (hour: HourDraft) => Promise<void>; onCopy: (hour: HourDraft, weekdays: number[]) => Promise<void> }) {
  const [draft, setDraft] = useState(hour);
  const [copying, setCopying] = useState(false);
  const [targets, setTargets] = useState<number[]>([]);
  const toggleTarget = (weekday: number) => setTargets((current) => current.includes(weekday) ? current.filter((item) => item !== weekday) : [...current, weekday]);

  return <Sheet title={weekDays[draft.weekday]} onClose={onClose}>
    <div className="flex items-center justify-between rounded-2xl bg-[#18212D] p-4">
      <div><p className="font-bold text-white">{draft.active ? 'Arena aberta' : 'Arena fechada'}</p><p className="mt-1 text-sm text-[#9DA7B3]">Ative para aceitar reservas neste dia.</p></div>
      <button aria-checked={draft.active} className={`relative h-8 w-14 rounded-full transition ${draft.active ? 'bg-[#8FFF3C]' : 'bg-[#56616D]'}`} onClick={() => setDraft((current) => ({ ...current, active: !current.active }))} role="switch" type="button"><span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition ${draft.active ? 'left-7' : 'left-1'}`} /></button>
    </div>
    {draft.active && <div className="grid grid-cols-2 gap-3"><TimeInput label="Abre" onChange={(open_time) => setDraft((current) => ({ ...current, open_time }))} value={draft.open_time}/><TimeInput label="Fecha" onChange={(close_time) => setDraft((current) => ({ ...current, close_time }))} value={draft.close_time}/></div>}
    {error && <p aria-live="polite" className="text-sm font-semibold text-[#FF8585]">{error}</p>}
    {copying && <div className="rounded-2xl border border-white/8 bg-[#18212D] p-4"><p className="text-sm font-bold text-white">Copiar para</p><div className="mt-3 grid grid-cols-2 gap-2">{weekDays.map((day, weekday) => weekday === draft.weekday ? null : <DayCheck checked={targets.includes(weekday)} key={day} label={day} onChange={() => toggleTarget(weekday)}/>)}</div><button className="button mt-4 w-full" disabled={busy || !targets.length} onClick={() => void onCopy(draft, targets)} type="button">{busy ? 'Salvando...' : 'Aplicar cópia'}</button></div>}
    {!copying && <button className="min-h-[44px] text-left text-sm font-bold text-[#8FFF3C]" onClick={() => setCopying(true)} type="button">Copiar horário para outros dias</button>}
    <button className="button w-full" disabled={busy} onClick={() => void onSave(draft)} type="button">{busy ? 'Salvando...' : 'Salvar horário'}</button>
  </Sheet>;
}

function BulkSheet({ busy, error, onClose, onSave }: { busy: boolean; error: string; onClose: () => void; onSave: (range: Pick<HourDraft, 'open_time' | 'close_time'>, weekdays: number[]) => Promise<void> }) {
  const [openTime, setOpenTime] = useState('18:00');
  const [closeTime, setCloseTime] = useState('23:00');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const toggleDay = (weekday: number) => setWeekdays((current) => current.includes(weekday) ? current.filter((item) => item !== weekday) : [...current, weekday]);

  return <Sheet title="Aplicar horário" onClose={onClose}>
    <p className="-mt-2 text-sm text-[#9DA7B3]">Defina um intervalo e escolha os dias que devem receber esse funcionamento.</p>
    <div className="grid grid-cols-2 gap-3"><TimeInput label="Abre" onChange={setOpenTime} value={openTime}/><TimeInput label="Fecha" onChange={setCloseTime} value={closeTime}/></div>
    <div><p className="mb-3 text-sm font-bold text-white">Dias da semana</p><div className="grid grid-cols-2 gap-2">{weekDays.map((day, weekday) => <DayCheck checked={weekdays.includes(weekday)} key={day} label={day} onChange={() => toggleDay(weekday)}/>)}</div></div>
    {error && <p aria-live="polite" className="text-sm font-semibold text-[#FF8585]">{error}</p>}
    <button className="button w-full" disabled={busy} onClick={() => void onSave({ open_time: openTime, close_time: closeTime }, weekdays)} type="button">{busy ? 'Aplicando...' : 'Aplicar horários'}</button>
  </Sheet>;
}

function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-40 flex items-end bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:justify-center"><button aria-label="Fechar" className="absolute inset-0" onClick={onClose} type="button"/><section aria-modal="true" className="relative w-full max-w-md space-y-5 rounded-[24px] border border-white/10 bg-[#111923] p-5 shadow-2xl shadow-black/50" role="dialog"><div className="flex items-center justify-between gap-4"><h2 className="text-xl font-bold text-white">{title}</h2><button className="min-h-[40px] px-2 text-sm font-bold text-[#9DA7B3]" onClick={onClose} type="button">Fechar</button></div>{children}</section></div>;
}

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2 text-sm font-semibold text-[#AAB7C5]">{label}<input className="min-h-[52px] rounded-xl border border-white/10 bg-[#18212D] px-3 text-base font-bold text-white" onChange={(event) => onChange(event.target.value)} type="time" value={value.slice(0, 5)}/></label>;
}

function DayCheck({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return <button aria-pressed={checked} className={`min-h-[42px] rounded-xl border px-3 text-left text-sm font-semibold ${checked ? 'border-[#8FFF3C]/60 bg-[#8FFF3C]/12 text-[#B5FF86]' : 'border-white/8 bg-[#111923] text-[#AAB7C5]'}`} onClick={onChange} type="button">{label}</button>;
}

function normalizeHours(hours: OpeningHour[]): HourDraft[] {
  return weekDays.map((_, weekday) => {
    const hour = hours.find((item) => item.weekday === weekday);
    return hour ? { weekday, open_time: hour.open_time, close_time: hour.close_time, active: hour.active } : { weekday, open_time: '18:00', close_time: '23:00', active: false };
  });
}
