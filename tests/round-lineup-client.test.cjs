const {test}=require('node:test'),assert=require('node:assert/strict');
const {createFriendlyScoreCommit,createLineupCommit}=require('../lib/round-lineup.ts');
const {createScoreSaveQueue}=require('../lib/score-save-queue.ts');
const {saveGuestRoundLineup,guestLineupSnapshot,roundCards,swapRoundPlayers}=require('../lib/guest-round-lineup.ts');
const poll=async fn=>{while(!fn())await new Promise(r=>setTimeout(r,1));};
test('キュー再試行は元の構成・版数・結果期待値・操作IDを保持し、新しい表示へ付け替えない',async()=>{
 const calls=[];let fail=true;
 const db={rpc:async(name,body)=>{calls.push(structuredClone(body));return fail?{data:null,error:{code:'40001',message:'構成変更'}}:{data:{request_id:body.p_request_id,match_id:body.p_match_id,result:{id:'r',score_a:0,score_b:0,winner_team:'draw'}},error:null};}};
 const match={id:'m',completed:false,lineup_revision:0,players:[{participant_id:'a',team:'A'}],result:null};
 const send=createFriendlyScoreCommit(db,'e',match),queue=createScoreSaveQueue();queue.submit('e#m',{a:'0',b:'0'},async s=>send(Number(s.a),Number(s.b)));await poll(()=>queue.getSnapshot()['e#m']?.status==='error');
 match.lineup_revision=9;match.players[0].participant_id='changed';queue.retry('e#m');await poll(()=>calls.length===2&&queue.getSnapshot()['e#m'].status==='error');assert.deepEqual(calls[1],calls[0]);assert.equal(calls[1].p_players[0].participant_id,'a');
 fail=false;queue.retry('e#m');await poll(()=>!queue.has('e#m'));assert.deepEqual(calls[2],calls[0]);
});
test('入替の応答喪失後は同じ要求だけを再送し、本人の操作で新しく開くまでは内容を変えない',async()=>{
 const calls=[];let lost=true;const snapshot={event_id:'e',round_id:'r',cards:[],people:[],eligible:[]};
 const db={rpc:async(n,b)=>{calls.push(structuredClone(b));return lost?{error:{message:'応答喪失'}}:{data:{request_id:b.p_request_id,snapshot},error:null};}};
 const send=createLineupCommit(db,snapshot),cards=[{id:'m',players:[{participant_id:'p',team:'A'}]}];await assert.rejects(send(cards),/応答喪失/);await assert.rejects(send([]),/結果が不明/);lost=false;await send(cards);assert.deepEqual(calls[0],calls[1]);
});
test('ゲストの同期保存後の確認失敗を再試行しても2回書き込まず、スコア・別Roundを保つ',()=>{
 const e={id:'guest_retry',name:'合成',court_count:1,event_mode:'auto',stats_mode:'official',status:'active',created_at:'2026-11-06',participants:Array.from({length:5},(_,i)=>({id:'p'+i,guest_name:'選手'+i,status:'active',participant_type:'guest'})),matches:[{id:'m',court_number:1,round_number:1,completed:false,result:null,players:Array.from({length:4},(_,i)=>({participant_id:'p'+i,team:i<2?'A':'B'}))}]};
 let saved=structuredClone(e),reads=0,writes=0;const expected=guestLineupSnapshot(e),cards=swapRoundPlayers(roundCards(e,1),'m','p0','p4');const store={read:()=>++reads===2?null:saved,write:v=>{saved=v;writes++;}};
 assert.throws(()=>saveGuestRoundLineup(e.id,expected,1,cards,store),/結果を確認/);saveGuestRoundLineup(e.id,expected,1,cards,store);assert.equal(writes,1);assert.equal(saved.matches[0].players[0].participant_id,'p4');
});
