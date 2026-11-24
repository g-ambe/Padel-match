// Actual local Auth, PostgREST, OpenNext Worker and Wrangler R2. No API mocks.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const {randomUUID}=require('node:crypto');
const {chromium}=require('playwright');
require('node:module').registerHooks({resolve(s,c,next){return next(s==='./position'&&c.parentURL?.includes('/profile-media/')?s+'.ts':s,c)}});
const {stripWebpMetadata}=require('../../lib/profile-media/shared.ts');
const {url,key,actors,ids,proof}=JSON.parse(fs.readFileSync(0,'utf8'));
const base='http://127.0.0.1:3070';
let phase='setup',httpStatus=null,checks=0;
const mark=()=>checks++;
async function req(path,token,method='GET',headers={},body){
 const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...headers},body,redirect:'error',signal:AbortSignal.timeout(20000)});
 httpStatus=r.status;return r;
}
function privateResponse(r){
 const cache=r.headers.get('cache-control')?.toLowerCase().split(',').map(s=>s.trim())??[];assert(cache.includes('private')&&cache.includes('no-store')&&!cache.includes('public'));assert(!cache.some(s=>/^s-maxage=[1-9]/.test(s)));
 assert(r.headers.get('vary')?.toLowerCase().split(',').map(s=>s.trim()).includes('authorization'));assert.equal(r.headers.get('etag'),null);
 assert.equal(r.headers.get('x-content-type-options'),'nosniff');
}
async function main(){
 assert.equal(url,'http://127.0.0.1:54321');assert.equal(actors.length,4);
 const clients={},tokens={};
 phase='real_auth';
 for(const actor of actors){
  const c=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const signed=await c.auth.signInWithPassword({email:actor.email,password:actor.password});assert(!signed.error);
  assert.equal(signed.data.user.id,actor.uid);tokens[actor.role]=signed.data.session.access_token;clients[actor.role]=c;
 }
 mark();
 const peer=`/api/groups/${ids.club}/members/${ids.target}/avatar`,own=`/api/profile-media/${ids.owner_profile}`;
 phase='rpc_proof';
 for(const p of [null,'invalid']){const r=await clients.viewer.rpc('get_group_member_avatar_for_worker',{p_club_id:ids.club,p_member_id:ids.target,p_proof:p});assert(r.error&&r.error.code==='42501');}
 const anon=createClient(url,key,{auth:{persistSession:false}});
 const forbidden=await anon.rpc('get_group_member_avatar_for_worker',{p_club_id:ids.club,p_member_id:ids.target,p_proof:proof});assert(forbidden.error);mark();
 phase='no_image';const absent=await req(peer,tokens.viewer);assert.equal(absent.status,404);privateResponse(absent);mark();
 phase='create_webp';const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 let images;
 try{const p=await browser.newPage();images=(await p.evaluate(()=>['#206050','#4050a0'].map(color=>{const c=document.createElement('canvas');c.width=16;c.height=16;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,16,16);const s=c.toDataURL('image/webp');if(!s.startsWith('data:image/webp;base64,'))throw Error('encoding');return s.split(',')[1]}))).map(s=>Buffer.from(stripWebpMetadata(Buffer.from(s,'base64'))));}
 finally{await browser.close()}
 async function edit(method,version,bytes){const r=await req(own,tokens.owner,method,{'x-profile-request':randomUUID(),'x-profile-version':String(version),...(bytes?{'content-type':'image/webp'}:{})},bytes);assert.equal(r.status,200);return(await r.json()).profile;}
 phase='owner_upload';let meta=await edit('PUT',0,images[0]);assert.equal(meta.avatar_version,1);mark();
 async function image(token=tokens.viewer,path=peer,expected=images[0],headers={}){
  const r=await req(path,token,'GET',headers);assert.equal(r.status,200);privateResponse(r);
  assert.equal(r.headers.get('content-type'),'image/webp');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),expected);return r;
 }
 phase='member_r2';await image();await image(tokens.owner);mark();
 phase='bigint_contract';const result=await clients.viewer.rpc('get_group_member_avatar_for_worker',{p_club_id:ids.club,p_member_id:ids.target,p_proof:proof});assert(!result.error&&result.data.length===1);
 assert(Number.isSafeInteger(result.data[0].avatar_version));assert(Number.isSafeInteger(result.data[0].avatar_pose_version));assert.equal(result.data[0].avatar_version,1);mark();
 phase='denied_http';
 for(const [token,status]of [[null,401],['invalid-token',401],[tokens.outsider,404]]){const r=await req(peer,token);assert.equal(r.status,status);privateResponse(r);}
 const tampered=await req(`/api/groups/${ids.other_club}/members/${ids.target}/avatar`,tokens.viewer);assert.equal(tampered.status,404);privateResponse(tampered);mark();
 phase='owner_boundary';const other=await req(`${own}/image?version=1`,tokens.viewer);assert.equal(other.status,404);
 const mine=await req(`${own}/image?version=1`,tokens.owner);assert.equal(mine.status,200);assert.match(mine.headers.get('cache-control'),/max-age=300/);assert(mine.headers.get('etag'));assert.deepEqual(Buffer.from(await mine.arrayBuffer()),images[0]);mark();
 phase='position_edit';const pos=await req(own+'/position',tokens.owner,'PATCH',{'content-type':'application/json'},JSON.stringify({position:{x:.3,y:.7,zoom:2},avatarVersion:1,poseVersion:meta.avatar_pose_version}));assert.equal(pos.status,200);meta=(await pos.json()).profile;
 const posed=await image();assert.equal(posed.headers.get('x-avatar-focus-x'),'0.3');assert.equal(posed.headers.get('x-avatar-focus-y'),'0.7');assert.equal(posed.headers.get('x-avatar-zoom'),'2');mark();
 phase='fresh_auth_on_etag';await image(tokens.viewer,peer,images[0],{'If-None-Match':'old'});mark();
 // Updates go through actual authorized REST UPDATE, not injected API responses.
 phase='public_group';let changed=await clients.admin.from('clubs').update({visibility:'public'}).eq('id',ids.club);assert(!changed.error);await image();
 assert.equal((await req(peer,tokens.outsider)).status,404);mark();
 phase='viewer_exit';changed=await clients.admin.from('club_members').update({is_active:false}).eq('id',ids.viewer_member);assert(!changed.error);const exited=await req(peer,tokens.viewer);assert.equal(exited.status,404);privateResponse(exited);mark();
 changed=await clients.admin.from('club_members').update({is_active:true}).eq('id',ids.viewer_member);assert(!changed.error);await image();mark();
 phase='target_exit';changed=await clients.admin.from('club_members').update({is_active:false}).eq('id',ids.target);assert(!changed.error);assert.equal((await req(peer,tokens.viewer)).status,404);mark();
 changed=await clients.admin.from('club_members').update({is_active:true}).eq('id',ids.target);assert(!changed.error);await image();mark();
 phase='owner_replace';meta=await edit('PUT',1,images[1]);assert.equal(meta.avatar_version,2);await image(tokens.viewer,peer,images[1]);assert.equal((await req(`${own}/image?version=1`,tokens.owner)).status,404);mark();
 phase='owner_delete';meta=await edit('DELETE',2);assert.equal(meta.avatar_version,3);const deleted=await req(peer,tokens.viewer);assert.equal(deleted.status,404);privateResponse(deleted);assert.equal((await req(`${own}/image?version=2`,tokens.owner)).status,404);mark();
 return{ok:true,checks};
}
main().then(r=>console.log(JSON.stringify(r))).catch(e=>console.log(JSON.stringify({ok:false,phase,httpStatus,checks,errorKind:e?.name==='AssertionError'?'assertion':e?.name==='TimeoutError'?'timeout':'other'})));
