const {test}=require('node:test');
const assert=require('node:assert/strict');
const {guestLineupSnapshot,roundCards,swapRoundPlayers,revisedGuestRound,saveGuestRoundLineup}=require('../lib/guest-round-lineup.ts');
const {handler}=require('./fixtures/stats-helpers.cjs');
function fixture(){return {id:'guest_test',name:'架空イベント',status:'active',event_mode:'auto',stats_mode:'official',court_count:2,created_at:'2026-11-05',participants:Array.from({length:10},(_,i)=>({id:'p'+i,guest_name:'選手'+i,status:'active',participant_type:'guest'})),matches:Array.from({length:2},(_,i)=>({id:'m'+i,court_number:i+1,round_number:1,created_at:'2026-11-05',completed:false,youtube_url:'https://youtu.be/abcdefghijk',result:null,players:Array.from({length:4},(_,j)=>({participant_id:'p'+(i*4+j),team:j<2?'A':'B'}))}))};}

test('同コート・別コート・休憩者の入替を保存前のコピーで編成し、各ペア2名とRound全体の重複なしを保つ',()=>{
 for(const target of ['p1','p4','p8']){
  const event=fixture(),snapshot=guestLineupSnapshot(event),cards=swapRoundPlayers(roundCards(event,1),'m0','p0',target),next=revisedGuestRound(event,snapshot,1,cards);
  assert.equal(guestLineupSnapshot(event),snapshot);
  assert.equal(next.matches[0].players[0].participant_id,target);
  const played=next.matches.flatMap(m=>m.players.map(p=>p.participant_id));assert.equal(new Set(played).size,8);
  for(const m of next.matches){assert.equal(m.players.filter(p=>p.team==='A').length,2);assert.equal(m.players.filter(p=>p.team==='B').length,2);assert.equal(m.created_at,'2026-11-05');assert.equal(m.youtube_url,event.matches[0].youtube_url);assert.equal(m.completed,false);assert.equal(m.result,null);}
  if(target==='p4')assert.equal(next.matches[1].players[0].participant_id,'p0');
  if(target==='p8')assert(!played.includes('p0'));
 }
});

test('Round全体を同期1回で保存し、別Round・イベント情報・参加状態を維持する',()=>{
 const event=fixture();event.matches.push({...structuredClone(event.matches[0]),id:'past',round_number:0,result:{score_a:4,score_b:0,winner_team:'A'},completed:true});let saved=structuredClone(event),writes=0;
 const next=saveGuestRoundLineup(event.id,guestLineupSnapshot(event),1,swapRoundPlayers(roundCards(event,1),'m0','p0','p4'),{read:()=>structuredClone(saved),write:v=>{writes++;saved=structuredClone(v);}});
 assert.equal(writes,1);assert.deepEqual(next.matches[2],event.matches[2]);assert.deepEqual(next.participants,event.participants);assert.equal(next.court_count,2);
 assert.equal(saved.matches[0].players[0].participant_id,'p4');assert.equal(saved.matches[1].players[0].participant_id,'p0');
});

test('スコア済み・未完了でも結果行あり・対象外参加者・重複・不足・別カードへの変更を保存しない',()=>{
 for(const kind of ['completed','result','resting','absent','unknown','duplicate','missing','foreign']){
  const event=fixture(),cards=roundCards(event,1);
  if(kind==='completed')event.matches[0].completed=true;
  if(kind==='result')event.matches[0].result={score_a:0,score_b:0,winner_team:'draw'};
  if(['resting','absent'].includes(kind))event.participants[8].status=kind;
  const draft=swapRoundPlayers(cards,'m0','p0','p8');
  if(kind==='unknown')draft[0].players[0].participant_id='other';
  if(kind==='duplicate')draft[0].players[0].participant_id='p4';
  if(kind==='missing')draft[0].players.pop();
  if(kind==='foreign')draft[0].id='other';
  assert.throws(()=>revisedGuestRound(event,guestLineupSnapshot(event),1,draft));
 }
 const event=fixture(),cards=roundCards(event,1);cards[1].completed=true;
 assert.throws(()=>swapRoundPlayers(cards,'m0','p0','p4'),/スコア/);
});

test('同時編集・スコア保存・参加状態変更・終了・次Round生成を検出して書き込まない',()=>{
 for(const change of [e=>e.matches[0].players.reverse(),e=>e.matches[0].result={score_a:1,score_b:0},e=>e.participants[8].status='resting',e=>e.status='closed',e=>e.matches.push({...e.matches[0],id:'next',round_number:2})]){
  const event=fixture(),expected=guestLineupSnapshot(event),cards=swapRoundPlayers(roundCards(event,1),'m0','p0','p4');change(event);let writes=0;
  assert.throws(()=>saveGuestRoundLineup(event.id,expected,1,cards,{read:()=>event,write:()=>writes++}));assert.equal(writes,0);
 }
});

test('保存拒否では元の2コートを維持し、確認失敗でも成功扱いせず、不明な結果を自動で戻さない',()=>{
 const event=fixture(),expected=guestLineupSnapshot(event),cards=swapRoundPlayers(roundCards(event,1),'m0','p0','p4');let saved=structuredClone(event),reads=0;
 assert.throws(()=>saveGuestRoundLineup(event.id,expected,1,cards,{read:()=>saved,write:()=>{throw Error('容量超過');}}),/一時保存/);assert.equal(guestLineupSnapshot(saved),expected);
 assert.throws(()=>saveGuestRoundLineup(event.id,expected,1,cards,{read:()=>++reads===1?event:null,write:v=>saved=v}),/保存結果/);
 assert.equal(saved.matches[0].players[0].participant_id,'p4');assert.equal(saved.matches[1].players[0].participant_id,'p0');
});

test('ログインイベントにはゲスト保存を使用せず、表示上の入口を迂回してもDB操作しない',()=>{
 let calls=0;
 assert.throws(()=>saveGuestRoundLineup('authenticated-event','',1,[],{read:()=>{calls++;},write:()=>calls++}),/専用/);assert.equal(calls,0);
 handler('app/events/[id]/page.tsx','openGuestLineup',{guestMode:false,getGuestEvent:()=>{calls++;}})({});assert.equal(calls,0);
});
