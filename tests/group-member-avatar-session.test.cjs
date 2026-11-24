const {test}=require('node:test'),assert=require('node:assert/strict');
require('node:module').registerHooks({resolve(s,c,next){return next(s.startsWith('./profile-media/')?s+'.ts':s,c)}});
const {GroupAvatarSession,fetchGroupAvatar}=require('../lib/group-member-avatars.ts');
const position={x:.5,y:.5,zoom:1},blob=new Blob(['synthetic'],{type:'image/webp'});
const tick=()=>new Promise(r=>setImmediate(r));
test('同時取得3件・同一表示内再利用・disposeで全URL破棄',async()=>{
 let active=0,max=0,loads=0,seq=0;const pending=[],revoked=[];
 const s=new GroupAvatarSession(async()=>{active++;loads++;max=Math.max(max,active);await new Promise(r=>pending.push(r));active--;return{blob,position}},{create:()=>`blob:${++seq}`,revoke:u=>revoked.push(u)});
 const values=[];for(let i=0;i<8;i++)s.watch(String(i),v=>{if(v)values.push(v)});
 assert.equal(loads,3);
 while(values.length<8){pending.splice(0).forEach(r=>r());await tick()}
 assert.equal(max,3);assert.equal(loads,8);let cached;s.watch('0',v=>{cached=v});assert(cached);assert.equal(loads,8);
 s.dispose();assert.equal(revoked.length,8);
});
test('タブ/club/auth切替の破棄後に遅延応答を採用せず、未取得のキューは開始しない',async()=>{
 let finish,created=0,calls=0,signal;
 const s=new GroupAvatarSession(async(_,sig)=>{signal=sig;calls++;await new Promise(r=>finish=r);return{blob,position}},{create:()=>{created++;return'blob:x'},revoke:()=>{}},1);
 let displayed=0;s.watch('a',v=>{if(v)displayed++});s.watch('b',()=>{});s.dispose();assert(signal.aborted);finish();await tick();assert.equal(calls,1);assert.equal(created,0);assert.equal(displayed,0);
});
test('画面外行の要求は中断し、失敗を無限リトライしない。再訪は新セッション',async()=>{
 let calls=0;const s=new GroupAvatarSession(async()=>{calls++;throw Error('404')});const off=s.watch('failed',()=>{});await tick();off();s.watch('failed',()=>{});await tick();assert.equal(calls,1);s.dispose();
 const next=new GroupAvatarSession(async()=>{calls++;return{blob,position}},{create:()=> 'blob:new',revoke:()=>{}});next.watch('failed',()=>{});await tick();assert.equal(calls,2);next.dispose();
});
test('表示領域から外れた行の取得を中断し、遅延応答からURLを作らない',async()=>{
 let finish,signal,created=0;
 const s=new GroupAvatarSession(async(_,sig)=>{signal=sig;await new Promise(r=>finish=r);return{blob,position}},{create:()=>{created++;return'blob:late'},revoke:()=>{}});
 const off=s.watch('row',()=>{});off();assert(signal.aborted);finish();await tick();assert.equal(created,0);s.dispose();
});
test('HTTP画像はBearer/no-store・安全な位置ヘッダが必須',async()=>{
 const before=global.fetch;
 try{global.fetch=async(url,init)=>{assert.match(url,/\/api\/groups\/club\/members\/member\/avatar$/);assert.equal(init.cache,'no-store');assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,'Bearer token');return new Response(blob,{headers:{'Content-Type':'image/webp','X-Avatar-Focus-X':'.3','X-Avatar-Focus-Y':'.7','X-Avatar-Zoom':'2'}})};
 assert.deepEqual((await fetchGroupAvatar('club','member','token',new AbortController().signal)).position,{x:.3,y:.7,zoom:2});
 global.fetch=async()=>new Response(blob,{headers:{'Content-Type':'image/webp'}});await assert.rejects(fetchGroupAvatar('c','m','t',new AbortController().signal));
 }finally{global.fetch=before}
});
