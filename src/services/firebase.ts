/**
 * CABMS Firebase Authentication & Client Configuration
 *
 * Configured for Firebase Spark project:
 * - Project: CABMS (cabms-panel)
 * - Number: 813654233421
 * - Identity: Google Sign-In & Firebase Auth
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

export const firebaseProjectMetadata = {
  projectName: 'CABMS',
  projectId: 'cabms-panel',
  projectNumber: '813654233421',
  parentOrg: 'chinedigital.com.au',
  environmentType: 'Unspecified',
  publicFacingName: 'project-813654233421',
  supportEmail: 'admin@chinedigital.com.au',
} as const;

export const CABMS_FIREBASE_PROJECT_ID = firebaseProjectMetadata.projectId;

export const firebaseConfig = {
  apiKey: 'AIzaSyD_y4n7pK9H7XwmFxBcFxAOxCWKfR4Rd9M',
  authDomain: 'cabms-panel.firebaseapp.com',
  projectId: CABMS_FIREBASE_PROJECT_ID,
  storageBucket: 'cabms-panel.firebasestorage.app',
  messagingSenderId: '813654233421',
  appId: '1:813654233421:web:2c6077f3100122fd472704',
  measurementId: 'G-RVCXC3XFL0',
};

// Initialize Firebase App (idempotent across reloads)
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Firebase Authentication instance (strictly Auth only per architecture)
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
