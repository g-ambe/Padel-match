/**
 * TASK-08 H31: Stage-only Data API negative/no-op probe.
 * Calls new click functions with a reserved, non-existing UUID and an invalid
 * synthetic token. No fixture, user data or valid share token is involved.
 * This tests RPC availability/role; it does NOT prove positive click recording.
 * Do not log keys, tokens, IDs, auth data or response bodies.
 */
import {createClient} from '@supabase/supabase-js';
const url='https://zzjwpresqkefnyjyisgd.supabase.co';
const key=process.env.TASK08_STAGING_PUBLISHABLE_KEY;
const checks=[];
const invalidId='00000000-0000-4000-8000-000000000000';
const invalidToken='TASK08-H31-NEVER-VALID-HTTP-TOKEN';
const defs=[
 ['H31_ANON_FRIENDLY_NOOP','record_event_video_click_by_token','p_match_id'],
 ['H31_ANON_EVENT_VIDEO_LINK_NOOP','record_event_video_link_click_by_token','p_video_link_id'],
 ['H31_ANON_OFFICIAL_NOOP','record_official_video_click_by_token','p_match_id'],
];
async function run(){
 if(!key||!key.startsWith('sb_publishable_')){
  console.log(JSON.stringify({status:'BLOCKED',reason:'stage_publishable_key_required'}));
  process.exitCode=2;return;
 }
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 for(const [name,rpc,idArg] of defs){
  const {error,status,data}=await db.rpc(rpc,{
    [idArg]:invalidId,p_share_token:invalidToken,
    p_user_agent:'h31-test',p_referrer:null,
  });
  const ok=!error&&[200,204].includes(status)&&data===null;
  checks.push({name,result:ok?'PASS':'FAIL',status:status??null,code:error?.code??null});
 }
 console.log(JSON.stringify({scope:'Stage only',mode:'anon Data API invalid-target no-op',
   valid_token_positive:'NOT_TESTED',checks}));
 if(checks.some(x=>x.result!=='PASS'))process.exitCode=1;
}
run().catch(()=>{
 console.error('H31_STAGE_HTTP_TRANSPORT_FAILURE');
 process.exitCode=1;
});
