import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { onIdTokenChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleAuthProvider } from '../services/firebase.ts';
import { apiGetCurrentUser } from '../services/g01Client.ts';
import type { Persona, BrandId } from '../types/cabms.ts';

type Profile = NonNullable<Awaited<ReturnType<typeof apiGetCurrentUser>>['data']>;
export interface Session {
  profile: Profile | null;
  loading: boolean;
  error: string;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  token: () => Promise<string>;
  workspaceId: BrandId | null;
  selectWorkspace: (id: BrandId) => void;
  invalidate: () => void;
}
export const SessionContext = createContext<Session | null>(null);
export const useG01Session = () => useContext(SessionContext);
class AccessVerificationDenied extends Error {}
export function isAuthorizedProfile(value: unknown): value is Profile {
  if (!value || typeof value !== 'object') return false;
  const data = value as Profile;
  const roles: Persona[] = ['super_admin', 'owner_admin', 'office_staff', 'technician'];
  return typeof data.user?.id === 'string' && typeof data.user?.email === 'string' &&
    Array.isArray(data.memberships) && data.memberships.length > 0 &&
    data.memberships.every(m => m && typeof m === 'object' && ['solarcell', 'smart_home', 'cctv'].includes(m.workspace_id) &&
      roles.includes(m.role as Persona) && typeof m.name === 'string');
}

/** Firebase identifies the user; only the Worker supplies CABMS memberships. */
export function G01SessionProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workspaceId, setWorkspaceId] = useState<BrandId | null>(null);
  const generation = useRef(0);
  const principal = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    const unsubscribe = onIdTokenChanged(auth, async (user: User | null) => {
      const request = ++generation.current;
      const sameUser = !!user && principal.current === user.uid;
      if (!sameUser) { setProfile(null); setWorkspaceId(null); setLoading(true); }
      setError('');
      try {
        if (user) {
          const response = await apiGetCurrentUser(await user.getIdToken());
          if (!active || request !== generation.current) return;
          if (!response.ok) {
            if (response.status === 401 || response.status === 403 || response.status === 404) throw new AccessVerificationDenied();
            throw new Error('CABMS is temporarily unavailable');
          }
          if (!isAuthorizedProfile(response.data)) throw new AccessVerificationDenied();
          if (!response.data.memberships.length) throw new Error('No authorized workspace membership.');
          setProfile(response.data);
          principal.current = user.uid;
          setWorkspaceId(previous => response.data!.memberships.some(m => m.workspace_id === previous) ? previous : response.data!.memberships[0].workspace_id as BrandId);
        }
      } catch (error) {
        const code = (error as { code?: string })?.code;
        const denied = error instanceof AccessVerificationDenied || ['auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token'].includes(code || '');
        if (active && request === generation.current && (!sameUser || denied)) { setProfile(null); setWorkspaceId(null); }
        if (active && request === generation.current) setError('CABMS access could not be verified. Check your connection and authorized membership, then sign in again.');
      } finally {
        if (active && request === generation.current) setLoading(false);
      }
    });
    return () => { active = false; generation.current++; unsubscribe(); };
  }, []);
  const login = async () => {
    setError('');
    setLoading(true);
    try { await signInWithPopup(auth, googleAuthProvider); }
    catch { setLoading(false); setError('Google sign-in was not completed. Please try again.'); }
  };
  const logout = async () => {
    generation.current++;
    principal.current = null;
    setProfile(null);
    setWorkspaceId(null);
    try { await signOut(auth); }
    catch { setError('Sign-out could not be completed. Close this session and retry.'); }
  };
  const token = async () => {
    if (!auth.currentUser || !profile) throw new Error('Authentication required');
    return auth.currentUser.getIdToken();
  };
  const selectWorkspace = (id: BrandId) => {
    if (profile?.memberships.some(m => m.workspace_id === id)) setWorkspaceId(id);
  };
  const invalidate = () => {
    generation.current++;
    principal.current = null;
    setProfile(null);
    setWorkspaceId(null);
    setLoading(false);
    setError('Your CABMS session or permission changed. Sign in again to verify access.');
  };
  return <SessionContext.Provider value={{ profile, loading, error, login, logout, token, workspaceId, selectWorkspace, invalidate }}>{children}</SessionContext.Provider>;
}
