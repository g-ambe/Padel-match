/**
 * H16 one-shot Stage-only REAL Supabase Auth/PostgREST exercise.
 * Requires SQL 67 fixture and MUST be followed by SQL 68 cleanup.
 * No secrets, raw data, user IDs, full responses or names printed.
 */
import { createClient } from '@supabase/supabase-js';

const endpoint='https://zzjwpresqkefnyjyisgd.supabase.co';
const emails={mainA:['main-A@example.com','TASK08_STAGING_MAIN_A_PASSWORD'],
  outsider:['outsider@example.com','TASK08_STAGING_OUTSIDER_PASSWORD'],
  recipient:['recipient@example.com','TASK08_STAGING_RECIPIENT_PASSWORD']};
const results=[],clients={};
function mark(id,passed,metadata={}){results.push({id,outcome:passed?'PASS':'FAIL',...metadata});}
function minimal(res){return{status:res?.status??null,error_code:res?.error?.code??null,count:Array.isArray(res?.data)?res.data.length:null};}
function makeClient(key){return createClient(endpoint,key,{
 auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
 global:{headers:{'x-task08-test':'h16-stage-write-once'}}});}
function blocked(res,code='42501'){return res.error?.code===code&&[401,403].includes(res.status)&&res.data===null;}
function ok(res){return !res.error&&res.status===200;}
try{
 if(process.env.TASK08_H16_TEST_STAGE_WRITE!=='1')throw Error('stage_only_opt_in_required');
 const key=process.env.TASK08_STAGING_PUBLISHABLE_KEY;
 if(!key?.startsWith('sb_publishable_'))throw Error('stage_publishable_key_required');
 for(const [role,[email,passwordKey]] of Object.entries(emails)){
   const pass=process.env[passwordKey];if(!pass)throw Error('missing_stage_test_secret');
   const s=makeClient(key);const signed=await s.auth.signInWithPassword({email,password:pass});
   if(signed.error||signed.data.user?.email?.toLowerCase()!==email.toLowerCase())throw Error('stage_test_login_failed');
   clients[role]=s;
 }
 const anonymous=makeClient(key);
 const clubResults=await Promise.all(['PUBLIC','PRIVATE'].map(x=>
  clients.mainA.from('clubs').select('id,visibility')
   .eq('name','TASK08-H16-HTTP-20261120-'+x)));
 const [pub,pri]=clubResults.map(x=>!x.error&&x.data?.length===1?x.data[0]:null);
 if(!pub||!pri||pub.visibility!=='public'||pri.visibility!=='private')throw Error('stage_fixture_clubs_invalid');
 const [pr,vr]=await Promise.all([
  clients.mainA.rpc('get_club_roster',{p_club_id:pub.id}),
  clients.mainA.rpc('get_club_roster',{p_club_id:pri.id})
 ]);
 if(!ok(pr)||!ok(vr)||pr.data?.length!==4||vr.data?.length!==2)throw Error('stage_fixture_roster_invalid');
 const member=(res,role)=>res.data.find(r=>r.role===role&&r.player_profiles?.linked_auth_user_id);
 const owner=member(pr,'main_admin'),sub=member(pr,'sub_admin'),person=member(pr,'member');
 const unlinked=pr.data.find(r=>r.role==='member'&&r.player_profiles?.linked_auth_user_id===null);
 const personPrivate=vr.data.find(r=>r.role==='member');
 if(!owner||!sub||!person||!unlinked||!personPrivate)throw Error('fixture_members_missing');
 if(![...pr.data,...vr.data].every(x=>x.player_profiles?.club_display_name===null
   &&x.player_profiles?.public_name_confirmed===false))throw Error('fixture_alias_not_null');
 mark('H16_FIXTURE_ROSTER',true,{public_count:4,private_count:2});

 const directory=()=>clients.outsider.rpc('get_public_club_directory',{p_club_id:pub.id});
 const visibleBefore=await directory();
 const safeRows=res=>Array.isArray(res.data)&&res.data.every(x=>
   Object.keys(x).length===3&&Object.keys(x).sort().join(',')==='display_name,is_unlinked,reference');
 mark('H16_LEGACY_LINKED_HIDDEN',ok(visibleBefore)&&safeRows(visibleBefore)&&visibleBefore.data.length===1
   &&visibleBefore.data[0].is_unlinked===true,{...minimal(visibleBefore)});

 const anon=await anonymous.rpc('get_public_club_directory',{p_club_id:pub.id});
 mark('H16_ANON_DIRECTORY_REJECTED',blocked(anon),minimal(anon));

 const deniedAdmin=await clients.mainA.rpc('save_club_member_display_name',{
   p_club_id:pub.id,p_member_id:person.id,p_display_name:'H16-forbidden-admin-rename',
   p_expected_club_display_name:null,p_public_confirmation:true});
 mark('H16_ADMIN_CANNOT_RENAME_LINKED',blocked(deniedAdmin),minimal(deniedAdmin));

 const noConsent=await clients.recipient.rpc('save_club_member_display_name',{
   p_club_id:pub.id,p_member_id:person.id,p_display_name:'H16-Public-Recipient',
   p_expected_club_display_name:null,p_public_confirmation:false});
 mark('H16_PUBLIC_REQUIRES_CONSENT',blocked(noConsent),minimal(noConsent));

 const selfSave=await clients.recipient.rpc('save_club_member_display_name',{
   p_club_id:pub.id,p_member_id:person.id,p_display_name:'H16-Public-Recipient',
   p_expected_club_display_name:null,p_public_confirmation:true});
 mark('H16_LINKED_SELF_SAVE',ok(selfSave)&&selfSave.data?.member_id===person.id
   &&selfSave.data.club_display_name==='H16-Public-Recipient'
   &&selfSave.data.public_name_confirmed===true,minimal(selfSave));

 const after=await directory();
 mark('H16_ONLY_CONFIRMED_PUBLIC',ok(after)&&safeRows(after)&&after.data.length===2
   &&after.data.some(x=>x.display_name==='H16-Public-Recipient'&&x.is_unlinked===false)
   &&after.data.some(x=>x.is_unlinked===true),{...minimal(after)});

 const stale=await clients.recipient.rpc('save_club_member_display_name',{
   p_club_id:pub.id,p_member_id:person.id,p_display_name:'H16-Should-Not-Overwrite',
   p_expected_club_display_name:null,p_public_confirmation:true});
 mark('H16_CAS_STALE_REJECTED',stale.error?.code==='40001'&&[400,409].includes(stale.status),
   minimal(stale));

 const ordinaryDenied=await clients.recipient.rpc('save_club_member_display_name',{
   p_club_id:pub.id,p_member_id:unlinked.id,p_display_name:'H16-Forbidden-Unlinked',
   p_expected_club_display_name:null,p_public_confirmation:false});
 mark('H16_MEMBER_CANNOT_RENAME_UNLINKED',blocked(ordinaryDenied),minimal(ordinaryDenied));

 const subSave=await clients.outsider.rpc('save_club_member_display_name',{
   p_club_id:pub.id,p_member_id:unlinked.id,p_display_name:'H16-Edited-Provisional',
   p_expected_club_display_name:null,p_public_confirmation:false});
 mark('H16_SUB_CAN_RENAME_UNLINKED',ok(subSave)
   &&subSave.data?.member_id===unlinked.id
   &&subSave.data?.public_name_confirmed===false,minimal(subSave));

 const privateSave=await clients.recipient.rpc('save_club_member_display_name',{
   p_club_id:pri.id,p_member_id:personPrivate.id,p_display_name:'H16-Private-Recipient',
   p_expected_club_display_name:null,p_public_confirmation:false});
 mark('H16_PRIVATE_SAVE_WITHOUT_DISCLOSURE',ok(privateSave)
   &&privateSave.data?.member_id===personPrivate.id
   &&privateSave.data?.public_name_confirmed===false,minimal(privateSave));

 const rosterNow=await Promise.all([
   clients.mainA.rpc('get_club_roster',{p_club_id:pub.id}),
   clients.mainA.rpc('get_club_roster',{p_club_id:pri.id})
 ]);
 const [pubNow,priNow]=rosterNow.map(x=>Array.isArray(x.data)?x.data:[]);
 const confirmed=pubNow.find(x=>x.id===person.id),privateRow=priNow.find(x=>x.id===personPrivate.id);
 const unlinkedNow=pubNow.find(x=>x.id===unlinked.id);
 mark('H16_SCOPED_NAMES_IN_ROSTER',rosterNow.every(ok)
   &&confirmed?.player_profiles?.club_display_name==='H16-Public-Recipient'
   &&confirmed?.player_profiles?.public_name_confirmed===true
   &&privateRow?.player_profiles?.club_display_name==='H16-Private-Recipient'
   &&privateRow?.player_profiles?.public_name_confirmed===false
   &&unlinkedNow?.player_profiles?.club_display_name==='H16-Edited-Provisional'
   &&unlinkedNow?.player_profiles?.display_name===unlinked.player_profiles.display_name
   &&confirmed.player_profiles.display_name===person.player_profiles.display_name,
   {public_count:pubNow.length,private_count:priNow.length});

 const direct=await clients.recipient.from('club_members').update({club_display_name:'H16-DIRECT-FORBIDDEN'})
   .eq('id',person.id).select('id');
 mark('H16_NO_DIRECT_ALIAS_UPDATE',blocked(direct),minimal(direct));

 const hidden=await clients.outsider.rpc('get_public_club_directory',{p_club_id:pri.id});
 mark('H16_PRIVATE_DIRECTORY_DENIED',blocked(hidden),minimal(hidden));

 const finalList=await directory();
 mark('H16_PUBLIC_DTO_MINIMAL',ok(finalList)&&safeRows(finalList)&&finalList.data.length===2
   &&finalList.data.find(x=>x.is_unlinked===true)?.display_name==='H16-Edited-Provisional'
   &&finalList.data.find(x=>x.is_unlinked===false)?.display_name==='H16-Public-Recipient',
   minimal(finalList));

 if(results.some(x=>x.outcome!=='PASS'))process.exitCode=1;
}catch(error){
 // Intentionally omit details: never leak JWT or returned identity.
 results.push({id:'H16_TEST_SETUP_OR_RUNTIME',outcome:'BLOCKED'});
 process.exitCode=1;
}finally{
 for(const c of Object.values(clients))await c.auth.signOut({scope:'local'}).catch(()=>{});
 console.log(JSON.stringify({project:'padel-hub-staging',phase:'H16-authenticated-HTTP-WRITE-ONCE',
    requires_cleanup_sql_68:true,results},null,2));
}
