/**
 * TASK-08 / H18: one-shot STAGE JWT + ACTUAL application helper acceptance.
 * Requires strictly isolated SQL fixture 79; ALWAYS apply SQL 80 cleanup.
 * No successful profile merges or member approvals are committed by this test.
 * Report safe statuses/codes only: never log credentials, IDs, names or DTOs.
 */
'use strict';
const {registerHooks}=require('node:module');
registerHooks({resolve(specifier,context,next){
 return next(['./player-profiles','./group-read','./permissions'].includes(specifier)?specifier+'.ts':specifier,context);
}});
const {createClient}=require('@supabase/supabase-js');
const {approveNamedPlayerProfileLink,hasRecipientLinkName,
 isValidProfileLinkDisplayName,profileLinkRpc}=require('../../../lib/profile-links.ts');
const STAGE='https://zzjwpresqkefnyjyisgd.supabase.co';
const creds={
 owner:['main-A@example.com','TASK08_STAGING_MAIN_A_PASSWORD'],
 recipient:['recipient@example.com','TASK08_STAGING_RECIPIENT_PASSWORD'],
 outsider:['outsider@example.com','TASK08_STAGING_OUTSIDER_PASSWORD'],
};
const out=[],db={};
function record(id,pass,r={}){out.push({id,outcome:pass?'PASS':'FAIL',...r});}
function d(r){return{status:r?.status??null,code:r?.error?.code??null};}
function validUUID(x){return typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);}
function make(key){return createClient(STAGE,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});}
async function rejectPromise(action,expectedCode){
 try{await action();return {ok:false,code:'UNEXPECTED_SUCCESS'};}
 catch(e){return{ok:expectedCode==null||e.code===expectedCode,code:e.code??null};}
}
(async()=>{
 try{
  if(process.env.TASK08_H18_APP_JWT_ONCE!=='1')throw Error('not_opted_in');
  const key=process.env.TASK08_STAGING_PUBLISHABLE_KEY;
  if(!key?.startsWith('sb_publishable_'))throw Error('publishable_key_required');
  for(const [who,[email,pass]] of Object.entries(creds)){
   const client=make(key);
   const login=await client.auth.signInWithPassword({email,password:process.env[pass]});
   if(login.error||!login.data?.session?.access_token||login.data.user?.email?.toLowerCase()!==email.toLowerCase())
    throw Error('STAGE_AUTH_UNAVAILABLE');
   db[who]=client;
  }
  const anon=make(key);
  const resp=await Promise.all(['PUBLIC','PRIVATE'].map(t=>db.owner.from('clubs').select('id,visibility')
   .eq('name','TASK08-H18-HTTP-20261120-'+t)));
  const [pub,priv]=resp.map(r=>!r.error&&r.data?.length===1?r.data[0]:null);
  if(!pub||!priv||pub.visibility!=='public'||priv.visibility!=='private')throw Error('fixture_clubs_missing');
  const rosters=await Promise.all([pub,priv].map(c=>db.owner.rpc('get_club_roster',{p_club_id:c.id})));
  const [pubR,privR]=rosters.map(r=>r.data);
  const member1=pubR?.find(r=>r.role==='member'&&!r.player_profiles?.linked_auth_user_id);
  const member2=privR?.find(r=>r.role==='member'&&!r.player_profiles?.linked_auth_user_id);
  if(!member1||!member2||pubR?.length!==2||privR?.length!==2)throw Error('fixture_members_missing');
  const recipientUser=await db.recipient.auth.getUser();
  if(recipientUser.error||!validUUID(recipientUser.data?.user?.id))throw Error('recipient_auth_missing');
  const args=(club,member)=>({p_club_id:club.id,p_member_id:member.id,p_target_auth_user_id:recipientUser.data.user.id});
  const [invite1,invite2]=await Promise.all([
   db.owner.rpc('request_player_profile_link',args(pub,member1)),
   db.owner.rpc('request_player_profile_link',args(priv,member2))
  ]);
  record('H18_APP_ADMIN_INVITES_HTTP',!invite1.error&&!invite2.error&&invite1.status===200&&invite2.status===200,
   {public_status:invite1.status,private_status:invite2.status});
  if(invite1.error||invite2.error)throw Error('invitations_failed');
  const ids=await Promise.all([pub,priv].map(c=>db.owner.rpc('list_player_profile_link_requests',{p_club_id:c.id})));
  const [a,b]=ids.map(x=>Array.isArray(x.data)&&x.data.length===1&&x.data[0].status==='pending'?x.data[0].id:null);
  if(!validUUID(a)||!validUUID(b))throw Error('pending_requests_missing');
  const [publicDetails,privateDetails]=await Promise.all([
   profileLinkRpc(db.recipient,'get_player_profile_link_request',{p_request_id:a}),
   profileLinkRpc(db.recipient,'get_player_profile_link_request',{p_request_id:b})
  ]);
  const pubMatch=hasRecipientLinkName(publicDetails)&&publicDetails.group_visibility==='public'
    &&publicDetails.group_display_name_suggestion==='H18-HTTP-PUBLIC-ALIAS'
    &&publicDetails.group_display_name_current==='H18-HTTP-PUBLIC-ALIAS'
    &&typeof publicDetails.review_token==='string'&&publicDetails.review_token.length>10;
  const privMatch=hasRecipientLinkName(privateDetails)&&privateDetails.group_visibility==='private'
    &&privateDetails.group_display_name_suggestion==='H18-HTTP-PRIVATE-PROFILE'
    &&privateDetails.group_display_name_current===null
    &&typeof privateDetails.review_token==='string'&&privateDetails.review_token.length>10;
  record('H18_APP_ACTUAL_HELPER_RECEIVER_PUBLIC_DTO',!!pubMatch);
  record('H18_APP_ACTUAL_HELPER_RECEIVER_PRIVATE_DTO',!!privMatch);
  if(!pubMatch||!privMatch)throw Error('receiver_dto_drift');
  const draft={name:'H18-APP-USER-CHOICE',inheritanceConsent:true,publicConfirmation:true};
  const before=JSON.stringify({draft,publicDetails});
  const noConsent=await rejectPromise(()=>approveNamedPlayerProfileLink(db.recipient,publicDetails,{...draft,publicConfirmation:false}),'42501');
  record('H18_APP_PUBLIC_CONFIRMATION_REQUIRED_NO_WRITE',noConsent.ok,{code:noConsent.code});
  const noInherit=await rejectPromise(()=>approveNamedPlayerProfileLink(db.recipient,publicDetails,{...draft,inheritanceConsent:false}),'42501');
  record('H18_APP_INHERITANCE_CONFIRMATION_REQUIRED',noInherit.ok,{code:noInherit.code});
  const invalid=await rejectPromise(()=>approveNamedPlayerProfileLink(db.recipient,publicDetails,{...draft,name:'\n'}),'22023');
  record('H18_APP_BAD_NAME_REJECTED_BEFORE_RPC',invalid.ok,{code:invalid.code});
  const stale=await rejectPromise(()=>approveNamedPlayerProfileLink(db.recipient,
   {...publicDetails,group_display_name_current:'H18-STALE'},draft),'PT409');
  record('H18_APP_REAL_PT409_MAPPED',stale.ok,{code:stale.code});
  const staleToken=await rejectPromise(()=>approveNamedPlayerProfileLink(db.recipient,
   {...publicDetails,review_token:'wrong-review-token'},draft));
  record('H18_APP_STALE_TOKEN_REJECTED',staleToken.ok&&staleToken.code!==undefined,{code:staleToken.code});
  const outsider=await rejectPromise(()=>approveNamedPlayerProfileLink(db.outsider,publicDetails,draft));
  record('H18_APP_OTHER_USER_CANNOT_ACCEPT',outsider.ok&&outsider.code!=null,{code:outsider.code});
  const anonymous=await rejectPromise(()=>approveNamedPlayerProfileLink(anon,publicDetails,draft));
  record('H18_APP_ANON_CANNOT_ACCEPT',anonymous.ok&&anonymous.code!=null,{code:anonymous.code});
  record('H18_APP_DRAFT_UNCHANGED',JSON.stringify({draft,publicDetails})===before);
  const privateResult=await approveNamedPlayerProfileLink({
   rpc:async(name,payload)=>({data:{status:'approved',merge_id:'synthetic-only',
     club_display_name:payload.p_club_display_name,public_name_confirmed:payload.p_public_confirmation},
     error:null,status:200})
  },privateDetails,{...draft,publicConfirmation:true});
  record('H18_APP_PRIVATE_CONSENT_FALSE',privateResult.public_name_confirmed===false);
  const after=await Promise.all([a,b].map(p_request_id=>db.recipient.rpc('get_player_profile_link_request',{p_request_id})));
  record('H18_APP_NEGATIVE_ONLY_STILL_PENDING',after.every(x=>!x.error&&x.data?.status==='pending'));
  const manager=await db.owner.rpc('get_player_profile_link_request',{p_request_id:a});
  record('H18_APP_MANAGER_SCOPED',!manager.error&&manager.data?.detail_scope==='manager'
   &&!('group_display_name_suggestion' in manager.data)&&!('review_token' in manager.data));
  if(out.some(x=>x.outcome!=='PASS'))process.exitCode=1;
 }catch(e){out.push({id:'H18_APP_STAGE_FIXTURE_OR_RUNTIME',outcome:'BLOCKED'});process.exitCode=1;}
 finally{
  for(const client of Object.values(db))await client.auth.signOut({scope:'local'}).catch(()=>{});
  console.log(JSON.stringify({project:'stage',phase:'H18_REAL_AUTH_APPLICATION_HELPER_ONE_SHOT',
   must_cleanup:'80_h18_real_http_fixture_cleanup.sql',success_mutations_performed:false,results:out},null,2));
 }
})();
