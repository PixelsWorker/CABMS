/**
 * CABMS Worker Backend Types
 */

import { D1Database } from './db/d1.ts';
export * from '../contracts/settings.ts';

export interface Env {
  DB: D1Database;
  FIREBASE_PROJECT_ID?: string;
  ENVIRONMENT?: string;
}

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string | null;
  providerId: string;
  providerSubjectId: string;
}

export interface WorkspaceAuthContext extends AuthContext {
  workspaceId: string;
  role: 'super_admin' | 'owner_admin' | 'office_staff' | 'technician';
}
