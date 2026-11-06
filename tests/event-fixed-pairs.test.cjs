const {test}=require('node:test');const assert=require('node:assert/strict');
const {readEventFixedPairs,saveEventFixedPairs,createEventFixedRound,finishEventWithFixedPairs,FixedPairRequestError,readPendingFixedRound,storePendingFixedRound}=require('../lib/event-fixed-pairs.ts');
const {handler,database,fixture,profileStats,groupStats,fetchCountedFriendlyEvents}=require('./fixtures/stats-helpers.cjs');
const {readFriendlyRoundRows}=require('../lib/friendly-round-history.ts');
const {generateFriendlyRound,scoredFriendlyMatches}=require('./fixtures/friendly-round-helpers.cjs');
const {generateFriendlyRoundWithFixedPairs}=require('../lib/friendly-fixed-pairs.ts');
const page='app/events/[id]/page.tsx';
const empty={event_id:'event',revision:0,pairs:[],eligible_rounds:[],used_fixed_pairs:false};
const mock=(data,error=null)=>({rpc:async()=>({data,error})});
test('固定設定の取得エラー・不正応答・更新0件を空設定や保存成功へ置き換えない',async()=>{
 for(const data of [null,[],{...empty,event_id:'other'},{...empty,revision:-1},{...empty,pairs:[{id:'pair',a:'a',b:'a'}]}])await assert.rejects(readEventFixedPairs(mock(data),'event'),FixedPairRequestError);
 await assert.rejects(readEventFixedPairs(mock(null,{code:'42501',message:'閲覧権限がありません'}),'event'),/閲覧権限/);
 for(const data of [null,empty,{...empty,revision:1,pairs:[{id:'wrong',a:'a',b:'b'}]}])await assert.rejects(saveEventFixedPairs(mock(data),empty,[], 'request'));
 await assert.rejects(saveEventFixedPairs(mock({...empty,revision:2}),{...empty,revision:1,used_fixed_pairs:true},[],'request'));
 assert.equal((await saveEventFixedPairs(mock({...empty,revision:1}),empty,[],'request')).revision,1);
});
test('Roundと終了の確認応答を検査し、確定拒否と保存結果不明を区別する',async()=>{
 const request={eventId:'event',requestId:'request',revision:0,lastRound:2,courtCount:1,mode:'normal',activeIds:['a','b','c','d'],matches:[{court:1,teamA:['a','b'],teamB:['c','d']}]};
 const ack={event_id:'event',request_id:'request',round_id:'round',round_number:3};
 for(const data of [null,{...ack,request_id:'other'},{...ack,round_number:4}])await assert.rejects(createEventFixedRound(mock(data),request));
 await assert.rejects(createEventFixedRound(mock(null,{code:'40001',message:'設定が変更されています'}),request),e=>e.definitelyRejected);
 await assert.rejects(createEventFixedRound(mock(null,{code:'23502',message:'必須項目がありません'}),request),e=>e.definitelyRejected);
 await assert.rejects(createEventFixedRound(mock(null,{message:'Fetch failed'}),request),e=>!e.definitelyRejected);
 await assert.rejects(createEventFixedRound(mock(null,{code:'400',message:'Gateway response'}),request),e=>!e.definitelyRejected);
 assert.deepEqual(await createEventFixedRound(mock(ack),request),ack);
 await assert.rejects(finishEventWithFixedPairs(mock(null),{...empty,used_fixed_pairs:true},true),/選択/);
 await assert.rejects(finishEventWithFixedPairs(mock({event_id:'event',status:'closed',stats_mode:'official'}),{...empty,used_fixed_pairs:true},true,'record_only'));
 assert.equal((await finishEventWithFixedPairs(mock({event_id:'event',status:'closed',stats_mode:'record_only'}),{...empty,used_fixed_pairs:true},true,'record_only')).stats_mode,'record_only');
});
test('保存結果不明の生成要求はアカウント・イベント単位で保持し、再読み込みでも同じ内容で再試行する',()=>{
 const before=global.window,store=new Map();global.window={sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};
 try{const request={eventId:'event',requestId:'req',revision:1,lastRound:2,activeIds:[],matches:[]};storePendingFixedRound('user','event',request);assert.deepEqual(readPendingFixedRound('user','event'),request);assert.equal(readPendingFixedRound('other','event'),null);assert.equal(readPendingFixedRound('user','other'),null);storePendingFixedRound('user','event',null);assert.equal(readPendingFixedRound('user','event'),null);global.window.sessionStorage.getItem=()=>{throw Error('利用不可')};assert.equal(readPendingFixedRound('user','event'),null);}finally{global.window=before;}
});
test('画面の設定保存が競合・不明応答・DB拒否を成功表示せず、取得失敗で生成もしない',async()=>{
 let writes=0,success=0;const errors=[];const scope={current:'user:event'};
 const bindings={eventId:'event',fixedFeature:true,eventStatus:'active',scopedFixedState:empty,fixedScope:scope,getSupabaseClient:()=>mock(null,{code:'40001',message:'別端末で変更されています'}),setFixedSaving:()=>{},setFixedError:e=>errors.push(e),setMessage:m=>{if(m)success++},setFixedState:()=>writes++};
 assert.equal(await handler(page,'saveFixedPairs',bindings)([]),false);assert.equal(writes,0);assert.equal(success,0);assert(errors.some(e=>e.includes('別端末')));
 const f=fixture(),db=database(f.tables);Object.assign(f.tables.events[0],{status:'active',event_mode:'auto',court_count:1});f.tables.event_participants.forEach(p=>p.status='active');let generated=false;
 const fail=()=>Promise.reject(new Error('固定設定の取得失敗'));
 await handler(page,'generateRound',{getSupabaseClient:()=>db.s,eventId:'event-a',eventMode:'auto',eventStatus:'active',guestMode:false,isGeneratingRound:false,roundUserId:'user',selectedRoundMode:'normal',latestRoundNumber:1,readFriendlyRoundRows,scoredFriendlyMatches,FRIENDLY_MODE_UNLOCK_MATCHES:10,fetchActiveClubMemberParticipants:async()=>[0,1,2,3].map(i=>({playerProfileId:`player-${i}`})),readEventFixedPairs:fail,generateFriendlyRound:()=>{generated=true},setIsGeneratingRound:()=>{},setError:e=>errors.push(e),setIsDeletedEvent:()=>{},loadAll:async()=>{}})();
 assert.equal(generated,false);assert(!db.calls.some(c=>c.method==='POST'&&c.table!=='get_friendly_lineup_versions'));assert(errors.includes('固定設定の取得失敗'));
});
test('画面の実生成処理は固定を生成器へ渡し、同じ要求の再試行で新しい生成を行わない',async()=>{
 const f=fixture(),db=database(f.tables);Object.assign(f.tables.events[0],{status:'active',event_mode:'auto',court_count:1});f.tables.event_participants.forEach(p=>p.status='active');
 const participants=f.tables.event_participants.filter(p=>p.event_id==='event-a'&&p.participant_type==='guest'||p.event_id==='event-a'&&p.player_profile_id!=='player-4'),activeIds=participants.map(p=>p.id);
 const pending={current:null},owner={current:null},requests=[];let fail=true,generated=0,reloads=0;
 const state={...empty,event_id:'event-a',pairs:[{id:'pair',a:activeIds[0],b:activeIds[1]}]},errors=[];
 const bindings={getSupabaseClient:()=>db.s,eventId:'event-a',eventMode:'auto',eventStatus:'active',guestMode:false,isGeneratingRound:false,roundUserId:'user',selectedRoundMode:'normal',latestRoundNumber:1,readFriendlyRoundRows,scoredFriendlyMatches,FRIENDLY_MODE_UNLOCK_MATCHES:10,fetchActiveClubMemberParticipants:async()=>[0,1,2,3].map(i=>({playerProfileId:`player-${i}`})),readEventFixedPairs:async()=>state,generateFriendlyRound,generateFriendlyRoundWithFixedPairs:args=>{generated++;assert.equal(args.fixedPairs,state.pairs);return generateFriendlyRoundWithFixedPairs(args)},pendingFixedRound:pending,pendingFixedOwner:owner,createEventFixedRound:async(s,r)=>{requests.push(r);if(fail)throw new FixedPairRequestError('応答不明');},setIsGeneratingRound:()=>{},setError:e=>errors.push(e),setMessage:()=>{},setIsDeletedEvent:()=>{},loadAll:async()=>reloads++};
 await handler(page,'generateRound',bindings)();assert.equal(generated,1);assert(pending.current);assert.equal(reloads,0);fail=false;
 await handler(page,'generateRound',bindings)();assert.equal(generated,1);assert.equal(reloads,1);assert.equal(requests[0],requests[1]);assert.equal(pending.current,null);
});
test('利用済みの自動イベントも既存stats_modeで個人・ペア・グループ・将来評価の対象を切り替え、当日の結果は維持する',async()=>{
 const f=fixture(),db=database(f.tables),event=f.tables.events[0];
 const original=structuredClone({matches:f.tables.matches,results:f.tables.match_results,players:f.tables.match_players,participants:f.tables.event_participants});
 const profile=await profileStats(db.s),group=await groupStats(db.s);
 const view=f.tables.matches.filter(m=>m.event_id===event.id).map(m=>({...m,players:f.tables.match_players.filter(p=>p.match_id===m.id),result:f.tables.match_results.find(r=>r.match_id===m.id)}));
 const summary=()=>handler(page,'eventSummary',{participants:f.tables.event_participants.filter(p=>p.event_id===event.id),matches:view})();const day=summary();
 for(const mode of ['record_only','official','record_only','official']){
  event.status='active';event.stats_mode='undecided';assert.equal((await profileStats(db.s)).matches,2);
  event.status='closed';event.stats_mode=mode;
  if(mode==='official'){assert.deepEqual(await profileStats(db.s),profile);assert.deepEqual(await groupStats(db.s),group);}else{assert.equal((await profileStats(db.s)).matches,2);const only=await groupStats(db.s);assert.deepEqual(only.events.map(e=>e.id),['event-b']);assert(only.individual.every(p=>p.matches===1));assert(only.pairs.every(p=>p.matches<=1));}
  const past=await fetchCountedFriendlyEvents(db.s,{clubId:'club-a'},{before:'2027-01-01',excludeId:'new-event',ordinaryOnly:true});assert.equal(past.some(p=>p.id===event.id),mode==='official');assert.deepEqual(summary(),day);
 }
 assert.deepEqual({matches:f.tables.matches,results:f.tables.match_results,players:f.tables.match_players,participants:f.tables.event_participants},original);
});
test('終了ダイアログを開いた後に別端末が固定を利用しても、選択なしでofficialへ確定しない',async()=>{
 let saved=0;const errors=[];
 await handler(page,'closeEvent',{eventId:'event',roundUserId:'user',fixedFeature:true,guestMode:false,fixedCloseChoice:null,usedFixedPairs:false,closeStatsMode:'official',getSupabaseClient:()=>mock(null),readEventFixedPairs:async()=>({...empty,used_fixed_pairs:true}),scoreSaveState:{current:{saving:new Set()}},finishEventWithFixedPairs:async()=>saved++,setError:e=>errors.push(e)})();
 assert.equal(saved,0);assert(errors.some(e=>e.includes('反映方法を選択')));
});
