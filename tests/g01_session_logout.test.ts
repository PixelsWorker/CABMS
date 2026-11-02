import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { G01SessionProvider, useG01Session } from '../src/context/G01Session.tsx';
import type { User } from 'firebase/auth';

const profile = (uid: string, role: 'office_staff' | 'super_admin' = 'super_admin') => ({ user: { id: `user-${uid}`, email: `${uid}@example.test`, display_name: uid }, memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role }] });
const ok = (uid: string) => ({ ok: true as const, status: 200, data: profile(uid) });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

async function harness(t: { after(fn: () => void): void }, opts: { signOut?: () => Promise<void>; authorize?: (user: User) => Promise<any>; initialUser?: User }) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const names = ['window','document','navigator','HTMLElement','IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis,name)]));
  for (const name of names) Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:name==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[name]});
  const container=dom.window.document.getElementById('root')!; const root=createRoot(container);
  let current=opts.initialUser ?? null; let listener: ((user: User|null)=>void|Promise<void>)|undefined; let session: ReturnType<typeof useG01Session>|null=null;
  const dependencies={currentUser:()=>current,onIdTokenChanged:(cb:typeof listener)=>{listener=cb;return()=>{};},signOut:opts.signOut??(async()=>{current=null;await listener?.(null);}),signIn:async()=>{},getCurrentUser:async(token:string)=>opts.authorize?opts.authorize(current as User):ok(token)};
  const Probe=()=>{session=useG01Session();return React.createElement('div',{role:'status'},`${session?.profile?.user.id??'signed-out'}|${session?.workspaceId??''}|${session?.error??''}`);};
  await act(async()=>root.render(React.createElement(G01SessionProvider,{dependencies, children: React.createElement(Probe)})));
  const user=(uid:string, getIdToken:()=>Promise<string>=async()=>uid) => ({uid,getIdToken} as unknown as User);
  const fire=async(u:User|null)=>{current=u;await act(async()=>{await listener?.(u);});};
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();for(const n of names){const d=saved.get(n);if(d)Object.defineProperty(globalThis,n,d);else delete (globalThis as any)[n];}});
  return { get session(){return session!;}, get current(){return current;}, user, fire, text:()=>container.textContent!, flush:()=>act(async()=>{await new Promise(r=>setTimeout(r,0));}) };
}

test('provider authorizes initially; successful logout clears session with null callback',async t=>{const h=await harness(t,{initialUser:{uid:'a',getIdToken:async()=> 'a'} as User});await h.fire(h.user('a'));assert.equal(h.session.profile?.user.id,'user-a');await act(async()=>h.session.logout());assert.equal(h.session.profile,null);assert.equal(h.session.workspaceId,null);assert.equal(h.text().includes('signed-out'),true);});
test('successful logout without immediate Firebase callback stays fail closed',async t=>{const sign=deferred<void>();const h=await harness(t,{initialUser:{uid:'a',getIdToken:async()=> 'a'} as User,signOut:()=>sign.promise});await h.fire(h.user('a'));let done!:Promise<void>;await act(async()=>{done=h.session.logout();await h.flush();});assert.equal(h.session.profile,null);sign.resolve();await act(async()=>done);assert.equal(h.session.profile,null);});
test('rejected logout reports failure and revalidates before restoring authorization',async t=>{let calls=0;const h=await harness(t,{initialUser:{uid:'a',getIdToken:async()=> 'a'} as User,signOut:async()=>{throw Error('denied')},authorize:async()=>{calls++;return ok('a');}});await h.fire(h.user('a'));await act(async()=>h.session.logout());assert.equal(calls,2);assert.match(h.session.error,/Sign-out failed/);assert.equal(h.session.profile?.user.id,'user-a');});
test('logout rejects a token that resolves after logout begins',async t=>{const token=deferred<string>();let count=0;const u={uid:'a',getIdToken:async()=>++count===1?'a':token.promise} as User;const h=await harness(t,{initialUser:u});await h.fire(u);assert.ok(h.session.profile);let pending!:Promise<string>;await act(async()=>{pending=h.session.token();});await act(async()=>h.session.logout());token.resolve('late-token');await assert.rejects(pending,/Authentication changed/);});
test('stale authorization response cannot restore session after logout',async t=>{const old=deferred<any>();const h=await harness(t,{initialUser:{uid:'a',getIdToken:async()=> 'a'} as User,authorize:()=>old.promise});const verifying=h.fire(h.user('a'));await h.session.logout();old.resolve(ok('a'));await verifying;assert.equal(h.session.profile,null);});
for (const status of [403, 503]) {
 test(`Worker ${status} revalidation never restores cached profile`,async t=>{const response={ok:false,status};let calls=0;const h=await harness(t,{initialUser:{uid:'a',getIdToken:async()=> 'a'} as User,signOut:async()=>{throw Error();},authorize:async()=>++calls===1?ok('a'):response});await h.fire(h.user('a'));assert.ok(h.session.profile);await act(async()=>h.session.logout());assert.equal(calls,2);assert.equal(h.session.profile,null);assert.equal(h.session.workspaceId,null);assert.match(h.session.error,/Sign-out failed/);await assert.rejects(h.session.token(),/Authentication required/);});
}
test('same-user callback cannot revive pending logout and a new identity remains authorized',async t=>{const sign=deferred<void>();let current:User|null={uid:'a',getIdToken:async()=> 'a'} as User;const h=await harness(t,{initialUser:current,signOut:()=>sign.promise});await h.fire(current);let done!:Promise<void>;await act(async()=>{done=h.session.logout();});await h.fire(h.user('a'));assert.equal(h.session.profile?.user.id,undefined);await h.fire(h.user('b'));assert.equal(h.session.profile?.user.id,'user-b');assert.equal(await h.session.token(),'b');sign.resolve();await act(async()=>done);assert.equal(h.session.profile?.user.id,'user-b');});

 test('retained token function stays denied until failed logout revalidation completes', async t => {
  const revalidate = deferred<any>();
  let calls = 0;
  const h = await harness(t, { signOut: async () => { throw Error('failed'); }, authorize: async () => ++calls === 1 ? ok('a') : revalidate.promise });
  await h.fire(h.user('a'));
  const retainedToken = h.session.token;
  let logout!: Promise<void>;
  await act(async () => { logout = h.session.logout(); });
  assert.equal(calls, 2);
  await assert.rejects(retainedToken(), /Authentication required/);
  revalidate.resolve(ok('a'));
  await act(async () => logout);
  assert.equal(await h.session.token(), 'a');
 });
 test('retained token function stays denied after Worker revokes access on refresh', async t => {
  let calls = 0;
  const h = await harness(t, { authorize: async () => ++calls === 1 ? ok('a') : { ok: false, status: 403 } });
  await h.fire(h.user('a'));
  const retainedToken = h.session.token;
  await h.fire(h.user('a'));
  await assert.rejects(retainedToken(), /Authentication required/);
 });
