import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Arena, Profile } from '@playarena/types';

type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'TOKEN_REFRESHED' | 'SIGNED_OUT' | string;
type AuthDecision =
  | { kind: 'hydrate'; version: number; session: Session }
  | { kind: 'ready'; session: Session }
  | { kind: 'pending' }
  | { kind: 'signed-out' }
  | { kind: 'invalid-session' };

export function createAuthHydrationGate() {
  let version = 0;
  let readyUserId: string | null = null;
  let pending: { userId: string; token: string } | null = null;

  return {
    receive(event: AuthEvent, session: Session | null): AuthDecision {
      if (!session?.user) {
        version++;
        readyUserId = null;
        pending = null;
        return { kind: 'signed-out' };
      }
      if (!session.access_token) {
        version++;
        readyUserId = null;
        pending = null;
        return { kind: 'invalid-session' };
      }
      if (pending?.userId === session.user.id && pending.token === session.access_token) {
        return { kind: 'pending' };
      }
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && readyUserId === session.user.id) {
        return { kind: 'ready', session };
      }
      version++;
      readyUserId = null;
      pending = { userId: session.user.id, token: session.access_token };
      return { kind: 'hydrate', version, session };
    },
    complete(completedVersion: number, userId: string, success: boolean) {
      if (completedVersion !== version) return false;
      pending = null;
      readyUserId = success ? userId : null;
      return true;
    },
    currentVersion() { return version; },
    invalidate() {
      version++;
      readyUserId = null;
      pending = null;
    },
  };
}

export function authDiagnostic(event: string, details: Record<string, string | number | boolean | null>) {
  if (process.env.NEXT_PUBLIC_AUTH_DIAGNOSTICS === 'true') {
    console.info('[auth-diagnostic]', event, details);
  }
}

export async function loadAuthData(client: Pick<SupabaseClient, 'from'>, session: Session) {
  const token = session.access_token;
  if (!token || !session.user?.id) throw new Error('auth_session_missing_token');
  const userId = session.user.id;

  async function fetchProfile(): Promise<Profile> {
    authDiagnostic('profile_request_started', { session_present: true, access_token_present: true });
    const { data, error, status } = await client.from('profiles').select('*').eq('id', userId)
      .setHeader('Authorization', `Bearer ${token}`).single();
    authDiagnostic('profile_response', { status });
    if (error) throw error;
    return data as Profile;
  }

  async function fetchOwnedArenas(): Promise<Arena[]> {
    const { data, error } = await client.from('arena_owners').select('arenas(*)').eq('user_id', userId)
      .order('created_at', { ascending: true }).setHeader('Authorization', `Bearer ${token}`);
    if (error) throw error;
    if (!data) return [];
    const rows = data as { arenas: Arena | Arena[] | null }[];
    return rows.flatMap((item) => Array.isArray(item.arenas) ? item.arenas : item.arenas ? [item.arenas] : []);
  }

  const [profile, ownedArenas] = await Promise.all([fetchProfile(), fetchOwnedArenas()]);
  return { profile, ownedArenas };
}
