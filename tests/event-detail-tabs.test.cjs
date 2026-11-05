const {test}=require('node:test');
const assert=require('node:assert/strict');
const {database,handler}=require('./fixtures/stats-helpers.cjs');
const {readParticipantStatus,saveParticipantStatus}=require('../lib/event-participant-status.ts');
const page='app/events/[id]/page.tsx';

test('参加・休憩・欠席の更新は開催・ID・元状態を限定し、1行の返却と再取得を確認する',async()=>{
 for(const before of ['active','resting','absent'])for(const next of ['active','resting','absent']){
  const rows=[{id:'p',event_id:'event',status:before},{id:'other',event_id:'other-event',status:'active'}];
  const db=database({event_participants:rows});
  assert.equal((await saveParticipantStatus(db.s,'event','p',before,next)).status,next);
  assert.deepEqual(rows[1],{id:'other',event_id:'other-event',status:'active'});
  assert.deepEqual(db.calls.map(c=>c.method),['PATCH','GET']);
  assert.deepEqual(db.calls[0].body,{status:next});
  assert.equal(db.calls[0].url.searchParams.get('event_id'),'eq.event');
  assert.equal(db.calls[0].url.searchParams.get('status'),'eq.'+before);
 }
});

test('RLS拒否・更新0件・複数件・同時変更を成功扱いせず、他の状態を上書きしない',async()=>{
 for(const kind of ['denied','missing','many','conflict']){
  const rows=kind==='missing'?[]:[{id:'p',event_id:'event',status:kind==='conflict'?'absent':'active'}];
  if(kind==='many')rows.push({...rows[0]});
  const db=database({event_participants:rows},{fail:c=>kind==='denied'&&c.method==='PATCH'});
  await assert.rejects(saveParticipantStatus(db.s,'event','p','active','resting'),/更新|競合/);
  assert.equal(db.calls.length,1);
  if(kind==='conflict')assert.equal(rows[0].status,'absent');
 }
});

test('保存後の取得失敗・内容不一致を成功扱いせず、確認用の再取得に対応する',async()=>{
 for(const kind of ['read-error','changed']){
  const rows=[{id:'p',event_id:'event',status:'active'}];
  const db=database({event_participants:rows},{fail:c=>{if(c.method==='GET'){if(kind==='read-error')return true;rows[0].status='absent';}return false;}});
  await assert.rejects(saveParticipantStatus(db.s,'event','p','active','resting'),/確認|変更/);
  assert.deepEqual(db.calls.map(c=>c.method),['PATCH','GET']);
 }
 const db=database({event_participants:[{id:'p',event_id:'event',status:'absent'}]});
 assert.equal((await readParticipantStatus(db.s,'event','p')).status,'absent');
 await assert.rejects(readParticipantStatus(db.s,'other-event','p'),/確認/);
});

function statusBindings(patch={}){
 const state={people:[{id:'p',status:'active'}],errors:{},message:'',busy:new Set()};
 const bindings={eventId:'event',eventStatus:'active',guestMode:false,canManageEventName:true,participants:state.people,
  participantWrites:{current:new Set()},participantStatusRevision:{current:0},
  setBusyParticipants:v=>state.busy=v,setParticipantErrors:v=>state.errors=typeof v==='function'?v(state.errors):v,
  setParticipants:v=>state.people=typeof v==='function'?v(state.people):v,setParticipantMenuId:()=>{},setMessage:v=>state.message=v,
  saveParticipantStatus,readParticipantStatus,...patch};
 return {state,bindings};
}

test('同じ参加者の連打は1回だけ送信し、確認前には表示を変えず、対戦・固定設定には書き込まない',async()=>{
 let release,calls=0;
 const {state,bindings}=statusBindings({saveParticipantStatus:async()=>{calls++;await new Promise(r=>release=r);return {status:'resting'};},getSupabaseClient:()=>({})});
 const update=handler(page,'updateStatus',bindings),first=update('p','resting');
 await update('p','absent');assert.equal(calls,1);assert.equal(state.people[0].status,'active');assert(state.busy.has('p'));
 release();await first;assert.equal(state.people[0].status,'resting');assert.equal(state.busy.size,0);assert.match(state.message,/保存しました/);
 const db=database({event_participants:[{id:'p',event_id:'event',status:'active'}]});
 const real=statusBindings({getSupabaseClient:()=>db.s});await handler(page,'updateStatus',real.bindings)('p','absent');
 assert(db.calls.every(c=>c.table==='event_participants'));assert.equal(real.state.people[0].status,'absent');
});

