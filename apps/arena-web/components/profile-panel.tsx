'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useAuth } from './use-auth';

export function ProfilePanel() { const { profile, session, ownedArenas, signOut } = useAuth(); const router=useRouter(); const [leaving,setLeaving]=useState(false); const lock=useRef(false); async function leave(){if(lock.current)return;lock.current=true;setLeaving(true);try{await signOut();router.replace('/login')}finally{lock.current=false;setLeaving(false)}} return <section className="rounded-[18px] border border-white/5 bg-[#111923] p-6"><h2 className="text-2xl font-bold">Perfil</h2><dl className="mt-6 space-y-4 text-sm"><Row label="Nome" value={profile?.full_name ?? 'Nao informado'}/><Row label="E-mail" value={session?.user.email ?? 'Nao informado'}/><Row label="Telefone" value={profile?.phone ?? 'Nao informado'}/><Row label="Funcao" value={profile?.role ?? 'player'}/><Row label="Arena vinculada" value={ownedArenas[0]?.name ?? 'Nenhuma arena'}/></dl><button className="mt-8 h-14 w-full rounded-2xl border border-[#FF4B4B]/40 text-sm font-bold text-[#FF4B4B] disabled:opacity-60" disabled={leaving} onClick={()=>void leave()}>{leaving?'Saindo...':'Sair da conta'}</button></section> }
function Row({label,value}:{label:string;value:string}){return <div className="border-b border-white/5 pb-3"><dt className="text-[#9DA7B3]">{label}</dt><dd className="mt-1 font-semibold text-white">{value}</dd></div>}
