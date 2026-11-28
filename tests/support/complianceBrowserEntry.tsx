import React from 'react';
import {createRoot} from 'react-dom/client';
import type {User} from 'firebase/auth';
import {AppContent} from '../../src/App.tsx';
import {CabmsProvider} from '../../src/context/CabmsContext.tsx';
import {G01SessionProvider} from '../../src/context/G01Session.tsx';
import {apiGetCurrentUser} from '../../src/services/g01Client.ts';

async function main(){
  const actor = new URLSearchParams(location.search).get('actor') ?? 'tech';
  const token = await (await fetch('/fixture-token?actor='+encodeURIComponent(actor))).text();
  const user = {uid: actor, getIdToken: async()=>token} as User;
  const dependencies = {
    currentUser: ()=>user,
    onIdTokenChanged: (callback:(identity:User|null)=>unknown)=>{callback(user);return ()=>{};},
    signOut: async()=>{throw Error('Fixture sign-out unavailable');},
    signIn: async()=>{throw Error('Fixture reauthentication unavailable');},
    getCurrentUser: apiGetCurrentUser,
  };
  createRoot(document.getElementById('root')!).render(<G01SessionProvider dependencies={dependencies}><CabmsProvider><AppContent/></CabmsProvider></G01SessionProvider>);
}
void main();
