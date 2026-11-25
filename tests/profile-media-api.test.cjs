const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
require('node:module').registerHooks({resolve(s,c,next){return next(s==='./shared'&&c.parentURL?.includes('/profile-media/')?'./shared.ts':s,c);}});
const {evaluate}=require('./fixtures/stats-helpers.cjs');const {MediaFailure}=require('../lib/profile-media/service.ts'),{IMAGE_LIMIT,isUuid}=require('../lib/profile-media/shared.ts');
const source=fs.readFileSync('lib/profile-media/server.ts','utf8').replaceAll('export ','');
const mediaError=e=>Response.json({error:e.message},{status:e.status||503,headers:{'cache-control':'no-store'}});
const pid='00000000-0000-4000-8000-000000000011',request='00000000-0000-4000-8000-000000000100';
test('未認証・不正ID・権限外・レート制限をR2へ触る前に拒否し、不正要求も試行を消費',async()=>{
 let calls=[],allowed=true,owns=true;
 const db={auth:{getUser:async()=>{calls.push('auth');return {data:{user:{id:'owner'}}};}},rpc:async()=>{calls.push('ticket');return {data:'ticket'};},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:owns?{id:pid}:null})})};
 const bindings=()=>({MediaFailure,isUuid,emptyPrivateProfile:()=>{},createClient:()=>db,getCloudflareContext:async()=>({env:{PROFILE_MEDIA_RATE_LIMITER:{limit:async()=>{calls.push('limit');return {success:allowed};}}},ctx:{waitUntil(){}}}),process:{env:{NEXT_PUBLIC_SUPABASE_URL:'http://local.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public'}}});
 const factory=()=>{const values=bindings();return evaluate(source,'mediaContext',{...values,authenticatedMediaClient:evaluate(source,'authenticatedMediaClient',values)});};
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

