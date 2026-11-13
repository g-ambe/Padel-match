const {test}=require('node:test'),assert=require('node:assert/strict');
const {groupResultRanking,compactRankingGroups,rankingValue}=require('../lib/result-ranking.ts');
const row=(name,wins=0,winRate=0,diff=0)=>({name,wins,winRate,diff,losses:0,draws:0,scored:0,conceded:0});
test('同率は一行にまとめ、既存の同値内順を保持し、次の順位は人数分進める',()=>{
 const groups=groupResultRanking([row('A',5),row('B',4),row('C',4),row('D',4),row('E',0)],'wins');
 assert.deepEqual(groups.map(g=>[g.rank,g.value,g.rows.map(r=>r.name)]),[[1,5,['A']],[2,4,['B','C','D']],[5,0,['E']]]);
 assert.deepEqual(compactRankingGroups(groups),groups);
});
test('空・一人・全員0勝同率・二段階・多数のケースでコンパクト表示に同じグループを重複しない',()=>{
 for(const rows of [[],[row('A')],[row('A'),row('B')],[row('A',1),row('B',0)]]){
  const groups=groupResultRanking(rows,'wins'),compact=compactRankingGroups(groups);assert.equal(new Set(compact).size,compact.length);assert.equal(compact.length,groups.length);
 }
 const groups=groupResultRanking([row('A',3),row('B',2),row('C',1),row('D',0)],'wins');assert.deepEqual(compactRankingGroups(groups).map(g=>g.rank),[1,2,4]);
});
test('勝率・負の得失G差を同率化し、0勝も除去しない',()=>{
 assert.equal(groupResultRanking([row('A',0,0,-2),row('B',0,0,-2)],'winRate').length,1);
 assert.equal(groupResultRanking([row('A',0,0,-2),row('B',0,0,-2)],'diff').length,1);
 assert.equal(rankingValue('wins',0),'0勝');assert.equal(rankingValue('winRate',66.7),'66.7%');assert.equal(rankingValue('diff',-2),'-2');
});
