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
  return { get session(){return session!;}, get current(){return current;}, user, fire, start:(u:User|null)=>{current=u;return listener?.(u);}, text:()=>container.textContent!, flush:()=>act(async()=>{await new Promise(r=>setTimeout(r,0));}) };
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

test('same-user token refresh waits for Worker revalidation', async t => {
 const check = deferred<any>(); let calls = 0;
 const h = await harness(t,{authorize: async () => ++calls === 1 ? ok('a') : check.promise});
 const u=h.user('a'); await h.fire(u); const retained=h.session.token;
 const refresh=h.fire(u); await Promise.resolve();
 let resolved=false; const token=retained().then(v=>{resolved=true;return v;});
 await new Promise(r=>setTimeout(r,0)); assert.equal(resolved,false);
 check.resolve(ok('a')); await refresh; assert.equal(await token,'a');
});

test('same-user token read rejects if pending refresh denies membership', async t => {
 const check=deferred<any>(); let calls=0;
 const h=await harness(t,{authorize:async()=>++calls===1?ok('a'):check.promise});
 const u=h.user('a'); await h.fire(u); const retained=h.session.token;
 const refresh=h.fire(u); await Promise.resolve(); const token=retained();
 const assertion=assert.rejects(token,/Authentication changed/);
 check.resolve({ok:false,status:403}); await refresh; await assertion;
});

test('concurrent token reads leave superseded verification and fail closed on logout', async t => {
 const stalled=deferred<any>(); let calls=0;
 const h=await harness(t,{authorize:async()=>++calls===1?ok('a'):stalled.promise});
 const u=h.user('a'); await h.fire(u); const token=h.session.token;
 const old=h.fire(u); await Promise.resolve(); const a=token(); const b=token();
 const rejectedA=assert.rejects(a,/Authentication changed/); const rejectedB=assert.rejects(b,/Authentication changed/);
 await act(async()=>h.session.logout()); await Promise.all([rejectedA,rejectedB]);
 stalled.resolve(ok('a')); await old; assert.equal(h.session.profile,null);
});

test('new successful verification releases concurrent readers of obsolete request', async t => {
 const stale=deferred<any>(); let calls=0;
 const h=await harness(t,{authorize:async()=>{calls++;return calls===2?stale.promise:ok('a');}});
 const u=h.user('a');await h.fire(u);const retained=h.session.token;
 const old=h.fire(u);await Promise.resolve(); let completed=0; const a=retained().then(v=>{completed++;return v;});const b=retained().then(v=>{completed++;return v;});
 await new Promise(r=>setTimeout(r,0));assert.equal(completed,0);
 await h.fire(u);assert.deepEqual(await Promise.all([a,b]),['a','a']);
 stale.resolve({ok:false,status:403});await old;assert.equal(h.session.profile?.user.id,'user-a');
});

test('denial invalidates an older token read even after same user is reauthorized', async t => {
 const late=deferred<string>();let tokenCalls=0,authorizations=0;
 const u={uid:'a',getIdToken:async()=>++tokenCalls===2?late.promise:'a'} as User;
 const h=await harness(t,{initialUser:u,authorize:async()=>++authorizations===2?{ok:false,status:403}:ok('a')});
 await h.fire(u);const stale=h.session.token();const rejected=assert.rejects(stale,/Authentication changed/);
 await h.fire(u);await h.fire(u);late.resolve('a');await rejected;assert.equal(h.session.profile?.user.id,'user-a');
});

test('same-user verification unavailable rejects pending token and clears authorization', async t => {
 const check=deferred<any>();let calls=0;const h=await harness(t,{authorize:async()=>++calls===1?ok('a'):check.promise});
 const u=h.user('a');await h.fire(u);const retained=h.session.token;const refresh=h.fire(u);await Promise.resolve();
 const read=retained();const denied=assert.rejects(read,/Authentication changed/);check.resolve({ok:false,status:503});await refresh;await denied;
 assert.equal(h.session.profile,null);await assert.rejects(h.session.token(),/Authentication required/);
});

