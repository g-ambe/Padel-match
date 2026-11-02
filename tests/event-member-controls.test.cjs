const {test}=require('node:test');
const assert=require('node:assert/strict');
const {handler,database}=require('./fixtures/stats-helpers.cjs');
const page='app/events/[id]/page.tsx';

test('一般メンバー用の終了・再開処理は画面の更新条件で保存し、再取得後も状態を維持する',async()=>{
 for(const mode of ['auto','manual']){
  const event={id:'event',status:'active',is_deleted:false,stats_mode:'official'};
  const db=database({events:[event]});const errors=[];let reloads=0;
  const bindings={eventId:'event',eventMode:mode,guestMode:false,closeStatsMode:'record_only',scoreSaveState:{current:{saving:new Set()}},getSupabaseClient:()=>db.s,setError:v=>errors.push(v),setShowCloseModal:()=>{},loadAll:async()=>reloads++};
  await handler(page,'closeEvent',bindings)();assert.deepEqual(errors,[]);assert.equal(event.status,'closed');assert(event.closed_at);assert.equal(event.stats_mode,mode==='manual'?'record_only':'official');
  await handler(page,'reopenEvent',bindings)();assert.deepEqual(errors,[]);assert.equal(event.status,'active');assert.equal(event.stats_mode,mode==='manual'?'undecided':'official');assert.equal(reloads,2);
  assert(db.calls.filter(c=>c.method==='PATCH').every(c=>c.table==='events'));
 }
});

test('終了・再開のRLS拒否や0行更新を成功扱いしない',async()=>{
 for(const name of ['closeEvent','reopenEvent'])for(const denied of [false,true]){
  const errors=[];let reloads=0;const db=database({events:[]},{fail:c=>denied&&c.method==='PATCH'});
  await handler(page,name,{eventId:'event',eventMode:'auto',guestMode:false,scoreSaveState:{current:{saving:new Set()}},getSupabaseClient:()=>db.s,setError:v=>errors.push(v),setShowCloseModal:()=>{},loadAll:async()=>reloads++})();
  assert.equal(errors.length,1);assert.equal(reloads,0);
 }
});

test('開催名変更は返却された1行を確認し、0行・拒否を成功扱いしない',async()=>{
 for(const kind of ['ok','missing','denied']){
  const event={id:'event',name:'変更前',is_deleted:false};const db=database({events:kind==='missing'?[]:[event]},{fail:c=>kind==='denied'&&c.method==='PATCH'});const errors=[];let savedName;
  await handler(page,'saveEventName',{eventId:'event',eventNameDraft:'変更後',guestMode:false,canManageEventName:true,getSupabaseClient:()=>db.s,setError:v=>{if(v)errors.push(v)},setMessage:()=>{},setEventName:v=>savedName=v,setIsEditingEventName:()=>{}})();
  assert.equal(errors.length,kind==='ok'?0:1);assert.equal(savedName,kind==='ok'?'変更後':undefined);
 }
});
