// H56: real SDK + existing application helpers. Local synthetic stack only.
// Payload (local account passwords/key) is supplied in stdin, never logged.
const fs=require('node:fs');
const {createClient}=require('@supabase/supabase-js');
require('node:module').registerHooks({resolve(s,c,next){return next(['./player-profiles','./group-read','./permissions'].includes(s)?s+'.ts':s,c)}});
const {requestPlayerProfileLink,profileLinkRpc,hasRecipientLinkName,approveNamedPlayerProfileLink,reviewPlayerProfileLink}=require('../../lib/profile-links.ts');
const {readPublicDirectory,readPublicClubMemberCount,readClubRoster,readMyMemberships}=require('../../lib/group-read.ts');
const {submitNamedPublicJoin}=require('../../lib/public-club-join.ts');
let phase='setup',checks=0;
const ensure=(v)=>{if(!v)throw new Error('assertion');};
const done=()=>{checks++};
async function rpc(db,name,args={}){
 const {data,error}=await db.rpc(name,args);
 if(error)throw new Error('rpc_failed');
 return data;
}
async function denied(db,name,args,code,status){
 const r=await db.rpc(name,args);
 ensure(r.error&&r.error.code===code&&(!status||r.status===status));
}
async function rejects(fn){
 let blocked=false;try{await fn()}catch{blocked=true}ensure(blocked);
}
async function main(){
 const {url,key,actors,ids}=JSON.parse(fs.readFileSync(0,'utf8'));
 ensure(url==='http://127.0.0.1:54321'&&typeof key==='string'&&actors.length===3);
 const localFetch=(input,init)=>{
  const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  ensure(target.origin===url);
  return fetch(input,{...init,redirect:'error'});
 };
 const client=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:localFetch}});
 phase='auth';
 const users={};for(const a of actors){
  const db=client();const {data,error}=await db.auth.signInWithPassword({email:a.email,password:a.password});
  ensure(!error&&data.user?.id===a.uid&&data.session?.access_token);
  const me=await db.auth.getUser();ensure(!me.error&&me.data.user?.id===a.uid);users[a.role]=db;
 }
 const {owner,recipient,outsider}=users,anon=client();done();
 phase='count';ensure(await readPublicClubMemberCount(outsider,ids.public)===3);done();
 phase='directory';
 const directory=await readPublicDirectory(outsider,ids.public);
 ensure(directory.length===2&&directory.every(d=>d.is_unlinked===true&&Object.keys(d).sort().join(',')==='display_name,is_unlinked,reference'&&d.reference!==ids.public_member&&d.reference!==ids.legacy_member));done();
 phase='roster_boundary';await rejects(()=>readClubRoster(outsider,ids.private));
 const a=await anon.from('club_members').select('id').limit(1);ensure(a.error&&[401,403].includes(a.status));done();
 phase='manager';
 const pub=await requestPlayerProfileLink(owner,ids.public,ids.public_member,ids.recipient);
 const priv=await requestPlayerProfileLink(owner,ids.private,ids.private_member,ids.recipient);
 const legacy=await requestPlayerProfileLink(owner,ids.public,ids.legacy_member,ids.outsider);
 const detail=(db,id)=>profileLinkRpc(db,'get_player_profile_link_request',{p_request_id:id});
 const md=await detail(owner,pub);
 ensure(md.detail_scope==='manager'&&!('review_token' in md)&&!('group_display_name_current' in md)&&!('memberships' in md)&&!('source' in md));done();
 phase='third_party';
 const named=(d,name,confirmation,token=d.review_token,current=d.group_display_name_current)=>({
  p_request_id:d.id,p_review_token:token,p_club_display_name:name,p_expected_club_display_name:current,p_public_confirmation:confirmation
 });
 const d=await detail(recipient,pub);ensure(hasRecipientLinkName(d)&&d.group_visibility==='public'&&d.group_display_name_current==='H56 public current');
 await denied(outsider,'review_player_profile_link_named',named(d,'H56 invalid',true),'42501',403);
 await rejects(()=>detail(outsider,pub));done();
 phase='consent';
 await denied(recipient,'review_player_profile_link_named',named(d,'H56 invalid',false),'42501',403);
 await rejects(()=>approveNamedPlayerProfileLink(recipient,d,{name:'H56 invalid',inheritanceConsent:true,publicConfirmation:false}));done();
 phase='cas';
 await denied(recipient,'review_player_profile_link_named',named(d,'H56 invalid',true,d.review_token,'H56 stale'),'PT409',409);
 await denied(recipient,'review_player_profile_link_named',named(d,'H56 invalid',true,'obsolete-preview-token'),'P0001',400);done();
 phase='public_approval';
 const ap=await approveNamedPlayerProfileLink(recipient,d,{name:'H56 public chosen',inheritanceConsent:true,publicConfirmation:true});
 ensure(ap.status==='approved'&&ap.public_name_confirmed===true);done();
 phase='private_approval';
 const dp=await detail(recipient,priv);ensure(hasRecipientLinkName(dp)&&dp.group_visibility==='private');
 await denied(recipient,'review_player_profile_link_named',named(dp,'H56 invalid',true),'42501',403);
 const av=await approveNamedPlayerProfileLink(recipient,dp,{name:'H56 private chosen',inheritanceConsent:true,publicConfirmation:false});
 ensure(av.status==='approved'&&av.public_name_confirmed===false);done();
 phase='old_approval_denied';
 const dl=await detail(outsider,legacy);
 await denied(outsider,'review_player_profile_link',{p_request_id:legacy,p_decision:'approved',p_review_token:dl.review_token},'42501',403);
 ensure((await detail(outsider,legacy)).status==='pending');done();
 phase='reject';ensure((await reviewPlayerProfileLink(outsider,legacy,'rejected')).status==='rejected');done();
 phase='join_no_consent';
 const context={clubId:ids.join,userId:ids.outsider,visibility:'public',isMember:false,hasPendingRequest:false};
 const draft={reference:null,name:'H56 join chosen',message:'',publicConfirmation:true,inheritanceConsent:false,preview:null};
 await denied(outsider,'submit_public_club_claim_named',{p_club_id:ids.join,p_reference:null,p_message:null,p_review_token:null,p_club_display_name:'H56 invalid',p_public_confirmation:false},'42501',403);
 await rejects(()=>submitNamedPublicJoin(outsider,context,[],{...draft,publicConfirmation:false}));done();
 phase='join_approval';
 const req=await submitNamedPublicJoin(outsider,context,[],draft);
 const joined=await rpc(owner,'review_profile_join_request',{p_request_id:req,p_decision:'approved'});
 ensure(joined.status==='approved');done();
 phase='readback';
 const finalDir=await readPublicDirectory(outsider,ids.public);
 ensure(await readPublicClubMemberCount(outsider,ids.public)===3&&finalDir.length===2&&finalDir.some(x=>x.display_name==='H56 public chosen'&&!x.is_unlinked));
 const roster=await readClubRoster(recipient,ids.private);
 ensure(roster.some(x=>x.player_profile_id===ids.recipient_profile&&x.player_profiles?.club_display_name==='H56 private chosen'&&!x.player_profiles?.public_name_confirmed));
 const memberships=await readMyMemberships(outsider);ensure(memberships.some(x=>x.club_id===ids.join&&x.status==='active'));done();
 console.log(JSON.stringify({ok:true,checks}));
}
main().catch(()=>{console.log(JSON.stringify({ok:false,phase,checks}));});
