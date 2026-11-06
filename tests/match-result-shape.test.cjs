const {test}=require('node:test'),assert=require('node:assert/strict');
const {firstMatchResult,matchResultRows}=require('../lib/friendly-match-results.ts');
const {createFriendlyScoreCommit}=require('../lib/round-lineup.ts');
const {fixture,database,groupStats,profileStats}=require('./fixtures/stats-helpers.cjs');
const {collectBalancePastStats}=require('../lib/friendly-balance-history.ts');

test('一意制約前の配列と適用後のobject/nullを同じ結果として読み、0対0も維持する',()=>{
 const row={id:'result',score_a:0,score_b:0,winner_team:'draw'};
 assert.equal(firstMatchResult(row),row);assert.equal(firstMatchResult([row]),row);
 for(const missing of [null,undefined,[]]){assert.equal(firstMatchResult(missing),null);assert.deepEqual(matchResultRows(missing),[]);}
 const conflicting=[row,{...row,score_a:1}];assert.deepEqual(matchResultRows(conflicting),conflicting);
});

test('object形式の再取得でも保存済み得点とIDを保持し、続けて編集・再送できる',async()=>{
 const {tables}=fixture(),{s,calls}=database(tables,{oneToOneResults:true});
 tables.events[0].status='active';
 const read=async()=>{const {data,error}=await s.from('matches').select('id,completed,match_players(participant_id,team),match_results(id,score_a,score_b,winner_team)').eq('id',tables.matches[0].id);assert.ifError(error);const m=data[0];assert(!Array.isArray(m.match_results));return{...m,players:m.match_players,result:firstMatchResult(m.match_results),lineup_revision:0};};
 let m=await read();const original=m.result.id;
 await createFriendlyScoreCommit(s,m.event_id,m)(0,0);m=await read();assert.equal(m.result.id,original);assert.equal(m.result.score_a,0);assert.equal(m.result.winner_team,'draw');
 const edit=createFriendlyScoreCommit(s,m.event_id,m);await edit(4,0);await edit(4,0);m=await read();assert.equal(m.result.id,original);assert.equal(m.result.score_a,4);
 const requests=calls.filter(c=>c.table==='save_friendly_match_score');assert.equal(requests[1].body.p_expected_score.results[0].id,original);assert.deepEqual(requests[1].body,requests[2].body);
});

test('一対一APIでも個人・ペア・グループ・プロフィール・過去評価の集計値を変えない',async()=>{
 const {tables}=fixture(),array=database(structuredClone(tables),{oneToOneResults:false}),object=database(structuredClone(tables),{oneToOneResults:true});
 const before=await groupStats(array.s),after=await groupStats(object.s);assert(before.individual.some(r=>r.matches>0));assert.deepEqual(after,before);
 const profileBefore=await profileStats(array.s);assert(profileBefore.matches>0);assert.deepEqual(await profileStats(object.s),profileBefore);
 const participants=[{id:'current',player_profile_id:'player-0',participant_type:'member'}];
 const args=[participants,tables.club_members,tables.event_participants];
 const baseline=collectBalancePastStats(...args,tables.matches.map(m=>({...m,match_players:tables.match_players.filter(p=>p.match_id===m.id),match_results:tables.match_results.filter(r=>r.match_id===m.id)})));
 const current=collectBalancePastStats(...args,tables.matches.map(m=>({...m,match_players:tables.match_players.filter(p=>p.match_id===m.id),match_results:tables.match_results.find(r=>r.match_id===m.id)??null})));
 assert(baseline.size>0);assert.deepEqual(current,baseline);
});
