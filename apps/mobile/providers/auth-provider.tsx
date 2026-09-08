'use client';

import { Session } from '@supabase/supabase-js';
import React, { createContext, useEffect, useState } from 'react';

import { Arena, Profile } from '@playarena/types';

import { supabase } from '../services/supabase';

interface SignUpInput {
  fullName: string;
  phone: string;
  email: string;
  password: string;
}

interface ArenaInput {
  name: string;
  whatsapp: string;
  phone: string;
  description: string;
  address: string;
  city: string;
  state: string;
}

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  ownedArenas: Arena[];
  isLoading: boolean;
  errorMessage: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (input: SignUpInput) => Promise<boolean>;
  signOut: () => Promise<void>;
  clearError: () => void;
  refreshProfile: () => Promise<void>;
  becomeArenaOwner: () => Promise<boolean>;
  createArena: (input: ArenaInput) => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) {
    return null;
  }
  return data as Profile;
}

async function fetchOwnedArenas(): Promise<Arena[]> {
  const { data, error } = await supabase
    .from('arena_owners')
    .select('arenas(*)')
    .order('created_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  const rows = data as { arenas: Arena | Arena[] | null }[];

  return rows.flatMap((item) => {
    if (Array.isArray(item.arenas)) {
      return item.arenas;
    }

    return item.arenas ? [item.arenas] : [];
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ownedArenas, setOwnedArenas] = useState<Arena[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function hydrateAuth(nextSession: Session | null) {
    setSession(nextSession);

    if (!nextSession?.user) {
      setProfile(null);
      setOwnedArenas([]);
      setIsLoading(false);
      return;
    }

    const [nextProfile, arenas] = await Promise.all([
      fetchProfile(nextSession.user.id),
      fetchOwnedArenas(),
    ]);

    setProfile(nextProfile);
    setOwnedArenas(arenas);
    setIsLoading(false);
  }

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        void hydrateAuth(data.session);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void hydrateAuth(nextSession);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    setErrorMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    return true;
  }

  async function signUp(input: SignUpInput) {
    setErrorMessage(null);
    const { error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          full_name: input.fullName,
          phone: input.phone,
        },
      },
    });

    if (error) {
      setErrorMessage(error.message);
      return false;
    }

    return true;
  }

  async function signOut() {
    setErrorMessage(null);
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (!session?.user) {
      return;
    }

    const [nextProfile, arenas] = await Promise.all([fetchProfile(session.user.id), fetchOwnedArenas()]);
    setProfile(nextProfile);
    setOwnedArenas(arenas);
  }

  async function becomeArenaOwner() {
    setErrorMessage(null);
    const { error } = await supabase.rpc('become_arena_owner');
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    await refreshProfile();
    return true;
  }

  async function createArena(input: ArenaInput) {
    setErrorMessage(null);
    const { error } = await supabase.rpc('create_arena_for_current_user', {
      p_name: input.name,
      p_whatsapp: input.whatsapp || null,
      p_phone: input.phone || null,
      p_description: input.description || null,
      p_address: input.address,
      p_city: input.city,
      p_state: input.state,
    });

    if (error) {
      setErrorMessage(error.message);
      return false;
    }

    await refreshProfile();
    return true;
  }

  const value: AuthContextValue = {
    session,
    profile,
    ownedArenas,
    isLoading,
    errorMessage,
    signIn,
    signUp,
    signOut,
    clearError: () => setErrorMessage(null),
    refreshProfile,
    becomeArenaOwner,
    createArena,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
