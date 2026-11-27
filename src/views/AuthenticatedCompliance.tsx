import React,{useMemo} from 'react';
import {useG01Session} from '../context/G01Session.tsx';
import {useCabms} from '../context/CabmsContext.tsx';
import {jobsClient} from '../services/complianceJobsClient.ts';
import {ComplianceWork} from './ComplianceWork.tsx';

export function AuthenticatedCompliance({screen,initialJob}:{initialJob?:{id:string;workspace_id:string};screen:'dashboard'|'jobs'|'compliance'}){
 const session=useG01Session()!;
 const {setActiveTab,setActiveBrandId,activeBrandId}=useCabms();
 const api=useMemo(()=>jobsClient(session.token),[session.token]);
 return <ComplianceWork initialJob={initialJob} actorId={session.profile!.user.id} key={session.profile!.user.id+'-'+session.profile!.memberships.map(m=>m.workspace_id+m.role).join()} api={api}
 activeWorkspace={activeBrandId} onWorkspace={id=>{if(id===activeBrandId)return;const m=session.profile!.memberships.find(m=>m.workspace_id===id);if(m)setActiveBrandId(m.workspace_id as typeof activeBrandId);}} memberships={session.profile!.memberships} screen={screen} onJobs={()=>setActiveTab('jobs')} onForm={()=>setActiveTab('compliance')} onLogin={session.login}/>;
}
