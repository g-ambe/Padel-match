// Actual Worker HTTP, local Auth, PostgREST and R2 binding. No API mock.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {chromium}=require(path.join(process.env.RUNNER_TEMP,'task08-playwright','node_modules','playwright'));
const {url,base,key,actors,ids}=JSON.parse(fs.readFileSync(0,'utf8'));
let phase='setup',checks=0,httpStatus=null;
const mark=()=>{checks++};
const digest=b=>createHash('sha256').update(b).digest('hex');
async function req(endpoint,token,method='GET',headers={},body){
 const r=await fetch(base+endpoint,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...headers},body,redirect:'error',signal:AbortSignal.timeout(25000)});
 httpStatus=r.status;return r;
}
async function profile(endpoint,token,method='GET',headers={},body){
 const r=await req(endpoint,token,method,headers,body);assert.equal(r.status,200);
 const data=await r.json();assert(data.profile);return data;
}
async function login(role){
 const a=actors.find(x=>x.role===role);
 const r=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:a.email,password:a.password}),redirect:'error',signal:AbortSignal.timeout(15000)});
 httpStatus=r.status;assert.equal(r.status,200);const d=await r.json();assert.equal(d.user.id,a.uid);assert(d.access_token);return d.access_token;
}
async function images(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const p=await browser.newPage();
  return (await p.evaluate(()=>['#d34055','#336699'].map(color=>{
   const c=document.createElement('canvas');c.width=16;c.height=16;
   const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,16,16);
   const s=c.toDataURL('image/webp',.8);if(!s.startsWith('data:image/webp;base64,'))throw new Error('encoding');
   return s.split(',')[1];
  }))).map(s=>Buffer.from(s,'base64'));
 }finally{await browser.close()}
}
async function main(){
 assert.equal(url,'http://127.0.0.1:54321');assert.equal(base,'http://127.0.0.1:3070');
 const endpoint='/api/profile-media/'+ids.owner_profile;
 phase='auth';const owner=await login('owner'),outsider=await login('outsider');mark();
 phase='initial';const initial=await profile(endpoint,owner);assert.equal(initial.imageEnabled,true);assert.equal(initial.profile.avatar_version,0);assert.equal(initial.profile.avatar_key,null);mark();
 phase='privacy';assert.equal((await req(endpoint,null)).status,401);assert.equal((await req(endpoint,outsider)).status,404);mark();
 phase='webp';const [a,b]=await images();assert(a.length>20&&b.length>20&&digest(a)!==digest(b));mark();
 const put=(bytes,version,id=randomUUID())=>profile(endpoint,owner,'PUT',{'content-type':'image/webp','x-profile-request':id,'x-profile-version':String(version)},bytes);
 const get=async(version,bytes)=>{
  const r=await req(endpoint+'/image?version='+version,owner);
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/webp');
  assert(r.headers.get('cache-control')?.startsWith('private'));assert.equal(r.headers.get('vary'),'Authorization');
  const tag=r.headers.get('etag');assert(tag);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);return tag;
 };
 phase='upload';const firstId=randomUUID();const first=(await put(a,0,firstId)).profile;assert.equal(first.avatar_version,1);assert.equal(first.avatar_key,'profiles/'+ids.owner_profile+'/'+firstId+'.webp');mark();
 phase='readback';const tag=await get(1,a);assert.equal((await req(endpoint+'/image?version=1',owner,'GET',{'if-none-match':tag})).status,304);
 assert.equal((await req(endpoint+'/image?version=1',outsider,'GET',{'if-none-match':tag})).status,404);
 assert.equal((await req(endpoint+'/image?version=1',null)).status,401);mark();
 phase='retry';const retry=(await put(a,0,firstId)).profile;assert.equal(retry.avatar_key,first.avatar_key);assert.equal(retry.avatar_version,1);mark();
 phase='position';const pose=(await profile(endpoint+'/position',owner,'PATCH',{'content-type':'application/json'},JSON.stringify({position:{x:.4,y:.6,zoom:2},avatarVersion:1,poseVersion:first.avatar_pose_version}))).profile;
 assert.equal(pose.avatar_version,1);assert.equal(pose.avatar_pose_version,first.avatar_pose_version+1);assert.equal(pose.avatar_focus_x,.4);assert.equal(pose.avatar_focus_y,.6);assert.equal(pose.avatar_zoom,2);mark();
 phase='replace';const secondId=randomUUID();const second=(await put(b,1,secondId)).profile;assert.equal(second.avatar_version,2);assert.notEqual(second.avatar_key,first.avatar_key);await get(2,b);
 assert.equal((await req(endpoint+'/image?version=1',owner)).status,404);mark();
 phase='stale';const stale=await req(endpoint,owner,'PUT',{'content-type':'image/webp','x-profile-request':randomUUID(),'x-profile-version':'1'},a);
 assert.equal(stale.status,409);await get(2,b);mark();
 phase='delete';const deleted=(await profile(endpoint,owner,'DELETE',{'x-profile-request':randomUUID(),'x-profile-version':'2'})).profile;
 assert.equal(deleted.avatar_version,3);assert.equal(deleted.avatar_key,null);assert.equal((await req(endpoint+'/image?version=2',owner)).status,404);mark();
 phase='final';const end=await profile(endpoint,owner);assert.equal(end.profile.avatar_version,3);assert.equal(end.profile.avatar_key,null);assert.equal(end.imageEnabled,true);mark();
 return {ok:true,checks};
}
main().then(r=>console.log(JSON.stringify(r))).catch(e=>console.log(JSON.stringify({ok:false,phase,checks,httpStatus,errorKind:e?.name==='AssertionError'?'assertion':e?.name==='TimeoutError'?'timeout':'other'})));
