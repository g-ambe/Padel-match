const {test}=require('node:test'),assert=require('node:assert/strict');
require('node:module').registerHooks({resolve(s,c,next){return next(s.startsWith('./profile-media/')||(s==='./shared'&&c.parentURL?.includes('/profile-media/'))?s+'.ts':s,c)}});
const {groupMemberAvatarResponse:serve}=require('../lib/group-member-avatar-server.ts');
const {MediaFailure}=require('../lib/profile-media/service.ts');
const club='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002',profile='00000000-0000-4000-8000-000000000003';
const row={profile_id:profile,avatar_key:`profiles/${profile}/${member}.webp`,avatar_version:2,avatar_pose_version:3,avatar_focus_x:.2,avatar_focus_y:.7,avatar_zoom:2};
const req=()=>new Request('https://local.invalid',{headers:{'If-None-Match':'old','Authorization':'Bearer synthetic'}});
const stream=()=>new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.close()}});
function fixture(data=[row],error=null){let reads=0,calls=0;return{get reads(){return reads},get calls(){return calls},authenticate:async()=>({proof:'private-proof',lookup:async(c,m,p)=>{calls++;assert.deepEqual([c,m,p],[club,member,'private-proof']);return{data,error}},bucket:{get:async key=>{reads++;assert.equal(key,row.avatar_key);return{body:stream(),size:2}}}})}};
function policy(r){assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('vary'),'Authorization');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('etag'),null)}
test('認可後のみR2 GET、位置だけを返し、ETagを無視して毎回認可する',async()=>{
 const f=fixture();for(let i=0;i<2;i++){const r=await serve(req(),club,member,f.authenticate);assert.equal(r.status,200);policy(r);assert.equal(r.headers.get('x-avatar-focus-x'),'.2'.replace(/^\./,'0.'));assert.equal(r.headers.get('x-avatar-zoom'),'2');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2]);assert(![...r.headers].join().includes(profile));}assert.equal(f.reads,2);assert.equal(f.calls,2);
});
test('未認証401・不許可/画像なし404・障害503、全応答no-storeで秘密値を返さない',async()=>{
 const unauth=await serve(req(),club,member,async()=>{throw new MediaFailure('secret diagnostic',401)});assert.equal(unauth.status,401);policy(unauth);assert(!await unauth.text().then(s=>s.includes('secret')));
 for(const [data,error,status]of [[[],null,404],[null,{code:'42501'},404],[null,{code:'XX000'},503],[{},null,503],[[row,row],null,503]]){const f=fixture(data,error),r=await serve(req(),club,member,f.authenticate);assert.equal(r.status,status);policy(r);assert.equal(f.reads,0);}
 const f=fixture(),r=await serve(req(),'invalid',member,f.authenticate);assert.equal(r.status,404);assert.equal(f.calls,0);
});
test('キーprefix/UUID・画像版・位置の異常をR2取得前に拒否',async()=>{
 for(const changed of [{avatar_key:`profiles/other/${member}.webp`},{avatar_key:row.avatar_key+'?x'},{avatar_zoom:5},{avatar_focus_x:NaN},{avatar_version:-1},{avatar_pose_version:'1'}]){const f=fixture([{...row,...changed}]),r=await serve(req(),club,member,f.authenticate);assert.equal(r.status,503);assert.equal(f.reads,0)}
});
test('R2不在/障害でも標準アイコンへ戻せる応答・内部情報非露出',async()=>{
 for(const [get,status]of [[async()=>null,404],[async()=>{throw Error('private-object-key')},503],[async()=>({body:stream(),size:300000}),503]]){const f=fixture(),r=await serve(req(),club,member,async()=>({...await f.authenticate(),bucket:{get}}));assert.equal(r.status,status);policy(r);assert(!await r.text().then(s=>s.includes('private-object')))}
});