test('参加状態の更新失敗では表示と成功メッセージを変えず、再取得してから再操作できる',async()=>{
 const db=database({event_participants:[{id:'p',event_id:'event',status:'absent'}]});
 const {state,bindings}=statusBindings({getSupabaseClient:()=>db.s});
 const update=handler(page,'updateStatus',bindings);
 await update('p','resting');assert.equal(state.people[0].status,'active');assert.equal(state.message,'');assert.match(state.errors.p,/競合/);
 await update('p');assert.equal(state.people[0].status,'absent');assert.deepEqual(state.errors,{});
});

test('終了済み・閲覧のみ・生成中の状態変更は送信せず、確認用の読み取りは許可する',async()=>{
 for(const patch of [{eventStatus:'closed'},{canManageEventName:false},{boardOperation:{current:'round'}}]){
  let calls=0;const {bindings}=statusBindings({...patch,getSupabaseClient:()=>({}),saveParticipantStatus:async()=>{calls++;},readParticipantStatus:async()=>{calls++;return {status:'active'};}});
  const update=handler(page,'updateStatus',bindings);await update('p','absent');assert.equal(calls,0);await update('p');assert.equal(calls,1);
 }
});

test('ゲストの欠席・復帰も同じ確認を使い、試合・得点・他の参加者を維持する',async()=>{
 let saved={status:'active',participants:[{id:'p',status:'active'},{id:'q',status:'resting'}],matches:[{id:'match',result:{score_a:4,score_b:0}}]};
 const before=structuredClone(saved);
 const {state,bindings}=statusBindings({guestMode:true,getGuestEvent:()=>structuredClone(saved),upsertGuestEvent:v=>saved=structuredClone(v)});
 await handler(page,'updateStatus',bindings)('p','absent');assert.equal(state.people[0].status,'absent');
 assert.deepEqual(saved.matches,before.matches);assert.deepEqual(saved.participants[1],before.participants[1]);
 const failed=statusBindings({guestMode:true,getGuestEvent:()=>structuredClone(before),upsertGuestEvent:()=>{throw new Error('保存不可');}});
 await handler(page,'updateStatus',failed.bindings)('p','resting');assert.equal(failed.state.people[0].status,'active');assert.match(failed.state.errors.p,/保存不可/);
});

test('初期タブは取得した開催状態に従い、再読み込みで利用者の選択を戻さず、別開催へ持ち越さない',()=>{
 let tab=null;
 const initialize=(eventId,status)=>handler(page,'initializeEventTab',{eventId,setEventTab:v=>tab=typeof v==='function'?v(tab):v})(status);
 initialize('closed-event','closed');assert.equal(tab.value,'results');
 tab.value='participants';initialize('closed-event','closed');assert.equal(tab.value,'participants');
 initialize('active-event','active');assert.equal(tab.value,'matches');
});

test('終了・再開に成功した時だけタブを変更し、その後の再取得失敗でも切替を保持する',async()=>{
 for(const name of ['closeEvent','reopenEvent'])for(const denied of [false,true]){
  const db=database({events:[{id:'event',status:name==='closeEvent'?'active':'closed',is_deleted:false}]},{fail:c=>denied&&c.method==='PATCH'});
  let tab=name==='closeEvent'?'matches':'results';
  const binding={eventId:'event',eventMode:'auto',guestMode:false,closeStatsMode:'official',getSupabaseClient:()=>db.s,
   scoreSaveState:{current:{saving:new Set()}},setError:()=>{},setShowCloseModal:()=>{},
   setEventTab:v=>tab=v.value,scrollToResults:()=>tab='results',loadAll:async()=>{throw new Error('試験用再取得失敗');}};
  try{await handler(page,name,binding)();}catch(error){assert.match(error.message,/試験用再取得失敗/);}
  assert.equal(tab,denied?(name==='closeEvent'?'matches':'results'):(name==='closeEvent'?'results':'matches'));
 }
});
