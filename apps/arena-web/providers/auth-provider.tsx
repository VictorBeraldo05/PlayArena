'use client';

import { Session } from '@supabase/supabase-js';
import { createContext, useEffect, useRef, useState } from 'react';

import { Arena, Profile } from '@playarena/types';

import { supabase } from '../lib/supabase';
import { clearOwnerArenaCache } from '../lib/owner-arena-cache';
import { authDiagnostic, createAuthHydrationGate, loadAuthData } from '../lib/auth-hydration';

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
  authDataError: boolean;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ownedArenas, setOwnedArenas] = useState<Arena[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authDataError, setAuthDataError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const gate = useRef(createAuthHydrationGate());
  const [pendingHydration, setPendingHydration] = useState<{ session: Session; version: number } | null>(null);

  useEffect(() => {
    if (!pendingHydration) return;
    let active = true;
    const { session: nextSession, version } = pendingHydration;
    // Run after the auth callback returns; use this event's token for both REST requests.
    void loadAuthData(supabase, nextSession).then(({ profile: nextProfile, ownedArenas: arenas }) => {
      if (!active || !gate.current.complete(version, nextSession.user.id, true)) return;
      setProfile(nextProfile);
      setOwnedArenas(arenas);
      setAuthDataError(false);
    }).catch(() => {
      if (!active || !gate.current.complete(version, nextSession.user.id, false)) return;
      setAuthDataError(true);
    }).finally(() => {
      if (active && gate.current.currentVersion() === version) setIsLoading(false);
    });
    return () => { active = false; };
  }, [pendingHydration]);

  useEffect(() => {
    let active = true;

    // The SDK emits INITIAL_SESSION for this listener, so a parallel getSession would hydrate twice.
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      authDiagnostic('auth_event', { event, session_present: Boolean(nextSession), access_token_present: Boolean(nextSession?.access_token) });
      const decision = gate.current.receive(event, nextSession);
      if (decision.kind === 'pending') return;
      if (decision.kind === 'ready') {
        setSession(nextSession);
        return;
      }
      if (decision.kind === 'signed-out' || decision.kind === 'invalid-session') {
        clearOwnerArenaCache();
        setPendingHydration(null);
        setSession(decision.kind === 'signed-out' ? null : nextSession);
        setProfile(null);
        setOwnedArenas([]);
        setAuthDataError(decision.kind === 'invalid-session');
        setIsLoading(false);
        return;
      }
      clearOwnerArenaCache();
      setIsLoading(true);
      setSession(nextSession);
      setProfile(null);
      setOwnedArenas([]);
      setAuthDataError(false);
      setPendingHydration({ session: decision.session, version: decision.version });
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
    clearOwnerArenaCache();
    gate.current.invalidate();
    setPendingHydration(null);
    setSession(null); setProfile(null); setOwnedArenas([]); setIsLoading(false);
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (!session?.user) {
      return;
    }

    const version = gate.current.currentVersion();
    try {
      const { profile: nextProfile, ownedArenas: arenas } = await loadAuthData(supabase, session);
      if (gate.current.currentVersion() !== version) return;
      setProfile(nextProfile);
      setOwnedArenas(arenas);
      setAuthDataError(false);
      gate.current.complete(version, session.user.id, true);
    } catch {
      if (gate.current.currentVersion() !== version) return;
      setAuthDataError(true);
      gate.current.complete(version, session.user.id, false);
    }
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
    authDataError,
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
