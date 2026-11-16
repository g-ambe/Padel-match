const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
require('node:module').registerHooks({resolve(s,c,next){return next(s==='./shared'&&c.parentURL?.includes('/profile-media/')?'./shared.ts':s,c);}});
const {evaluate}=require('./fixtures/stats-helpers.cjs');const {MediaFailure}=require('../lib/profile-media/service.ts'),{IMAGE_LIMIT,isUuid}=require('../lib/profile-media/shared.ts');
const source=fs.readFileSync('lib/profile-media/server.ts','utf8').replaceAll('export ','');
const mediaError=e=>Response.json({error:e.message},{status:e.status||503,headers:{'cache-control':'no-store'}});
const pid='00000000-0000-4000-8000-000000000011',request='00000000-0000-4000-8000-000000000100';
test('未認証・不正ID・権限外・レート制限をR2へ触る前に拒否し、不正要求も試行を消費',async()=>{
 let calls=[],allowed=true,owns=true;
 const db={auth:{getUser:async()=>{calls.push('auth');return {data:{user:{id:'owner'}}};}},rpc:async()=>{calls.push('ticket');return {data:'ticket'};},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:owns?{id:pid}:null})})};
 const factory=()=>evaluate(source,'mediaContext',{MediaFailure,isUuid,emptyPrivateProfile:()=>{},createClient:()=>db,getCloudflareContext:async()=>({env:{PROFILE_MEDIA_RATE_LIMITER:{limit:async()=>{calls.push('limit');return {success:allowed};}}},ctx:{waitUntil(){}}}),process:{env:{NEXT_PUBLIC_SUPABASE_URL:'http://local.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public'}}});
 await assert.rejects(factory()(new Request('https://app.invalid'),pid,true),e=>e.status===401);assert.deepEqual(calls,['limit']);
 calls=[];const req=new Request('https://app.invalid',{headers:{Authorization:'Bearer synthetic'}});
 await assert.rejects(factory()(req,'bad-id',true),e=>e.status===400);assert.deepEqual(calls,['limit','auth','ticket']);
 owns=false;await assert.rejects(factory()(req,pid,true),e=>e.status===404);
 allowed=false;calls=[];await assert.rejects(factory()(req,pid,true),e=>e.status===429);assert.deepEqual(calls,['limit']);
});
test('画像GETは本人確認・参照確認の後にだけ応答し、private/Vary/ETagでR2再読込みを抑える',async()=>{
 const code=fs.readFileSync('app/api/profile-media/[id]/image/route.ts','utf8').replaceAll('export ','');let authorized=true,reads=0,authCalls=0;
 const profile={avatar_key:`profiles/${pid}/${request}.webp`,avatar_version:2};
 const get=evaluate(code,'GET',{isUuid,MediaFailure,mediaError,mediaContext:async()=>{authCalls++;if(!authorized)throw new MediaFailure('auth',401);return {read:async()=>({profile}),env:{PROFILE_IMAGES:{get:async()=>{reads++;return {body:new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.close();}})};}}}};}});
 const url=`https://app.invalid/api/profile-media/${pid}/image?version=2`,ctx={params:Promise.resolve({id:pid})};
 let r=await get(new Request(url),ctx);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/^private/);assert.equal(r.headers.get('vary'),'Authorization');assert.equal(reads,1);
 const tag=r.headers.get('etag');r=await get(new Request(url,{headers:{'If-None-Match':tag}}),ctx);assert.equal(r.status,304);assert.equal(reads,1);assert.equal(authCalls,2);
 authorized=false;r=await get(new Request(url,{headers:{'If-None-Match':tag}}),ctx);assert.equal(r.status,401);assert.equal(reads,1);
 authorized=true;profile.avatar_key=`profiles/other/${request}.webp`;r=await get(new Request(url),ctx);assert.equal(r.status,503);assert.equal(reads,1);
});
test('ストリーム本文を容量上限で停止し、宣言されたContent-Lengthだけに依存しない',async()=>{
 const body=evaluate(source,'limitedBody',{MediaFailure,IMAGE_LIMIT});let cancelled=false;
 const stream=new ReadableStream({start(c){for(let i=0;i<4;i++)c.enqueue(new Uint8Array(70*1024));},cancel(){cancelled=true;}});
 await assert.rejects(body(new Request('https://app.invalid',{method:'PUT',body:stream,duplex:'half'})),e=>e.status===413);assert(cancelled);
 assert.deepEqual(await body(new Request('https://app.invalid',{method:'PUT',body:new Uint8Array([1,2])})),new Uint8Array([1,2]));
});
