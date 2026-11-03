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
type SessionDependencies = {
  currentUser: () => User | null;
  onIdTokenChanged: (callback: (user: User | null) => void | Promise<void>) => () => void;
  signOut: () => Promise<void>;
  signIn: () => Promise<void>;
  getCurrentUser: typeof apiGetCurrentUser;
};
const productionDependencies: SessionDependencies = {
  currentUser: () => auth.currentUser,
  onIdTokenChanged: callback => onIdTokenChanged(auth, callback),
  signOut: () => signOut(auth),
  signIn: () => signInWithPopup(auth, googleAuthProvider).then(() => undefined),
  getCurrentUser: apiGetCurrentUser,
};
export function G01SessionProvider({ children, dependencies = productionDependencies }: { children: React.ReactNode; dependencies?: SessionDependencies }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workspaceId, setWorkspaceId] = useState<BrandId | null>(null);
  const generation = useRef(0);
  const principal = useRef<string | null>(null);
  const authorizedProfile = useRef<Profile | null>(null);
  const identityEpoch = useRef(0);
  const verification = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const wakeVerification = useRef(new Set<() => void>());
  const wakePendingTokens = () => { for (const wake of wakeVerification.current) wake(); wakeVerification.current.clear(); };
  const signOutPending = useRef<{ id: number; uid: string } | null>(null);
  const logoutSequence = useRef(0);
  useEffect(() => {
    let active = true;
    const unsubscribe = dependencies.onIdTokenChanged((user: User | null) => {
      wakePendingTokens();
      const pending = handleUser(user);
      const operation = { generation: generation.current, promise: pending };
      verification.current = operation;
      void pending.finally(() => { if (verification.current === operation) verification.current = null; });
      return pending;
    });
    async function handleUser(user: User | null) {
      if (user && signOutPending.current?.uid === user.uid) return;
      if (user && signOutPending.current && signOutPending.current.uid !== user.uid) signOutPending.current = null;
      if (!user || (principal.current && principal.current !== user.uid)) identityEpoch.current++;
      if (!user) {
        principal.current = null;
        authorizedProfile.current = null;
        signOutPending.current = null;
        setProfile(null);
        setWorkspaceId(null);
      }
      const request = ++generation.current;
      const sameUser = !!user && principal.current === user.uid;
      if (!sameUser) { principal.current = null; authorizedProfile.current = null; setProfile(null); setWorkspaceId(null); setLoading(true); }
      setError('');
      try {
        if (user) {
          const verify = async () => {
            const response = await dependencies.getCurrentUser(await user.getIdToken());
            if (!response.ok) {
              if (response.status === 401 || response.status === 403 || response.status === 404) throw new AccessVerificationDenied();
              throw new Error('CABMS is temporarily unavailable');
            }
            if (!isAuthorizedProfile(response.data)) throw new AccessVerificationDenied();
            return response.data;
          };
          let response: Awaited<ReturnType<typeof verify>>;
          try {
            response = await verify();
          } catch (error) {
            const code = (error as { code?: string })?.code;
            if (error instanceof AccessVerificationDenied || ['auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token'].includes(code || '') || !sameUser) throw error;
            if (!active || request !== generation.current || dependencies.currentUser()?.uid !== user.uid) return;
            identityEpoch.current++; wakePendingTokens(); principal.current = null; authorizedProfile.current = null; setProfile(null); setWorkspaceId(null);
            setLoading(true); setError('CABMS is temporarily unavailable. Retrying access verification.');
            response = await verify();
          }
          if (!active || request !== generation.current || dependencies.currentUser()?.uid !== user.uid) return;
          setError('');
          if (!response.memberships.length) throw new Error('No authorized workspace membership.');
          authorizedProfile.current = response;
          setProfile(response);
          principal.current = user.uid;
          setWorkspaceId(previous => response.memberships.some(m => m.workspace_id === previous) ? previous : response.memberships[0].workspace_id as BrandId);
        }
      } catch (error) {
        const code = (error as { code?: string })?.code;
        const denied = error instanceof AccessVerificationDenied || ['auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token'].includes(code || '');
        if (active && request === generation.current) { identityEpoch.current++; wakePendingTokens(); principal.current = null; authorizedProfile.current = null; setProfile(null); setWorkspaceId(null); }
        if (active && request === generation.current) setError(denied ? 'CABMS access was denied. Sign in again after your membership is restored.' : 'CABMS is temporarily unavailable. Please try signing in again later.');
      } finally {
        if (active && request === generation.current) setLoading(false);
      }
    }
    return () => { active = false; generation.current++; identityEpoch.current++; wakePendingTokens(); unsubscribe(); };
  }, [dependencies]);
  const login = async () => {
    setError('');
    setLoading(true);
    try { await dependencies.signIn(); }
    catch { setLoading(false); setError('Google sign-in was not completed. Please try again.'); }
  };
  const logout = async () => {
    const user = dependencies.currentUser();
    const request = ++generation.current;
    identityEpoch.current++;
    wakePendingTokens();
    const operation = user ? { id: ++logoutSequence.current, uid: user.uid } : null;
    signOutPending.current = operation;
    principal.current = null;
    authorizedProfile.current = null;
    setProfile(null);
    setWorkspaceId(null);
    setLoading(true);
    setError('');
    try {
      await dependencies.signOut();
      if (request !== generation.current) return;
      principal.current = null;
      if (signOutPending.current === operation) signOutPending.current = null;
      setLoading(false);
    } catch {
      if (signOutPending.current === operation) signOutPending.current = null;
      if (request !== generation.current) return;
      setError('Sign-out failed. You are still signed in; please retry.');
      if (user && dependencies.currentUser()?.uid === user.uid) {
        const retryGeneration = ++generation.current;
        try {
          const response = await dependencies.getCurrentUser(await user.getIdToken());
          if (retryGeneration !== generation.current || dependencies.currentUser()?.uid !== user.uid) return;
          if (!response.ok || !isAuthorizedProfile(response.data)) throw new AccessVerificationDenied();
          if (verification.current && verification.current.generation < retryGeneration) {
            verification.current = null;
            wakePendingTokens();
          }
          authorizedProfile.current = response.data;
          setProfile(response.data);
          principal.current = user.uid;
          setWorkspaceId(response.data.memberships.some(m => m.workspace_id === workspaceId) ? workspaceId : response.data.memberships[0].workspace_id as BrandId);
          setError('Sign-out failed. You are still signed in; please retry.');
        } catch {
          if (retryGeneration === generation.current) { principal.current = null; authorizedProfile.current = null; setProfile(null); setWorkspaceId(null); }
        } finally {
          if (retryGeneration === generation.current) setLoading(false);
        }
      } else setLoading(false);
    }
  };
  const token = async () => {
    const user = dependencies.currentUser();
    const verifiedPrincipal = principal.current;
    const requestEpoch = identityEpoch.current;
    const verifiedProfile = profile;
    if (!user || !verifiedProfile || !verifiedPrincipal || user.uid !== verifiedPrincipal || signOutPending.current) throw new Error('Authentication required');
    const idToken = await user.getIdToken();
    while (verification.current) {
      const pending = verification.current;
      let wake!: () => void;
      const superseded = new Promise<void>(resolve => { wake = resolve; wakeVerification.current.add(resolve); });
      await Promise.race([pending.promise, superseded]);
      wakeVerification.current.delete(wake);
      if (requestEpoch !== identityEpoch.current) break;
      if (verification.current === pending) break;
    }
    if (requestEpoch !== identityEpoch.current || dependencies.currentUser()?.uid !== user.uid || principal.current !== verifiedPrincipal || signOutPending.current) {
      throw new Error('Authentication changed while obtaining a token');
    }
    return idToken;
  };
  const selectWorkspace = (id: BrandId) => {
    if (principal.current && dependencies.currentUser()?.uid === principal.current && !signOutPending.current && !verification.current && authorizedProfile.current?.memberships.some(m => m.workspace_id === id)) setWorkspaceId(id);
  };
  const invalidate = () => {
    generation.current++;
    identityEpoch.current++;
    wakePendingTokens();
    principal.current = null;
    authorizedProfile.current = null;
    setProfile(null);
    setWorkspaceId(null);
    setLoading(false);
    setError('Your CABMS session or permission changed. Sign in again to verify access.');
  };
  return <SessionContext.Provider value={{ profile, loading, error, login, logout, token, workspaceId, selectWorkspace, invalidate }}>{children}</SessionContext.Provider>;
}
