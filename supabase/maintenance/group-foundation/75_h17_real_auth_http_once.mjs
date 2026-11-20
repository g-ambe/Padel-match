/**
 * H17 Stage ONLY one-shot Auth/PostgREST positive/negative join submission.
 * Never run without SQL 73 fixture; SQL 74 cleanup must follow.
 * Approvals and merge reversibility are tested separately via SQL ROLLBACK.
 * Never log auth IDs, raw names, token strings, full responses, or passwords.
 */
import { createClient } from '@supabase/supabase-js';

const url='https://zzjwpresqkefnyjyisgd.supabase.co';
const accounts={
 mainA:['main-A@example.com','TASK08_STAGING_MAIN_A_PASSWORD'],
 recipient:['recipient@example.com','TASK08_STAGING_RECIPIENT_PASSWORD'],
 outsider:['outsider@example.com','TASK08_STAGING_OUTSIDER_PASSWORD'],
};
const clients={},authUsers={},results=[];
function mark(id,passed,extra={}){
 results.push({id,outcome:passed?'PASS':'FAIL',...extra});
}
function make(key){
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
 global:{headers:{'x-task08-test':'h17-stage-one-shot'}}});
}
function errorMeta(r){return{status:r?.status??null,error_code:r?.error?.code??null};}
function denied(r){return r?.error&&r.data===null&&[400,401,403,404,409].includes(r.status);}
function validUUID(x){return typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);}
async function run(){
 if(process.env.TASK08_H17_REAL_WRITE_ONCE!=='1')throw Error('not_opted_into_stage_fixture');
 const key=process.env.TASK08_STAGING_PUBLISHABLE_KEY;
 if(!key?.startsWith('sb_publishable_'))throw Error('publishable_key_required');
 for(const [actor,[email,secret]] of Object.entries(accounts)){
   if(!process.env[secret])throw Error('missing_credential');
   const db=make(key);
   const signed=await db.auth.signInWithPassword({email,password:process.env[secret]});
   if(signed.error||signed.data?.user?.email?.toLowerCase()!==email.toLowerCase()||!signed.data?.session?.access_token)
     throw Error('stage_test_auth_invalid');
   clients[actor]=db;authUsers[actor]=signed.data.user.id;
 }
 const anon=make(key);
 const group=await clients.mainA.from('clubs').select('id,visibility')
  .eq('name','TASK08-H17-HTTP-20261120-PUBLIC');
 const club=group.data?.length===1&&!group.error?group.data[0]:null;
 if(!club||club.visibility!=='public')throw Error('H17_fixture_club_missing');
 const [directory,roster]=await Promise.all([
  clients.outsider.rpc('get_public_club_directory',{p_club_id:club.id}),
  clients.mainA.rpc('get_club_roster',{p_club_id:club.id})
 ]);
 const refs=Array.isArray(directory.data)?directory.data:[];
 const safeNames=!directory.error&&directory.status===200&&refs.length===1&&refs[0].is_unlinked===true
  &&refs[0].display_name==='H17 Public Provisional Alias'
  &&Object.keys(refs[0]).sort().join(',')==='display_name,is_unlinked,reference';
 mark('H17_PUBLIC_DIRECTORY_OPAQUE',safeNames,{visible:refs.length});
 const rows=Array.isArray(roster.data)?roster.data:[];
 const correctRoster=!roster.error&&roster.status===200&&rows.length===2
   &&rows.filter(m=>m.is_active).length===2;
 mark('H17_FIXTURE_ROSTER',correctRoster,{count:rows.length});
 if(!safeNames||!correctRoster)throw Error('H17_fixture_mismatch');

 const anonymousSubmission=await anon.rpc('submit_public_club_claim_named',{
  p_club_id:club.id,p_reference:null,p_message:null,p_review_token:null,
  p_club_display_name:'H17 HTTP Recipient Alias',p_public_confirmation:true});
 mark('H17_ANON_SUBMISSION_REJECTED',!!denied(anonymousSubmission),errorMeta(anonymousSubmission));

 const noConsent=await clients.recipient.rpc('submit_public_club_claim_named',{
  p_club_id:club.id,p_reference:null,p_message:null,p_review_token:null,
  p_club_display_name:'H17 HTTP Recipient Alias',p_public_confirmation:false});
 mark('H17_PUBLIC_CONFIRMATION_REQUIRED',!!denied(noConsent),errorMeta(noConsent));

 const invalidReference=await clients.outsider.rpc('submit_public_club_claim_named',{
  p_club_id:club.id,p_reference:'11111111-1111-4111-8111-111111111111',
  p_message:null,p_review_token:null,
  p_club_display_name:'H17 HTTP Outsider Alias',p_public_confirmation:true});
 mark('H17_INVALID_OPAQUE_REFERENCE_DENIED',!!denied(invalidReference),errorMeta(invalidReference));

 const rawIDAccess=await clients.outsider.rpc('submit_profile_join_request_named',{
  p_club_id:club.id,p_member_id:rows.find(m=>m.role==='member')?.id??null,
  p_message:null,p_review_token:null,p_club_display_name:'H17 HTTP Outsider Alias',p_public_confirmation:true});
 mark('H17_INTERNAL_MEMBER_ID_API_CLOSED',!!denied(rawIDAccess),errorMeta(rawIDAccess));

 const regular=await clients.recipient.rpc('submit_public_club_claim_named',{
  p_club_id:club.id,p_reference:null,p_message:null,p_review_token:null,
  p_club_display_name:'H17 HTTP Recipient Alias',p_public_confirmation:true});
 mark('H17_REGULAR_JOIN_SUBMITTED',regular.status===200&&!regular.error&&validUUID(regular.data),
  {status:regular.status??null,error_code:regular.error?.code??null});

 const preview=await clients.outsider.rpc('preview_public_club_claim',{
  p_club_id:club.id,p_reference:refs[0].reference});
 const boundPreview=preview.status===200&&!preview.error
   &&preview.data?.has_target===true&&typeof preview.data?.review_token==='string'
   &&preview.data.review_token.length>0;
 mark('H17_PROVISIONAL_PREVIEW',boundPreview,
   {status:preview.status??null,error_code:preview.error?.code??null});
 if(boundPreview){
  const claimed=await clients.outsider.rpc('submit_public_club_claim_named',{
   p_club_id:club.id,p_reference:refs[0].reference,p_message:null,
   p_review_token:preview.data.review_token,
   p_club_display_name:'H17 HTTP Outsider Alias',p_public_confirmation:true});
  mark('H17_PROVISIONAL_CLAIM_SUBMITTED',claimed.status===200&&!claimed.error&&validUUID(claimed.data),
   {status:claimed.status??null,error_code:claimed.error?.code??null});
 }
 // Stage's join_requests raw table is deliberately not SELECT-granted.
 // The normal UI accesses the manager-scoped read RPC, not the base table.
 const rawRequests=await clients.mainA.from('join_requests').select('id')
   .eq('club_id',club.id);
 mark('H17_RAW_JOIN_TABLE_CLOSED',!!denied(rawRequests),errorMeta(rawRequests));
 const requests=await clients.mainA.rpc('get_club_join_requests',{p_club_id:club.id});
 const submitted=Array.isArray(requests.data)?requests.data:[];
 const savedExact=!requests.error&&requests.status===200&&submitted.length===2
   &&submitted.every(r=>r.status==='pending'&&r.club_id===club.id)
   &&submitted.some(r=>r.requester_auth_user_id===authUsers.recipient
     &&r.target_club_member_id===null)
   &&submitted.some(r=>r.requester_auth_user_id===authUsers.outsider
     &&rows.some(m=>m.id===r.target_club_member_id&&m.role==='member')
     &&r.consent_at!==null);
 mark('H17_MANAGER_JOIN_REQUESTS_PENDING',savedExact,
  {status:requests.status??null,pending_count:submitted.length});
 // Alias/public-confirmation snapshots are purposely NOT in this limited DTO.
 // SQL read-only postflight separately confirms their saved values.
 const publicAfter=await clients.recipient.rpc('get_public_club_directory',{p_club_id:club.id});
 mark('H17_PENDING_NOT_PUBLISHED',!publicAfter.error&&publicAfter.status===200
  &&Array.isArray(publicAfter.data)&&publicAfter.data.length===1&&
  publicAfter.data[0].is_unlinked===true,{visible:publicAfter.data?.length??null});
 const rosterAfter=await clients.mainA.rpc('get_club_roster',{p_club_id:club.id});
 mark('H17_REQUESTS_DO_NOT_JOIN_BEFORE_APPROVAL',!rosterAfter.error
  &&rosterAfter.status===200&&rosterAfter.data?.length===2,{roster_count:rosterAfter.data?.length??null});
 if(results.some(x=>x.outcome!=='PASS'))process.exitCode=1;
}
try{await run();}
catch {results.push({id:'H17_STAGE_SETUP_OR_RUNTIME',outcome:'BLOCKED'});process.exitCode=1;}
finally{
 for(const x of Object.values(clients))await x.auth.signOut({scope:'local'}).catch(()=>{});
 console.log(JSON.stringify({
  project:'padel-hub-staging',phase:'H17-JWT-HTTP-ONE-SHOT',
  fixture_only:true,sql_cleanup_required:'74_h17_real_http_fixture_cleanup.sql',results
 },null,2));
}