test('temporary same-user failure performs one fresh verification and restores only new memberships', async t => {
 const retry=deferred<any>();let calls=0;const h=await harness(t,{authorize:async()=>++calls===1?ok('a'):calls===2?{ok:false,status:503}:retry.promise});
 const u=h.user('a');await h.fire(u);const retainedSelect=h.session.selectWorkspace;let refresh!:Promise<void>;await act(async()=>{refresh=Promise.resolve(h.start(u));await new Promise(r=>setTimeout(r,0));});
 assert.equal(calls,3);assert.equal(h.session.profile,null);await assert.rejects(h.session.token(),/Authentication required/);
 await act(async()=>{retry.resolve({ok:true,status:200,data:{user:profile('a').user,memberships:[{workspace_id:'cctv',name:'CCTV',role:'office_staff'}]}});await refresh;});
 assert.equal(h.session.workspaceId,'cctv');await act(async()=>retainedSelect('solarcell'));assert.equal(h.session.workspaceId,'cctv');
});
for(const status of [401,403]) test(`same-user ${status} denies without recovery retry`,async t=>{
 let calls=0;const h=await harness(t,{authorize:async()=>++calls===1?ok('a'):{ok:false,status}});const u=h.user('a');await h.fire(u);await h.fire(u);assert.equal(calls,2);assert.equal(h.session.profile,null);await assert.rejects(h.session.token(),/Authentication required/);
});
test('network failure makes only one recovery attempt and remains unavailable',async t=>{
 let calls=0;const h=await harness(t,{authorize:async()=>{if(++calls===1)return ok('a');throw Error('network');}});const u=h.user('a');await h.fire(u);await h.fire(u);assert.equal(calls,3);assert.equal(h.session.profile,null);assert.match(h.session.error,/temporarily unavailable/);
});
test('logout while recovery is pending cannot restore access',async t=>{
 const retry=deferred<any>();let calls=0;const h=await harness(t,{authorize:async()=>++calls===1?ok('a'):calls===2?{ok:false,status:503}:retry.promise});const u=h.user('a');await h.fire(u);let refresh!:Promise<void>;await act(async()=>{refresh=Promise.resolve(h.start(u));await new Promise(r=>setTimeout(r,0));});await act(async()=>h.session.logout());await act(async()=>{retry.resolve(ok('a'));await refresh;});assert.equal(h.session.profile,null);
});
test('old identity recovery cannot replace a new identity',async t=>{
 const retry=deferred<any>();let calls=0;const h=await harness(t,{authorize:async user=>{calls++;if(user.uid==='b')return ok('b');return calls===1?ok('a'):calls===2?{ok:false,status:503}:retry.promise;}});await h.fire(h.user('a'));let refresh!:Promise<void>;await act(async()=>{refresh=Promise.resolve(h.start(h.user('a')));await new Promise(r=>setTimeout(r,0));});await h.fire(h.user('b'));await act(async()=>{retry.resolve(ok('a'));await refresh;});assert.equal(h.session.profile?.user.id,'user-b');
});

for (const oldResponse of [ok('a'), {ok:false,status:403}]) test(`failed logout recovery supersedes stalled verification (${oldResponse.status})`, async t => {
 const stale=deferred<any>(), fresh=deferred<any>(); let calls=0;
 const h=await harness(t,{signOut:async()=>{throw Error('sign-out failed');},authorize:async()=>{calls++;if(calls===1)return ok('a');if(calls===2)return stale.promise;if(calls===3)return {ok:true,status:200,data:{user:profile('a').user,memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'},{workspace_id:'cctv',name:'CCTV',role:'office_staff'}]}};return fresh.promise;}});
 const u=h.user('a');await h.fire(u);
 let old!:Promise<void>;await act(async()=>{old=Promise.resolve(h.start(u));await Promise.resolve();});
 const before=h.session.token();const rejected=assert.rejects(before,/Authentication changed/);
 await act(async()=>h.session.logout());await rejected;
 assert.equal(await h.session.token(),'a');await act(async()=>h.session.selectWorkspace('cctv'));assert.equal(h.session.workspaceId,'cctv');
 let newer!:Promise<void>;await act(async()=>{newer=Promise.resolve(h.start(u));await Promise.resolve();});
 await act(async()=>{stale.resolve(oldResponse);await old;});
 let settled=false;const newToken=h.session.token().then(v=>{settled=true;return v;});await new Promise(r=>setTimeout(r,0));assert.equal(settled,false);
 await act(async()=>{fresh.resolve(ok('a'));await newer;});assert.equal(await newToken,'a');assert.equal(h.session.profile?.user.id,'user-a');
});
for (const status of [401,403,503]) test(`failed logout recovery ${status} does not restore authorization`,async t=>{
 let calls=0;const h=await harness(t,{signOut:async()=>{throw Error('failure');},authorize:async()=>++calls===1?ok('a'):{ok:false,status}});await h.fire(h.user('a'));await act(async()=>h.session.logout());assert.equal(h.session.profile,null);await assert.rejects(h.session.token(),/Authentication required/);
});
test('identity change during failed logout recovery cannot restore old identity',async t=>{
 const recovery=deferred<any>();let calls=0;const h=await harness(t,{signOut:async()=>{throw Error('failure');},authorize:async user=>{calls++;if(user.uid==='b')return ok('b');return calls===1?ok('a'):recovery.promise;}});await h.fire(h.user('a'));let logout!:Promise<void>;await act(async()=>{logout=h.session.logout();await Promise.resolve();});await h.fire(h.user('b'));await act(async()=>{recovery.resolve(ok('a'));await logout;});assert.equal(h.session.profile?.user.id,'user-b');
});
