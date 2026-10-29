const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createScoreSaveQueue}=require('../lib/score-save-queue.ts');
const {handler,database}=require('./fixtures/stats-helpers.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('入力画面を閉じた後も送信を維持し、同じ試合の二重送信を防いで別試合は保存できる',async()=>{
  const queue=createScoreSaveQueue();let release,observations=0,writes=0;
  const gate=new Promise(resolve=>release=resolve),unsubscribe=queue.subscribe(()=>observations++);
  const input={a:'0',b:'0'};
  assert.equal(queue.submit('/events/a#m1',input,async scores=>{writes++;assert.deepEqual(scores,{a:'0',b:'0'});await gate;}),true);
  input.a='99';
  assert.equal(queue.hasUnsaved('/events/a#'),true);
  assert.equal(queue.hasUnsaved('/events/b#'),false);
  assert.equal(queue.submit('/events/a#m1',{a:'9',b:'9'},async()=>{writes++;}),false);
  assert.equal(queue.retry('/events/a#m1'),false);
  assert.equal(queue.submit('/events/a#m2',{a:'4',b:'2'},async()=>{writes++;}),true);
  unsubscribe(); // 履歴モーダルや元の画面の購読解除は保存を中断しない。
  await tick();assert.equal(writes,2);
  assert.equal(queue.getSnapshot()['/events/a#m1'].status,'saving');
  assert.equal(queue.has('/events/a#m2'),false);
  release();await tick();assert.equal(queue.hasUnsaved(),false);assert.equal(observations,2);
});

test('失敗時も入力と送信内容を保持し、再入力せずに再試行できる',async()=>{
  const queue=createScoreSaveQueue(),calls=[];let fail=true;
  queue.submit('/events/a#m1',{a:'0',b:'4'},async scores=>{calls.push({...scores});scores.a='変更';if(fail)throw new Error('保存拒否');});
  await tick();
  assert.equal(queue.hasSaving(),false);assert.equal(queue.hasUnsaved(),true);
  assert.deepEqual(queue.getSnapshot()['/events/a#m1'],{status:'error',scores:{a:'0',b:'4'},error:'保存拒否'});
  fail=false;assert.equal(queue.retry('/events/a#m1'),true);await tick();
  assert.deepEqual(calls,[{a:'0',b:'4'},{a:'0',b:'4'}]);assert.equal(queue.hasUnsaved(),false);
});

test('画面を再作成してもイベントごとの再試行用IDと送信ロックを共有し、別イベントには混在させない',()=>{
  const queue=createScoreSaveQueue(),first=queue.writeState('/events/a#');
  first.newIds.set('new:a','reserved-card');first.resultIds.set('match','saved-result');first.saving.add('match');
  const revisited=queue.writeState('/events/a#');
  assert.equal(revisited.newIds.get('new:a'),'reserved-card');assert.equal(revisited.resultIds.get('match'),'saved-result');assert.equal(revisited.saving.has('match'),true);
  const other=queue.writeState('/events/b#');assert.equal(other.newIds.size,0);assert.equal(other.resultIds.size,0);assert.equal(other.saving.size,0);
});

test('別イベントの保存は取得中の履歴を無効にせず、同じイベントの状態変更だけを判別する',async()=>{
  const queue=createScoreSaveQueue(),a='/events/a#',b='/events/b#';
  const original=queue.getRevision(b);
  queue.submit(a+'m1',{a:'0',b:'0'},async()=>{});await tick();
  assert.equal(queue.getRevision(b),original);assert(queue.getRevision(a)>0);
  queue.invalidateReads(b);assert(queue.getRevision(b)>original);assert.equal(queue.hasUnsaved(),false);
});

test('3形式とも保存中・保存失敗・カード書込み中はイベント終了をDBへ送信しない',async()=>{
  for(const [file,name] of [['app/events/[id]/page.tsx','closeEvent'],['app/team-matches/[id]/page.tsx','closeOrReopen'],['app/official-matches/[id]/page.tsx','updateEventStatus']]){
    const queue=createScoreSaveQueue(),db=database({events:[],official_events:[]}),errors=[];
    let release;const gate=new Promise(resolve=>release=resolve);
    queue.submit('test#match',{a:'0',b:'0'},async()=>{await gate;throw new Error('保存失敗');});
    const saving=new Set();
    const bindings={scoreQueue:queue,scoreScope:'test#',closingEvent:{current:false},setError:v=>errors.push(v),scoreSaveState:{current:{saving}},cardWrites:{current:{saving}},getSupabaseClient:()=>db.s};
    const close=()=>handler(file,name,bindings)('closed');
    await close();assert.equal(db.calls.length,0);assert.match(errors.at(-1),/保存/);
    release();await tick();await close();assert.equal(db.calls.length,0);assert.match(errors.at(-1),/再試行/);
    const fresh=createScoreSaveQueue();bindings.scoreQueue=fresh;saving.add('manual-card');await close();assert.equal(db.calls.length,0);
  }
});

test('終了処理が先に開始した場合はスコア送信を開始しない',async()=>{
  const db=database({});
  for(const [file,name,args] of [['app/events/[id]/page.tsx','saveScore',['match',{a:'0',b:'0'}]],['app/team-matches/[id]/page.tsx','saveMatch',[false,{}]],['app/official-matches/[id]/page.tsx','saveOfficialCard',[{}]]]){
    const errors=[],writes={saving:new Set(),newIds:new Map()};
    const result=await handler(file,name,{closingEvent:{current:true},scoreSaveState:{current:writes},cardWrites:{current:writes},editingId:null,id:'event',setError:v=>errors.push(v),setNotice:()=>{},getSupabaseClient:()=>db.s})(...args);
    assert.equal(result,false);assert.equal(db.calls.length,0);assert.match(errors.at(-1),/終了処理/);
  }
});
