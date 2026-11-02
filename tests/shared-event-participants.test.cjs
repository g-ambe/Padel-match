const {test}=require('node:test');
const assert=require('node:assert/strict');
const {handler}=require('./fixtures/stats-helpers.cjs');

test('共有メンバーは採点済み試合の出場者だけに絞り、未出場・未採点を除きゲストや休憩中も出場済みなら残す',()=>{
 const participants=[{id:'member',display_name:'メンバー'},{id:'guest',display_name:'ゲスト',participant_type:'guest'},{id:'resting',display_name:'休憩中',status:'rest'},{id:'unplayed',display_name:'未出場'},{id:'scheduled',display_name:'組み合わせのみ'},{id:'incomplete',display_name:'未完了'}];
 const match=(ids,completed,result)=>({completed,result,match_players:ids.map(participant_id=>({participant_id}))});
 const matches=[match(['member','guest'],true,{score_a:0,score_b:0}),match(['member','resting'],true,{score_a:6,score_b:4}),match(['scheduled'],false,null),match(['incomplete'],false,{score_a:6,score_b:3})];
 const rows=handler('app/share/events/[token]/page.tsx','playedParticipants',{participants,matches})();
 assert.deepEqual(rows.map(p=>p.id),['member','guest','resting']);
 assert.equal(participants.length,6);assert.equal(matches.length,4);
});

test('試合なし・未入力・不正スコアだけなら共有メンバー一覧は空になる',()=>{
 for(const matches of [[],[{completed:true,result:null,match_players:[{participant_id:'member'}]}],[{completed:true,result:{score_a:NaN,score_b:2},match_players:[{participant_id:'member'}]}]]){
  assert.deepEqual(handler('app/share/events/[token]/page.tsx','playedParticipants',{participants:[{id:'member'}],matches})(),[]);
 }
});
