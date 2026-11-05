const {test}=require('node:test');
const assert=require('node:assert/strict');
const d=require('../lib/match-group-drafts.ts');
const {id}=require('./fixtures/navigation-app.cjs');
function storage(){const map=new Map();return {get length(){return map.size},key:i=>[...map.keys()][i]??null,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),map};}
const ordinary={name:'入力済みの開催名',courtCount:3,eventMode:'manual',selectedGroupId:id(10)};
const team={name:'対抗戦',description:'説明',memo:'メモ',teamAMode:'group',teamBMode:'free',teamAClubId:id(10),teamBClubId:'',teamAName:'独立A',teamBName:'独立B'};
const official={title:'公式タイトル',eventDate:'2026-11-05',description:'説明',memo:'メモ',clubId:id(11)};
const tokenOf=path=>new URL(path,'https://local.invalid').searchParams.get('fromMatch');

test('3形式の全入力をアカウント別に保存し、グループ作成完了時だけ新グループを引き継ぐ',()=>{
 for(const [kind,slot,value]of [['ordinary','group',ordinary],['friendly_team','team_a',team],['official_team','group',official]]){
  const s=storage(),token=tokenOf(d.startGroupCreation(s,id(1),kind,slot,value));
  assert.equal(d.readGroupCreation(s,id(1),token).status,'pending');
  const back=d.finishGroupCreation(s,id(1),token,id(100));assert(back.startsWith(kind==='ordinary'?'/events/new?':kind==='friendly_team'?'/team-matches/new?':'/official-matches/new?'));
  const restored=d.takeMatchDraft(s,id(1),kind,token);assert.deepEqual(restored.values,value);assert.equal(restored.status,'created');assert.equal(restored.groupId,id(100));assert.equal(restored.slot,slot);assert.equal(s.length,0);
 }
});
test('キャンセルとブラウザバックは元のグループを保持し、復元後に保存データを削除する',()=>{
 for(const explicit of [false,true]){
  const s=storage(),token=tokenOf(d.startGroupCreation(s,id(1),'ordinary','group',ordinary));
  if(explicit)d.finishGroupCreation(s,id(1),token,null);
  const restored=d.takeMatchDraft(s,id(1),'ordinary',explicit?token:null);
  assert.deepEqual(restored.values,ordinary);assert.equal(restored.groupId,null);assert.equal(s.length,0);
 }
});
test('チームA/Bの対象を独立して保存し、他方の入力を変更しない',()=>{
 for(const slot of ['team_a','team_b']){const s=storage(),token=tokenOf(d.startGroupCreation(s,id(1),'friendly_team',slot,team));d.finishGroupCreation(s,id(1),token,id(99));const result=d.takeMatchDraft(s,id(1),'friendly_team',token);assert.equal(result.slot,slot);assert.deepEqual(result.values,team);}
});
test('別アカウント・別形式・不正トークンから下書きを取り出せない',()=>{
 const s=storage(),token=tokenOf(d.startGroupCreation(s,id(1),'ordinary','group',ordinary));
 assert.equal(d.readGroupCreation(s,id(2),token),null);assert.equal(d.takeMatchDraft(s,id(2),'ordinary',token),null);assert.equal(d.finishGroupCreation(s,id(2),token,id(99)),null);
 assert.equal(d.takeMatchDraft(s,id(1),'official_team',token),null);assert.equal(d.readGroupCreation(s,id(1),'https://evil.invalid'),null);
 assert.deepEqual(d.takeMatchDraft(s,id(1),'ordinary',token).values,ordinary);
});
test('戻り先・フォーム値・期限を改ざんした復帰情報を拒否し、外部URLへ戻さない',()=>{
 for(const patch of [{kind:'https://evil.invalid'},{kind:'__proto__'},{slot:'https://evil.invalid'},{owner:id(2)},{values:{...ordinary,eventMode:'injected'}},{status:'created',groupId:'//evil.invalid'},{expiresAt:Date.now()-1}]){
  const s=storage(),token=tokenOf(d.startGroupCreation(s,id(1),'ordinary','group',ordinary)),key=[...s.map.keys()].find(key=>key.endsWith(token));
  s.setItem(key,JSON.stringify({...JSON.parse(s.getItem(key)),...patch}));assert.equal(d.readGroupCreation(s,id(1),token),null);assert.equal(d.finishGroupCreation(s,id(1),token,id(99)),null);
 }
 const s=storage(),token=tokenOf(d.startGroupCreation(s,id(1),'ordinary','group',{...ordinary,returnUrl:'https://evil.invalid'}));
 assert.equal(d.finishGroupCreation(s,id(1),token,id(99)),`/events/new?groupReturn=${token}`);assert(!Object.hasOwn(d.takeMatchDraft(s,id(1),'ordinary',token).values,'returnUrl'));
});
test('保存失敗・容量超過は移動用URLを返さず、入力内容を切り詰めない',()=>{
 const s=storage();s.setItem=()=>{throw Error('保存不可')};assert.throws(()=>d.startGroupCreation(s,id(1),'ordinary','group',ordinary));
 assert.throws(()=>d.startGroupCreation(storage(),id(1),'ordinary','group',{...ordinary,name:'あ'.repeat(300000)}),/大きい/);
});
test('グループ作成の二重完了・取消で保持先を勝手に変えない',()=>{
 const s=storage(),token=tokenOf(d.startGroupCreation(s,id(1),'ordinary','group',ordinary));d.finishGroupCreation(s,id(1),token,id(99));d.finishGroupCreation(s,id(1),token,id(100));d.finishGroupCreation(s,id(1),token,null);assert.equal(d.takeMatchDraft(s,id(1),'ordinary',token).groupId,id(99));
});
test('ゲストの作成途中データを別領域で保持し、明示消去・期限切れを扱う',()=>{
 const s=storage();d.saveGuestCreationDraft(s,ordinary);const before=s.getItem([...s.map.keys()][0]);assert.deepEqual(d.readGuestCreationDraft(s),ordinary);
 const token=tokenOf(d.startGroupCreation(s,id(1),'official_team','group',official));assert.equal(s.getItem('padel_match_group_draft_v1:guest:ordinary'),before);
 d.discardMatchDraft(s,id(1),'official_team');assert.equal(d.readGroupCreation(s,id(1),token),null);assert.deepEqual(d.readGuestCreationDraft(s),ordinary);
 d.discardGuestCreationDraft(s);assert.equal(s.length,0);
 d.saveGuestCreationDraft(s,ordinary);d.cleanExpiredMatchDrafts(s,Date.now()+3*60*60*1000);assert.equal(d.readGuestCreationDraft(s),null);
});
test('一覧フィルターはユーザー別で、閲覧できないグループに戻さない',()=>{
 const s=storage();d.saveMatchGroupFilter(s,id(1),id(10));assert.equal(d.readMatchGroupFilter(s,id(1),[id(10)]),id(10));assert.equal(d.readMatchGroupFilter(s,id(2),[id(10)]),'all');assert.equal(d.readMatchGroupFilter(s,id(1),[]),'all');
 for(const value of ['all','none']){d.saveMatchGroupFilter(s,id(1),value);assert.equal(d.readMatchGroupFilter(s,id(1),[]),value);}
});

test('期限切れの認証済み下書きと参照キーをまとめて破棄する',()=>{
 const s=storage();d.startGroupCreation(s,id(1),'ordinary','group',ordinary);d.cleanExpiredMatchDrafts(s,Date.now()+3*60*60*1000);assert.equal(s.length,0);
});
