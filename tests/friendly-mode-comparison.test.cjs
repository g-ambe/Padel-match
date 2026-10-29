const {test}=require('node:test');
const assert=require('node:assert/strict');
const fixture=require('./fixtures/friendly-mode-event-261029.json');
const {compareModes}=require('../scripts/analyze-friendly-modes.cjs');
const {generateFriendlyRound,seededRandom}=require('./fixtures/friendly-round-helpers.cjs');

test('18試合の匿名化履歴を固定シードで比較し、休憩・連続ペア回避・モード評価を維持する',()=>{
 const before=JSON.stringify(fixture),report=compareModes(fixture,Array.from({length:16},(_,i)=>i+1));
 assert(report.sameResters);assert.equal(report.seeds,16);assert.equal(JSON.stringify(fixture),before);
 for(const [mode,rows] of Object.entries(report.outputs))for(const row of rows){
  assert.equal(row.metrics.consecutivePairs,row.diagnostics.minConsecutive);
  if(mode!=='balance')assert(row.metrics.pairPenalty<=row.diagnostics.minPair+400);
  assert.equal(row.metrics.selectedModePenalty,mode==='normal'?0:row.metrics[mode==='balance'?'balancePenalty':'rivalPenalty']);
  const playing=row.matches.flatMap(m=>[...m.teamA,...m.teamB]);assert.equal(new Set(playing).size,8);assert.equal(row.resters.length,2);
 }
 assert(report.changedMatchups.rival>0);assert.equal(report.changedPairs.rival,0);
 assert(report.summaries.rival.topOpposed>report.summaries.normal.topOpposed);
});

test('同じ10人・同じ履歴のコート数変更でも全モードで人数上限と重複回避を守り、入力設定を書き換えない',()=>{
 for(const courtCount of [1,2,3,4,5])for(const mode of ['normal','balance','rival']){
  const params={...fixture,knownParticipantIds:new Set(fixture.knownParticipantIds),courtCount,mode,random:seededRandom(29)};
  const result=generateFriendlyRound(params),expected=Math.min(courtCount,2),players=result.matches.flatMap(m=>[...m.teamA,...m.teamB]);
  assert.equal(result.matches.length,expected);assert.equal(new Set(players).size,expected*4);assert.equal(result.resters.length,10-expected*4);
  assert.deepEqual(result.matches.map(m=>m.court).sort((a,b)=>a-b),Array.from({length:expected},(_,i)=>i+1));
  assert.equal(params.courtCount,courtCount);assert(Number.isFinite(result.modePenalty));
 }
});
