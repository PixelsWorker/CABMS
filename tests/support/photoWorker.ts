import worker from './worker.ts';
export default {
  async fetch(request:Request,env:Parameters<typeof worker.fetch>[1]) {
    // Exercise the asset fallback locally, even without a built frontend.
    env={...env,ASSETS:{fetch:async()=>new Response('fixture asset fallback')}};
    const bucket=env.PRIVATE_EVIDENCE;
    if(env.ENVIRONMENT==='test' && request.headers.get('X-Test-Storage-Failure')==='put' && bucket){
      return worker.fetch(request,{...env,PRIVATE_EVIDENCE:{
        get:key=>bucket.get(key),delete:key=>bucket.delete(key),put:async()=>{throw Error('fixture storage unavailable');}
      }});
    }
    const response=await worker.fetch(request,env);
    if(env.ENVIRONMENT==='test' && request.headers.get('X-Test-Response-Loss')==='after-commit' && response.ok){
      return new Response(null,{status:504});
    }
    return response;
  }
};
