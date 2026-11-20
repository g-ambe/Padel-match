/**
 * TASK-08 / P0-H29: Read-only Stage real Auth / PostgREST acceptance after H28.
 *
 * Existing staging GitHub Actions secrets only. No production URLs, DB writes,
 * token/name/email/ID/response-body logging, fixture setup or destructive tests.
 * A real, valid shared token is intentionally NOT tested without an isolated
 * synthetic shared-event fixture; invalid-token checks are negative only.
 */
import {createClient} from '@supabase/supabase-js';

const stageUrl='https://zzjwpresqkefnyjyisgd.supabase.co';
const users={
  mainA:['main-A@example.com','TASK08_STAGING_MAIN_A_PASSWORD'],
  outsider:['outsider@example.com','TASK08_STAGING_OUTSIDER_PASSWORD'],
};
const results=[];
function check(name,valid,detail={}) {
  results.push({name,result:valid?'PASS':'FAIL',...detail});
}
function client(key) {
  return createClient(stageUrl,key,{auth:{
    persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,
  }});
}
const denied=(r)=>r?.error?.code==='42501'&&[401,403].includes(r.status)
  &&r.data===null;

async function run() {
  const key=process.env.TASK08_STAGING_PUBLISHABLE_KEY;
  if(typeof key!=='string'||!key.startsWith('sb_publishable_')
    ||Object.values(users).some(([,pw])=>!process.env[pw])) {
    results.push({name:'H29_STAGE_SECRETS',result:'BLOCKED'});
    process.exitCode=2;return;
  }
  const anonymous=client(key);
  const actors={};
  for(const [who,[email,pwName]] of Object.entries(users)){
    const db=client(key);
    const login=await db.auth.signInWithPassword({email,password:process.env[pwName]});
    if(login.error||!login.data?.session?.access_token){
      results.push({name:'H29_REAL_LOGIN_'+who,result:'BLOCKED'});
      process.exitCode=1;return;
    }
    const user=await db.auth.getUser();
    if(user.error||user.data?.user?.id!==login.data.user?.id){
      results.push({name:'H29_AUTH_VALIDATE_'+who,result:'BLOCKED'});
      process.exitCode=1;return;
    }
    actors[who]=db;
    check('H29_REAL_LOGIN_'+who,true);
  }

  // PostgREST with actual publishable key and NO session, not SET ROLE.
  const anonClubs=await anonymous.from('clubs').select('id,name,description').limit(1);
  check('H29_ANON_CLUBS_DIRECT_SELECT_DENIED',denied(anonClubs),{
    status:anonClubs.status??null,code:anonClubs.error?.code??null,
  });
  const anonMembers=await anonymous.from('club_members').select('id,club_id,role').limit(1);
  check('H29_ANON_MEMBERS_DIRECT_SELECT_DENIED',denied(anonMembers),{
    status:anonMembers.status??null,code:anonMembers.error?.code??null,
  });

  // Same minimal columns actually requested by the existing discover page.
  const publicResults={};
  for(const [who,db] of Object.entries(actors)){
    const res=await db.from('clubs')
      .select('id,name,description,is_active,visibility')
      .eq('is_active',true).eq('visibility','public');
    publicResults[who]=res;
    const rows=Array.isArray(res.data)?res.data:[];
    check('H29_PUBLIC_DISCOVER_REAL_AUTH_'+who,
      !res.error&&res.status===200&&rows.length===2
      &&rows.every(row=>row?.is_active===true&&row.visibility==='public'
      &&typeof row.id==='string'&&typeof row.name==='string'
      &&Object.keys(row).sort().join(',')==='description,id,is_active,name,visibility'),{
        status:res.status??null,count:rows.length,code:res.error?.code??null,
      });
  }

  const mainRows=publicResults.mainA?.data??[];
  const outsiderDb=actors.outsider;
  const memberResponse=await outsiderDb.rpc('get_my_club_memberships');
  const ownClubIds=new Set(
    (Array.isArray(memberResponse.data)?memberResponse.data:[])
      .filter(row=>row.is_active===true&&row.status==='active')
      .map(row=>row.club_id)
  );
  const publicNotMember=mainRows.find(row=>!ownClubIds.has(row.id));
  const candidateOk=!memberResponse.error&&Array.isArray(memberResponse.data)
    &&!!publicNotMember;
  check('H29_NONMEMBER_PUBLIC_GROUP_FIXTURE',candidateOk,{
    eligible:!!publicNotMember,
  });
  if(candidateOk){
    const [group,directory,count,anonDir,anonCount]=await Promise.all([
      outsiderDb.from('clubs')
        .select('name,description,is_active,main_facility_id,visibility')
        .eq('id',publicNotMember.id).maybeSingle(),
      outsiderDb.rpc('get_public_club_directory',{p_club_id:publicNotMember.id}),
      outsiderDb.rpc('get_public_club_member_count',{p_club_id:publicNotMember.id}),
      anonymous.rpc('get_public_club_directory',{p_club_id:publicNotMember.id}),
      anonymous.rpc('get_public_club_member_count',{p_club_id:publicNotMember.id}),
    ]);
    const directoryRows=Array.isArray(directory.data)?directory.data:[];
    check('H29_NONMEMBER_PUBLIC_DETAIL_READ',!group.error&&group.status===200
      &&!!group.data&&group.data.visibility==='public'
      &&group.data.is_active===true&&typeof group.data.name==='string'
      &&Object.keys(group.data).sort().join(',')==='description,is_active,main_facility_id,name,visibility');
    check('H29_PUBLIC_DIRECTORY_MINIMAL_DTO',!directory.error
      &&directory.status===200&&directoryRows.every(row=>
        Object.keys(row).sort().join(',')==='display_name,is_unlinked,reference')
      &&directoryRows.length<=2);
    check('H29_PUBLIC_COUNT_SCALAR',!count.error&&count.status===200
      &&Number.isSafeInteger(count.data)&&count.data===2);
    check('H29_ANON_PUBLIC_DIRECTORY_DENIED',denied(anonDir),{
      status:anonDir.status??null,code:anonDir.error?.code??null,
    });
    check('H29_ANON_PUBLIC_COUNT_DENIED',denied(anonCount),{
      status:anonCount.status??null,code:anonCount.error?.code??null,
    });
  }

  for(const kind of ['event','official']){
    const invalid=await anonymous.rpc('get_shared_event',{
      p_token:'TASK08-H29-CERTAINLY-INVALID-SHARE-TOKEN',p_kind:kind,
    });
    check('H29_INVALID_SHARED_'+kind.toUpperCase()+'_NULL',
      !invalid.error&&invalid.status===200&&invalid.data===null,{
        status:invalid.status??null,code:invalid.error?.code??null,
      });
  }
  // Explicitly NOT a passing check: Stage has no valid shared-event fixtures.
  const pass=results.filter(r=>r.result==='PASS').length;
  const fail=results.filter(r=>r.result!=='PASS').length;
  console.log(JSON.stringify({scope:'padel-hub-staging only',
    mode:'real Auth + PostgREST read-only',
    shared_valid_token_positive:'NOT_TESTED_NO_STAGE_FIXTURE',
    pass,fail,results},null,2));
  if(fail)process.exitCode=1;
}
run().catch(()=>{
  // Never print exceptions: SDK transport exceptions can include URL or raw
  // remote payloads containing personal information.
  console.error('H29_STAGE_REAL_HTTP_UNCLASSIFIED_FAILURE');
  process.exitCode=1;
});
