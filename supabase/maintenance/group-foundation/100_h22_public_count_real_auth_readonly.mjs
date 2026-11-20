/**
 * H22: READ-ONLY real JWT/PostgREST contract for exact public club count.
 * Only Stage test Auth account; does NOT write rows or change ownership.
 * Never log account IDs, club IDs, names, tokens, responses or secrets.
 */
import {createClient} from '@supabase/supabase-js';
const url='https://zzjwpresqkefnyjyisgd.supabase.co';
const output=[];
const check=(id,ok,rest={})=>output.push({id,outcome:ok?'PASS':'FAIL',...rest});
const key=process.env.TASK08_STAGING_PUBLISHABLE_KEY;
let authed=null;
try{
 if(!key?.startsWith('sb_publishable_')||!process.env.TASK08_STAGING_MAIN_A_PASSWORD)throw Error('credentials_unavailable');
 const make=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const anon=make(),db=make();authed=db;
 const login=await db.auth.signInWithPassword({email:'main-A@example.com',password:process.env.TASK08_STAGING_MAIN_A_PASSWORD});
 if(login.error||!login.data.session?.access_token)throw Error('test_auth_unavailable');

 const groups=await db.from('clubs').select('id,visibility').eq('is_active',true);
 if(groups.error||!Array.isArray(groups.data))throw Error('club_discovery_failed');
 const publicIds=groups.data.filter(x=>x.visibility==='public').map(x=>x.id);
 const privateIds=groups.data.filter(x=>x.visibility==='private').map(x=>x.id);
 if(publicIds.length!==2||privateIds.length===0)throw Error('Stage_public_private_fixture_drift');
 check('H22_AUTH_STAGE_PUBLIC_GROUPS_FOUND',true,{public_count:publicIds.length});

 const results=await Promise.all(publicIds.map(p_club_id=>db.rpc('get_public_club_member_count',{p_club_id})));
 check('H22_AUTH_EXACT_SCALAR_2_PUBLIC_GROUPS',results.every(x=>!x.error&&x.status===200&&Number.isInteger(x.data)&&x.data>=0),
  {success_count:results.filter(x=>!x.error).length});
 check('H22_AUTH_STAGE_BASELINE_COUNTS',results.length===2&&results.every(x=>x.data===2));
 const directory=await db.rpc('get_public_club_directory',{p_club_id:publicIds[0]});
 check('H22_PUBLIC_DIRECTORY_UNCHANGED',!directory.error&&Array.isArray(directory.data)
  &&directory.data.every(x=>Object.keys(x).sort().join(',')==='display_name,is_unlinked,reference'));
 const noLogin=await anon.rpc('get_public_club_member_count',{p_club_id:publicIds[0]});
 check('H22_ANON_COUNT_DENIED',!!noLogin.error&&noLogin.data===null,{status:noLogin.status??null,code:noLogin.error?.code??null});
 const priv=await db.rpc('get_public_club_member_count',{p_club_id:privateIds[0]});
 check('H22_PRIVATE_GROUP_COUNT_DENIED',!!priv.error&&priv.error.code==='42501',
  {status:priv.status??null,code:priv.error?.code??null});
 const missing=await db.rpc('get_public_club_member_count',{p_club_id:'00000000-0000-4000-8000-000000000000'});
 check('H22_UNKNOWN_GROUP_COUNT_DENIED',!!missing.error&&missing.error.code==='42501',
  {status:missing.status??null,code:missing.error?.code??null});
 if(output.some(x=>x.outcome!=='PASS'))process.exitCode=1;
}catch(e){
 const safe=['credentials_unavailable','test_auth_unavailable','club_discovery_failed','Stage_public_private_fixture_drift'];
 const reason=(e instanceof Error&&safe.includes(e.message))?e.message:'UNCLASSIFIED_RUNTIME_ERROR';
 output.push({id:'H22_RUNTIME_OR_BASELINE',outcome:'BLOCKED',reason});
 process.exitCode=1;
}
finally{
 if(authed)await authed.auth.signOut({scope:'local'}).catch(()=>{});
 console.log(JSON.stringify({project:'stage',mode:'REAL_JWT_READ_ONLY',checks:output},null,2));
}
