'use client';

import { Session } from '@supabase/supabase-js';
import { createContext, useEffect, useRef, useState } from 'react';

import { Arena, Profile } from '@playarena/types';

import { supabase } from '../lib/supabase';

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

interface OnboardingDiagnostic {
  auth_uid: string | null;
  database_current_user: string;
  database_session_user: string;
  profile_id: string | null;
  profile_role: string | null;
  profile_role_length: number | null;
  profile_is_arena_owner: boolean | null;
  profile_role_hex: string | null;
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
  updatePlayerProfile: (input: { fullName: string; phone: string }) => Promise<boolean>;
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

async function fetchOwnedArenas(userId: string): Promise<Arena[]> {
  const { data, error } = await supabase
    .from('arena_owners')
    .select('arenas(*)')
    .eq('user_id', userId)
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
  const hydrationVersion = useRef(0);

  async function hydrateAuth(nextSession: Session | null) {
    const version = ++hydrationVersion.current;
    setIsLoading(true);
    setSession(nextSession);
    setProfile(null);
    setOwnedArenas([]);

    if (!nextSession?.user) {
      setProfile(null);
      setOwnedArenas([]);
      setIsLoading(false);
      return;
    }

    const [nextProfile, arenas] = await Promise.all([
      fetchProfile(nextSession.user.id),
      fetchOwnedArenas(nextSession.user.id),
    ]);

    if (version !== hydrationVersion.current) return;

    setProfile(nextProfile);
    setOwnedArenas(arenas);
    setIsLoading(false);
  }

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        void hydrateAuth(data.session);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void hydrateAuth(nextSession);
    });

    return () => {
      active = false;
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
    setSession(null); setProfile(null); setOwnedArenas([]); setIsLoading(false);
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (!session?.user) {
      return;
    }

    const [nextProfile, arenas] = await Promise.all([fetchProfile(session.user.id), fetchOwnedArenas(session.user.id)]);
    setProfile(nextProfile);
    setOwnedArenas(arenas);
  }

  async function updatePlayerProfile(input: { fullName: string; phone: string }) {
    if (!session?.user) {
      setErrorMessage('Sua sessão expirou. Entre novamente para continuar.');
      return false;
    }

    setErrorMessage(null);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: input.fullName.trim(), phone: input.phone.trim() })
      .eq('id', session.user.id);

    if (error) {
      setErrorMessage(error.message);
      return false;
    }

    await refreshProfile();
    return true;
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
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      setErrorMessage('Sua sessao expirou. Faca login novamente antes de criar uma arena.');
      return false;
    }

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
      console.error('[PlayArena] arena creation failed', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      const { data: diagnostic, error: diagnosticError } = await supabase.rpc(
        'onboarding_function_context_diagnostic',
      );
      const diagnosticRow = diagnosticError
        ? null
        : (diagnostic as OnboardingDiagnostic[] | null)?.[0] ?? null;

      console.info('[PlayArena] onboarding function context diagnostic', {
        authenticatedUserId: userData.user.id,
        databaseAuthUid: diagnosticRow?.auth_uid ?? null,
        databaseCurrentUser: diagnosticRow?.database_current_user ?? null,
        databaseSessionUser: diagnosticRow?.database_session_user ?? null,
        profileId: diagnosticRow?.profile_id ?? null,
        profileRole: diagnosticRow?.profile_role ?? null,
        profileRoleLength: diagnosticRow?.profile_role_length ?? null,
        profileIsArenaOwner: diagnosticRow?.profile_is_arena_owner ?? null,
        profileRoleHex: diagnosticRow?.profile_role_hex ?? null,
        diagnosticAvailable: !diagnosticError,
      });
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
    updatePlayerProfile,
    becomeArenaOwner,
    createArena,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