test('位置APIは認証/試行制限と期待版を使い、R2・画像操作APIを呼び出さない',async()=>{
 const {validAvatarPosition}=require('../lib/profile-media/position.ts');const code=fs.readFileSync('app/api/profile-media/[id]/position/route.ts','utf8').replaceAll('export ','');let writes=0,allowed=true;
 const position={x:.6,y:.4,zoom:2};const patch=evaluate(code,'PATCH',{validAvatarPosition,MediaFailure,mediaError,jsonResponse:Response.json,limitedBody:async r=>new Uint8Array(await r.arrayBuffer()),mediaContext:async()=>{if(!allowed)throw new MediaFailure('auth',401);return {ticket:'t',get env(){throw Error('R2 must not be accessed');},rpc:async(name,args)=>{assert.equal(name,'save_my_avatar_position');assert.equal(args.p_expected_avatar,2);assert.equal(args.p_expected_pose,3);assert.equal(args.p_ticket,'t');writes++;return {avatar_version:2,avatar_pose_version:4};}};}});
 const context={params:Promise.resolve({id:pid})},req=value=>new Request('https://app.invalid',{method:'PATCH',body:JSON.stringify(value)});
 assert.equal((await patch(req({position,avatarVersion:2,poseVersion:3}),context)).status,200);assert.equal(writes,1);
 for(const value of [{position:{...position,x:2},avatarVersion:2,poseVersion:3},{position,avatarVersion:-1,poseVersion:3},null])assert.equal((await patch(req(value),context)).status,400);assert.equal(writes,1);
 allowed=false;assert.equal((await patch(req({position,avatarVersion:2,poseVersion:3}),context)).status,401);assert.equal(writes,1);
});
test('位置保存の応答喪失はDB再取得で確認し、別画像/別位置の競合を成功扱いしない',async()=>{
 const {avatarPosition,sameAvatarPosition}=require('../lib/profile-media/position.ts');const code=fs.readFileSync('components/profile-media-provider.tsx','utf8');
 const position={x:.6,y:.4,zoom:2},confirmed={avatar_version:2,avatar_pose_version:4,avatar_focus_x:.6,avatar_focus_y:.4,avatar_zoom:2};
 let actual=confirmed;const cache={current:{}},current={current:'owner'};let reads=0;
 const save=evaluate(code,'savePosition',{avatarPosition,sameAvatarPosition,current,cache,keyFor:(u,p)=>u+':'+p,request:async()=>{throw Error('lost response');},read:async()=>{reads++;return {profile:actual};},update:()=>{throw Error('no successful response to merge');}});
 assert.deepEqual(await save('owner',pid,position,2,3),confirmed);assert.equal(reads,1);
 actual={...confirmed,avatar_version:3};await assert.rejects(save('owner',pid,position,2,3),/lost response/);
 actual={...confirmed,avatar_focus_x:.2};await assert.rejects(save('owner',pid,position,2,3),/lost response/);
});
test('ホームコートAPIは旧新の自由入力を拒否し、明示解除だけを本人用施設RPCへ渡す',async()=>{
 const code=fs.readFileSync('app/api/profile-media/[id]/home-court/route.ts','utf8').replaceAll('export ','');let calls=[],allowed=true;
 const patch=evaluate(code,'PATCH',{isUuid,MediaFailure,mediaError,jsonResponse:Response.json,limitedBody:async r=>new Uint8Array(await r.arrayBuffer()),mediaContext:async()=>{if(!allowed)throw new MediaFailure('auth',401);return {ticket:'t',get env(){throw Error('R2 not allowed');},rpc:async(n,a)=>{calls.push({n,a});return {home_facility_id:null,home_court_name:null,home_court_version:3};},read:async()=>{throw Error('auxiliary read failed');}};}});
 const ctx={params:Promise.resolve({id:pid})},req=b=>new Request('https://app.invalid',{method:'PATCH',body:JSON.stringify(b)});
 for(const b of [{name:'旧クライアントの自由入力',version:2},{name:'新しい自由入力',facilityId:null,version:2},{name:'a'.repeat(81),version:2},{name:'x',version:-1},{name:23,version:2},null])assert.equal((await patch(req(b),ctx)).status,400);
 assert.equal(calls.length,0);
 for(const b of [{name:'',facilityId:null,version:2},{name:'',version:2}])assert.equal((await patch(req(b),ctx)).status,200);
 for(const {n,a} of calls){assert.equal(n,'save_my_home_court_selection');assert.deepEqual(a,{p_profile:pid,p_expected:2,p_facility:null,p_name:'',p_ticket:'t'});}
 allowed=false;assert.equal((await patch(req({name:'',facilityId:null,version:2}),ctx)).status,401);assert.equal(calls.length,2);
});
test('ホームコート保存は施設IDと版で応答喪失を照合し、自由入力を送信しない',async()=>{
 const code=fs.readFileSync('components/profile-media-provider.tsx','utf8');let actual={home_facility_id:null,home_court_name:null,home_court_version:3},calls=0;
 const save=evaluate(code,'saveHomeCourt',{current:{current:'owner'},request:async(o,p,options)=>{calls++;assert.deepEqual(JSON.parse(options.body),{facilityId:null,name:'',version:2});throw Error('通信断');},read:async()=>({profile:actual}),cache:{current:{}},keyFor:(a,b)=>a+b,update:()=>{}});
 assert.deepEqual(await save('owner',pid,{facilityId:null,name:''},2),actual);
 actual={...actual,home_court_name:'旧登録値'};await assert.rejects(save('owner',pid,{facilityId:null,name:''},2),/通信断/);
 const before=calls;await assert.rejects(save('owner',pid,{facilityId:null,name:'新規自由入力'},2),/施設一覧/);assert.equal(calls,before);
});
test('施設ID保存APIは不正IDを拒否し、補助読込み失敗でもRPCの確定値を返す',async()=>{
 const {homeCourtName}=require('../lib/profile-options.ts');const code=fs.readFileSync('app/api/profile-media/[id]/home-court/route.ts','utf8').replaceAll('export ','');let calls=0;
 const profile={home_facility_id:request,home_court_name:'正式施設名',home_court_version:3};
 const patch=evaluate(code,'PATCH',{homeCourtName,isUuid,MediaFailure,mediaError,jsonResponse:Response.json,limitedBody:async r=>new Uint8Array(await r.arrayBuffer()),mediaContext:async()=>({ticket:'t',get env(){throw Error('R2 forbidden');},rpc:async(n,a)=>{calls++;assert.equal(n,'save_my_home_court_selection');assert.equal(a.p_facility,request);assert.equal(a.p_name,'');assert.equal(a.p_expected,2);assert.equal(a.p_ticket,'t');return profile;},read:async()=>{throw Error('補助読込み失敗');}})});
 const ctx={params:Promise.resolve({id:pid})},req=facilityId=>new Request('https://app.invalid',{method:'PATCH',body:JSON.stringify({name:'入力候補名',version:2,facilityId})});
 let r=await patch(req(request),ctx);assert.equal(r.status,200);assert.deepEqual((await r.json()).profile,profile);
 for(const id of ['bad-id','',{},12])assert.equal((await patch(req(id),ctx)).status,400);assert.equal(calls,1);
});
test('施設選択の応答喪失では改称を許容し、施設IDが違う競合を成功扱いしない',async()=>{
 const {homeCourtName}=require('../lib/profile-options.ts');const code=fs.readFileSync('components/profile-media-provider.tsx','utf8');let actual={home_facility_id:request,home_court_name:'改称後の施設名',home_court_version:3};
 const save=evaluate(code,'saveHomeCourt',{homeCourtName,current:{current:'owner'},request:async()=>{throw Error('通信断');},read:async()=>({profile:actual}),cache:{current:{}},keyFor:(a,b)=>a+b,update:()=>{}});
 const selection={facilityId:request,name:'改称前の施設名'};assert.deepEqual(await save('owner',pid,selection,2),actual);
 actual={...actual,home_facility_id:pid};await assert.rejects(save('owner',pid,selection,2),/通信断/);
 actual={home_facility_id:null,home_court_name:'以前の自由入力',home_court_version:4};await assert.rejects(save('owner',pid,{facilityId:null,name:'以前の自由入力'},3),/施設一覧/);
});
test('施設保存の認可・CASエラーでは旧RPCへfallbackせず既存登録を保持する',async()=>{
 const code=fs.readFileSync('app/api/profile-media/[id]/home-court/route.ts','utf8').replaceAll('export ','');
 for(const status of [403,409,429]){
  const calls=[],existing={home_facility_id:request,home_court_name:'既存施設',home_court_version:2},before=structuredClone(existing);
  const patch=evaluate(code,'PATCH',{isUuid,MediaFailure,mediaError,jsonResponse:Response.json,limitedBody:async r=>new Uint8Array(await r.arrayBuffer()),mediaContext:async()=>({ticket:'t',rpc:async(n)=>{calls.push(n);throw new MediaFailure('保存拒否',status);},read:async()=>{throw Error('must not follow failed mutation');}})});
  const r=await patch(new Request('https://app.invalid',{method:'PATCH',body:JSON.stringify({name:'',facilityId:pid,version:2})}),{params:Promise.resolve({id:pid})});
  assert.equal(r.status,status);assert.deepEqual(calls,['save_my_home_court_selection']);assert.deepEqual(existing,before);
 }
});
