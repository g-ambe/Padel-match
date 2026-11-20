/**
 * H18 STAGING ONLY positive invitation + negative approval HTTP.
 * Uses isolated fixture SQL 79 and MUST be followed by cleanup SQL 80.
 * Successful named approval/merges are verified in separate SQL ROLLBACK 78/82.
 * NEVER log Auth tokens, names, users, raw UUIDs, returned DTOs, or passwords.
 */
import { createClient } from '@supabase/supabase-js';
const endpoint='https://zzjwpresqkefnyjyisgd.supabase.co';
const accounts={
 mainA:['main-A@example.com','TASK08_STAGING_MAIN_A_PASSWORD'],
 recipient:['recipient@example.com','TASK08_STAGING_RECIPIENT_PASSWORD'],
 outsider:['outsider@example.com','TASK08_STAGING_OUTSIDER_PASSWORD'],
};
const clients={},results=[];
function make(key){return createClient(endpoint,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{'x-task08-test':'h18-stage-only-once'}}});}
function mark(id,ok,meta={}){results.push({id,outcome:ok?'PASS':'FAIL',...meta});}
function meta(r){return{http_status:r?.status??null,code:r?.error?.code??null};}
function uuid(s){return typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);}
function denied(r){return !!r.error&&r.data===null&&[400,401,403,404,409].includes(r.status);}
try{
 if(process.env.TASK08_H18_STAGE_WRITE!=='1')throw Error('h18_stage_opt_in_required');
 const publishable=process.env.TASK08_STAGING_PUBLISHABLE_KEY;
 if(!publishable?.startsWith('sb_publishable_'))throw Error('publishable_key_required');
 for(const [role,[email,secret]] of Object.entries(accounts)){
  if(!process.env[secret])throw Error('test_password_unset');
  const client=make(publishable);
  const signed=await client.auth.signInWithPassword({email,password:process.env[secret]});
  if(signed.error||!signed.data?.session?.access_token||signed.data.user?.email?.toLowerCase()!==email.toLowerCase())throw Error('stage_auth_failed');
  clients[role]=client;
 }
 const anon=make(publishable);
 const groups=await Promise.all(['PUBLIC','PRIVATE'].map(tag=>clients.mainA.from('clubs').select('id,visibility').eq('name','TASK08-H18-HTTP-20261120-'+tag)));
 const [pub,priv]=groups.map(x=>!x.error&&x.data?.length===1?x.data[0]:null);
 if(!pub||!priv||pub.visibility!=='public'||priv.visibility!=='private')throw Error('fixture_groups_invalid');
 const rosters=await Promise.all([pub,priv].map(g=>clients.mainA.rpc('get_club_roster',{p_club_id:g.id})));
 const [pubRows,privRows]=rosters.map(x=>Array.isArray(x.data)?x.data:[]);
 const pubMember=pubRows.find(r=>r.role==='member'&&!r.player_profiles?.linked_auth_user_id);
 const privMember=privRows.find(r=>r.role==='member'&&!r.player_profiles?.linked_auth_user_id);
 if(!pubMember||!privMember||pubRows.length!==2||privRows.length!==2)throw Error('fixture_roster_invalid');
 mark('H18_FIXTURE_ROLES',true,{public_count:pubRows.length,private_count:privRows.length});

 const pubInvite=await clients.mainA.rpc('request_player_profile_link',{
  p_club_id:pub.id,p_member_id:pubMember.id,p_target_auth_user_id:(await clients.recipient.auth.getUser()).data.user?.id});
 const privInvite=await clients.mainA.rpc('request_player_profile_link',{
  p_club_id:priv.id,p_member_id:privMember.id,p_target_auth_user_id:(await clients.recipient.auth.getUser()).data.user?.id});
 // The existing submission RPC may report a successful write without a
 // scalar data payload through PostgREST. Confirm exact pending request via
 // the manager-scoped RPC rather than relying on its optional response shape.
 const [pubSent,privSent]=await Promise.all([
   clients.mainA.rpc('list_player_profile_link_requests',{p_club_id:pub.id}),
   clients.mainA.rpc('list_player_profile_link_requests',{p_club_id:priv.id})
 ]);
 const pubPending=Array.isArray(pubSent.data)?pubSent.data.filter(r=>r.status==='pending'&&r.club_id===pub.id):[];
 const privPending=Array.isArray(privSent.data)?privSent.data.filter(r=>r.status==='pending'&&r.club_id===priv.id):[];
 const pubRequestId=pubPending.length===1&&uuid(pubPending[0].id)?pubPending[0].id:null;
 const privRequestId=privPending.length===1&&uuid(privPending[0].id)?privPending[0].id:null;
 mark('H18_ADMIN_SENT_PUBLIC_INVITATION',!pubInvite.error&&pubInvite.status===200
   &&!pubSent.error&&pubRequestId!==null,
   {...meta(pubInvite),manager_pending_count:pubPending.length,response_type:typeof pubInvite.data});
 mark('H18_ADMIN_SENT_PRIVATE_INVITATION',!privInvite.error&&privInvite.status===200
   &&!privSent.error&&privRequestId!==null,
   {...meta(privInvite),manager_pending_count:privPending.length,response_type:typeof privInvite.data});
 if(pubInvite.error||privInvite.error||!pubRequestId||!privRequestId)throw Error('fixture_invitations_invalid');

 const adminRead=await clients.mainA.rpc('get_player_profile_link_request',{p_request_id:pubRequestId});
 const adminSafe=!adminRead.error&&adminRead.status===200
  &&adminRead.data?.detail_scope==='manager'
  &&!('review_token' in adminRead.data)
  &&!('group_display_name_suggestion' in adminRead.data)
  &&!('group_display_name_current' in adminRead.data)
  &&!('group_visibility' in adminRead.data);
 mark('H18_MANAGER_DETAILS_SCOPED',adminSafe,meta(adminRead));

 const alienRead=await clients.outsider.rpc('get_player_profile_link_request',{p_request_id:pubRequestId});
 mark('H18_OTHER_USER_CANNOT_PREVIEW',denied(alienRead),meta(alienRead));
 const publicPreview=await clients.recipient.rpc('get_player_profile_link_request',{p_request_id:pubRequestId});
 const privatePreview=await clients.recipient.rpc('get_player_profile_link_request',{p_request_id:privRequestId});
 const publicOk=!publicPreview.error&&publicPreview.status===200
  &&publicPreview.data?.detail_scope==='recipient'
  &&publicPreview.data.group_display_name_suggestion==='H18-HTTP-PUBLIC-ALIAS'
  &&publicPreview.data.group_display_name_current==='H18-HTTP-PUBLIC-ALIAS'
  &&publicPreview.data.group_visibility==='public'
  &&typeof publicPreview.data.review_token==='string'&&publicPreview.data.review_token.length>5;
 const privateOk=!privatePreview.error&&privatePreview.status===200
  &&privatePreview.data?.detail_scope==='recipient'
  &&privatePreview.data.group_display_name_suggestion==='H18-HTTP-PRIVATE-PROFILE'
  &&privatePreview.data.group_display_name_current===null
  &&privatePreview.data.group_visibility==='private'
  &&typeof privatePreview.data.review_token==='string'&&privatePreview.data.review_token.length>5;
 mark('H18_RECIPIENT_PUBLIC_ALIAS_SUGGESTED',publicOk,meta(publicPreview));
 mark('H18_RECIPIENT_PRIVATE_NAME_SUGGESTED',privateOk,meta(privatePreview));
 if(!publicOk||!privateOk)throw Error('scoped_preview_invalid');

 const args={
 p_request_id:pubRequestId,p_review_token:publicPreview.data.review_token,
 p_club_display_name:'H18-HTTP-PUBLIC-CHOSEN',p_expected_club_display_name:'H18-HTTP-PUBLIC-ALIAS',
 p_public_confirmation:true};
 const unauthed=await anon.rpc('review_player_profile_link_named',args);
 mark('H18_ANONYMOUS_APPROVAL_BLOCKED',denied(unauthed),meta(unauthed));
 const otherUser=await clients.outsider.rpc('review_player_profile_link_named',args);
 mark('H18_THIRD_PARTY_APPROVAL_BLOCKED',denied(otherUser),meta(otherUser));
 const withoutConsent=await clients.recipient.rpc('review_player_profile_link_named',{...args,p_public_confirmation:false});
 mark('H18_PUBLIC_CONSENT_REQUIRED',denied(withoutConsent),meta(withoutConsent));
 const wrongAlias=await clients.recipient.rpc('review_player_profile_link_named',{...args,p_expected_club_display_name:'H18-STALE'});
 mark('H18_CAS_CONFLICT_HTTP409',wrongAlias.error?.code==='PT409'&&wrongAlias.status===409,meta(wrongAlias));
 const wrongToken=await clients.recipient.rpc('review_player_profile_link_named',{...args,p_review_token:'invalid-preview-token'});
 mark('H18_INVALID_REVIEW_TOKEN_BLOCKED',denied(wrongToken),meta(wrongToken));
 const privatePublic=await clients.recipient.rpc('review_player_profile_link_named',{
  ...args,p_request_id:privRequestId,p_review_token:privatePreview.data.review_token,
  p_club_display_name:'H18-HTTP-PRIVATE-CHOSEN',p_expected_club_display_name:null,p_public_confirmation:true});
 mark('H18_PRIVATE_CANNOT_SET_PUBLIC_CONSENT',denied(privatePublic),meta(privatePublic));

 const pending=await clients.mainA.rpc('list_player_profile_link_requests',{p_club_id:pub.id});
 const pendingP=await clients.mainA.rpc('list_player_profile_link_requests',{p_club_id:priv.id});
 const listOK=[pending,pendingP].every((x)=>x.status===200&&!x.error&&Array.isArray(x.data)
  &&x.data.length===1&&x.data[0].status==='pending'
  &&!('club_display_name_selected' in x.data[0])
  &&!('club_display_name_public_confirmed_at' in x.data[0]));
 mark('H18_MANAGER_PENDING_NO_CONSENT_LEAK',listOK,{public_count:pending.data?.length??null,private_count:pendingP.data?.length??null});

 const after=await clients.recipient.rpc('get_player_profile_link_request',{p_request_id:pubRequestId});
 mark('H18_DENIALS_DID_NOT_APPROVE',!after.error&&after.data?.status==='pending'&&
   after.data?.detail_scope==='recipient',{status:after.status??null});
 const publicList=await clients.recipient.rpc('get_public_club_directory',{p_club_id:pub.id});
 mark('H18_UNLINKED_PUBLIC_ALIAS_STILL_VISIBLE',!publicList.error&&publicList.status===200
  &&Array.isArray(publicList.data)&&publicList.data.length===1&&
  publicList.data[0].is_unlinked===true&&publicList.data[0].display_name==='H18-HTTP-PUBLIC-ALIAS',
  {visible_count:publicList.data?.length??null});
 if(results.some(x=>x.outcome!=='PASS'))process.exitCode=1;
}catch(e){results.push({id:'H18_TEST_SETUP_OR_RUNTIME',outcome:'BLOCKED'});process.exitCode=1;}
finally{
 for(const client of Object.values(clients))await client.auth.signOut({scope:'local'}).catch(()=>{});
 console.log(JSON.stringify({project:'padel-hub-staging',phase:'H18_REAL_HTTP_ONE_SHOT',
  fixture_sql_79:true,cleanup_sql_80_required:true,results},null,2));
}
