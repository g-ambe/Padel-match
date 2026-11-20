/**
 * TASK-08/H22: Stage real JWT + *application's actual TS helper*.
 * READ ONLY. This script never inserts/updates club, member, event or profile.
 * It never prints identities, IDs, directory rows, names, JWTs or passwords.
 */
const {createClient}=require('@supabase/supabase-js');
const {readPublicClubMemberCount,readPublicDirectory,readMyMemberships}=require('../../../lib/group-read.ts');
const stageUrl='https://zzjwpresqkefnyjyisgd.supabase.co';
const checks=[];
const assertCase=(name,ok,details={})=>checks.push({name,result:ok?'PASS':'FAIL',...details});
const key=process.env.TASK08_STAGING_PUBLISHABLE_KEY;
let db;
(async()=>{
 try{
  if(typeof key!=='string'||!key.startsWith('sb_publishable_')||!process.env.TASK08_STAGING_MAIN_A_PASSWORD)
   throw Error('invalid_stage_credentials');
  db=createClient(stageUrl,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const login=await db.auth.signInWithPassword({
   email:'main-A@example.com',password:process.env.TASK08_STAGING_MAIN_A_PASSWORD
  });
  if(login.error||!login.data.session?.access_token)
   throw Error('stage_test_signin_failed');
  assertCase('H22_APP_STAGE_REAL_SIGN_IN',true);
  const membership=await readMyMemberships(db);
  assertCase('H22_APP_MEMBERSHIP_HELPER_REAL_AUTH',Array.isArray(membership));

  const groupFetch=await db.from('clubs').select('id,visibility').eq('visibility','public').eq('is_active',true);
  if(groupFetch.error||!Array.isArray(groupFetch.data)||groupFetch.data.length!==2)
   throw Error('public_group_fixture_not_ready');
  const groups=groupFetch.data;
  assertCase('H22_APP_REAL_PUBLIC_CLUBS_FOUND',groups.length===2,{count:groups.length});

  const observed=[];
  for(const group of groups){
   const helperCount=await readPublicClubMemberCount(db,group.id);
   const rpc=await db.rpc('get_public_club_member_count',{p_club_id:group.id});
   const directory=await readPublicDirectory(db,group.id);
   observed.push({count:helperCount,rpcOk:!rpc.error,rpcValue:rpc.data,
     directoryCount:directory.length,
     minDto:directory.every(row=>
       Object.keys(row).sort().join(',')==='display_name,is_unlinked,reference')});
  }
  assertCase('H22_APP_REAL_HELPER_SCALAR_MATCHES_RPC',
   observed.length===2&&observed.every(r=>Number.isSafeInteger(r.count)&&r.count>=0&&r.rpcOk&&r.count===r.rpcValue));
  assertCase('H22_APP_STAGE_EXISTING_COUNTS',
   observed.every(r=>r.count===2),{groups_tested:observed.length});
  assertCase('H22_APP_PUBLIC_DIRECTORY_FIELDS_REMAIN_MINIMAL',
   observed.every(r=>r.minDto));
  assertCase('H22_APP_PUBLIC_DIRECTORY_COUNT_NOT_USED_AS_TOTAL',
   observed.every(r=>r.directoryCount<=r.count));
  
  let denied=false,reason='none';
  try{await readPublicClubMemberCount(db,'00000000-0000-4000-8000-000000000000');}
  catch(e){denied=true;reason=e?.message==='所属人数を取得できませんでした'?'sanitized':'unexpected_error_text';}
  assertCase('H22_APP_UNKNOWN_CLUB_DENIED_WITH_SANITIZED_ERROR',denied&&reason==='sanitized');

  const anon=createClient(stageUrl,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  let anonymousBlocked=false;
  try{await readPublicClubMemberCount(anon,groups[0].id);}
  catch(e){anonymousBlocked=e?.message==='所属人数を取得できませんでした';}
  assertCase('H22_APP_ANONYMOUS_CALL_REJECTED',anonymousBlocked);

  if(checks.some(x=>x.result!=='PASS'))process.exitCode=1;
 }catch(e){
  const allowed=['invalid_stage_credentials','stage_test_signin_failed','public_group_fixture_not_ready'];
  const reason=e instanceof Error&&allowed.includes(e.message)?e.message:'UNCLASSIFIED_STAGE_ERROR';
  checks.push({name:'H22_APP_RUNTIME_OR_FIXTURE',result:'BLOCKED',reason});
  process.exitCode=1;
 }finally{
  if(db)await db.auth.signOut({scope:'local'}).catch(()=>{});
  console.log(JSON.stringify({scope:'Stage only',mode:'read only; application helper + real JWT',
   checks},null,2));
 }
})();