/**
 * H19 one-shot STAGE JWT/PostgREST acceptance. Synthetic SQL 88 must exist,
 * and guarded SQL 89 MUST be run after. No successful owner acceptance here.
 * Never print Auth IDs, JWT, raw DTOs, profile names or request UUIDs.
 */
import { createClient } from '@supabase/supabase-js';
const url='https://zzjwpresqkefnyjyisgd.supabase.co';
const accounts={
 owner:['main-A@example.com','TASK08_STAGING_MAIN_A_PASSWORD'],
 recipient:['recipient@example.com','TASK08_STAGING_RECIPIENT_PASSWORD'],
 outsider:['outsider@example.com','TASK08_STAGING_OUTSIDER_PASSWORD'],
};
const db={},users={},tests=[];
const make=key=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const mark=(id,pass,details={})=>tests.push({id,outcome:pass?'PASS':'FAIL',...details});
const meta=r=>({status:r?.status??null,error_code:r?.error?.code??null});
const denied=r=>!!r?.error&&r.data===null&&[400,401,403,404,409].includes(r.status);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
try{
 if(process.env.TASK08_H19_HTTP_WRITE_ONCE!=='1')throw Error('not_enabled');
 const key=process.env.TASK08_STAGING_PUBLISHABLE_KEY;
 if(!key?.startsWith('sb_publishable_'))throw Error('stage_publishable_key_required');
 for(const [label,[email,env]] of Object.entries(accounts)){
  const client=make(key);
  const login=await client.auth.signInWithPassword({email,password:process.env[env]});
  if(login.error||login.data?.user?.email?.toLowerCase()!==email.toLowerCase()
    ||!login.data?.session?.access_token)throw Error('test_auth_failed');
  db[label]=client;users[label]=login.data.user.id;
 }
 const anon=make(key);
 const group=await db.owner.from('clubs').select('id,visibility').eq('name','TASK08-H19-HTTP-20261120');
 const club=group.data?.length===1&&!group.error?group.data[0]:null;
 if(!club||club.visibility!=='private')throw Error('fixture_not_found');
 const roster=await db.owner.rpc('get_club_roster',{p_club_id:club.id});
 const members=Array.isArray(roster.data)?roster.data:[];
 const receiver=members.find(x=>x.role==='main_admin'&&x.player_profiles?.linked_auth_user_id===users.recipient);
 const regular=members.find(x=>x.role==='member'&&x.player_profiles?.linked_auth_user_id===users.outsider);
 if(!receiver||!regular||members.length!==3)throw Error('fixture_roles_wrong');
 mark('H19_REAL_FIXTURE_3_MEMBERS',true,{count:members.length});
 const candidates=await db.owner.rpc('get_club_owner_transfer_candidates',{p_club_id:club.id});
 mark('H19_OWNER_CANDIDATES_ONLY_ELIGIBLE',
  !candidates.error&&candidates.status===200&&candidates.data?.length===1
   &&candidates.data[0].member_id===receiver.id&&Object.keys(candidates.data[0]).sort().join(',')==='display_name,member_id',
   {count:candidates.data?.length??null});
 const unprivileged=await db.outsider.rpc('get_club_owner_transfer_candidates',{p_club_id:club.id});
 mark('H19_MEMBER_CANNOT_LIST_CANDIDATES',denied(unprivileged),meta(unprivileged));
 const unauth=await anon.rpc('get_club_owner_transfer_candidates',{p_club_id:club.id});
 mark('H19_ANON_CANNOT_LIST_CANDIDATES',denied(unauth),meta(unauth));
 const outsiderSend=await db.outsider.rpc('request_club_owner_transfer',{p_club_id:club.id,p_to_member_id:receiver.id});
 mark('H19_NONOWNER_REQUEST_DENIED',denied(outsiderSend),meta(outsiderSend));
 const badRole=await db.owner.rpc('request_club_owner_transfer',{p_club_id:club.id,p_to_member_id:regular.id});
 mark('H19_NONMAIN_CANDIDATE_DENIED',denied(badRole),meta(badRole));
 const sent=await db.owner.rpc('request_club_owner_transfer',{p_club_id:club.id,p_to_member_id:receiver.id});
 mark('H19_OWNER_PROPOSED_NO_AUTO_ACCEPT',sent.status===200&&!sent.error&&uuid(sent.data),meta(sent));
 if(!uuid(sent.data)||sent.error)throw Error('first_owner_request_failed');
 const [ownerList,recipientList,outsiderList]=await Promise.all([
  db.owner.rpc('list_my_club_owner_transfers'),
  db.recipient.rpc('list_my_club_owner_transfers'),
  db.outsider.rpc('list_my_club_owner_transfers'),
 ]);
 const own=ownerList.data?.find(x=>x.id===sent.data);
 const received=recipientList.data?.find(x=>x.id===sent.data);
 mark('H19_OWNER_AND_RECIPIENT_SCOPED_PENDING',
  !ownerList.error&&!recipientList.error&&own?.status==='pending'&&own.is_sender===true&&own.is_recipient===false
   &&received?.status==='pending'&&received.is_sender===false&&received.is_recipient===true
   &&own.club_id===club.id,{owner_count:ownerList.data?.length??null,receiver_count:recipientList.data?.length??null});
 mark('H19_OUTSIDER_CANNOT_READ_TRANSFERS',
  !outsiderList.error&&Array.isArray(outsiderList.data)&&outsiderList.data.length===0,
  {count:outsiderList.data?.length??null});
 const raw=await db.recipient.from('club_owner_transfer_requests').select('id').eq('club_id',club.id);
 mark('H19_RAW_TRANSFER_TABLE_DENIED',denied(raw),meta(raw));
 const duplicate=await db.owner.rpc('request_club_owner_transfer',{p_club_id:club.id,p_to_member_id:receiver.id});
 mark('H19_DUPLICATE_PT409',duplicate.error?.code==='PT409'&&duplicate.status===409,meta(duplicate));
 const outsiderApprove=await db.outsider.rpc('respond_club_owner_transfer',{p_request_id:sent.data,p_decision:'accepted'});
 mark('H19_OTHER_USER_CANNOT_APPROVE',denied(outsiderApprove),meta(outsiderApprove));
 const badCancel=await db.recipient.rpc('cancel_club_owner_transfer',{p_request_id:sent.data});
 mark('H19_RECIPIENT_CANNOT_CANCEL_OWNERS_REQUEST',denied(badCancel),meta(badCancel));
 const decline=await db.recipient.rpc('respond_club_owner_transfer',{p_request_id:sent.data,p_decision:'declined'});
 mark('H19_RECIPIENT_DECLINES',!decline.error&&decline.status===200&&decline.data==='declined',meta(decline));
 const rejected=await db.recipient.rpc('respond_club_owner_transfer',{p_request_id:sent.data,p_decision:'accepted'});
 mark('H19_DECLINED_CANNOT_LATER_ACCEPT',denied(rejected),meta(rejected));
 const renewed=await db.owner.rpc('request_club_owner_transfer',{p_club_id:club.id,p_to_member_id:receiver.id});
 mark('H19_OWNER_CAN_RESEND_AFTER_DECLINE',!renewed.error&&renewed.status===200&&uuid(renewed.data),meta(renewed));
 const ownerAfter=await db.owner.rpc('list_my_club_owner_transfers');
 mark('H19_FINAL_PENDING_AND_DECLINED_ONLY',
  !ownerAfter.error&&ownerAfter.data?.length===2
  &&ownerAfter.data.filter(x=>x.status==='declined').length===1
  &&ownerAfter.data.filter(x=>x.status==='pending').length===1,
  {count:ownerAfter.data?.length??null});
 const notifications=await db.recipient.from('notifications')
  .select('id,related_owner_transfer_request_id,type').eq('related_club_id',club.id);
 mark('H19_RECIPIENT_NOTIFICATIONS_LINKED',
  !notifications.error&&notifications.data?.length===2
  &&notifications.data.every(x=>x.type==='club_owner_transfer_requested'&&uuid(x.related_owner_transfer_request_id)),
  {notice_count:notifications.data?.length??null});
 if(tests.some(x=>x.outcome!=='PASS'))process.exitCode=1;
}catch{tests.push({id:'H19_SETUP_OR_RUNTIME',outcome:'BLOCKED'});process.exitCode=1;}
finally{
 for(const c of Object.values(db))await c.auth.signOut({scope:'local'}).catch(()=>{});
 console.log(JSON.stringify({project:'stage',phase:'H19_ONE_SHOT_AUTH_HTTP',
  fixture_cleanup_sql:'89_h19_real_http_fixture_cleanup.sql',tests},null,2));
}
