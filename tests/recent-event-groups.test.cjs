const {test}=require('node:test'),assert=require('node:assert/strict');
const {recentFirstGroups,recentEventGroups}=require('../lib/recent-event-groups.ts');
test('最近のイベント順に既存候補だけを並べ、重複・不明グループで候補や権限を増やさない',()=>{
 const groups=[{id:'a'},{id:'b'},{id:'c'},{id:'d'}];
 assert.deepEqual(recentFirstGroups(groups,['unknown',null,'c','b','c']).map(g=>g.id),['c','b','a','d']);
 assert.deepEqual(groups.map(g=>g.id),['a','b','c','d']);
});
test('履歴取得失敗は既存グループの選択を妨げず、空候補では問い合わせない',async()=>{
 const groups=[{id:'a'}];assert.deepEqual(await recentEventGroups({from(){throw Error('offline');}},groups),groups);
 assert.deepEqual(await recentEventGroups({from(){throw Error('must not call');}},[]),[]);
});
