'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { NoticePanel } from './notice-panel';
import { useAuth } from './use-auth';

export function OnboardingForm() {
  const router = useRouter();
  const { createArena, errorMessage, clearError } = useAuth();
  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Piracicaba');
  const [state, setState] = useState('SP');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearError();

    const success = await createArena({
      name: name.trim(),
      whatsapp: whatsapp.trim(),
      phone: phone.trim(),
      description: description.trim(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
    });

    if (success) {
      router.replace('/dashboard');
    }
  }

  return (
    <NoticePanel
      description="O onboarding cria a arena e o vinculo em arena_owners em uma operacao protegida no banco."
      title="Cadastre sua primeira arena"
    >
      <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
        <Field className="md:col-span-2" label="Nome da arena" onChange={setName} value={name} />
        <Field label="WhatsApp" onChange={setWhatsapp} value={whatsapp} />
        <Field label="Telefone" onChange={setPhone} value={phone} />
        <Field
          className="md:col-span-2"
          label="Descricao"
          onChange={setDescription}
          value={description}
        />
        <Field className="md:col-span-2" label="Endereco" onChange={setAddress} value={address} />
        <Field label="Cidade" onChange={setCity} value={city} />
        <Field label="Estado" onChange={setState} value={state} />
        {errorMessage ? <p className="md:col-span-2 text-sm text-[#FF4B4B]">{errorMessage}</p> : null}
        <button
          className="h-14 rounded-2xl bg-[#8FFF3C] px-6 text-sm font-bold text-[#080D14] transition hover:brightness-95 md:col-span-2"
          type="submit"
        >
          Criar arena
        </button>
      </form>
    </NoticePanel>
  );
}

function Field({
  label,
  value,
  onChange,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2 block text-sm font-medium text-white">{label}</span>
      <input
        className="h-14 w-full rounded-2xl border border-white/5 bg-[#18212D] px-4 text-base text-white outline-none"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}
