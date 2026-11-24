const {test}=require('node:test'),assert=require('node:assert/strict');
const {groupTabs,groupPreview,activeGroupMembership,readGroupEvents}=require('../lib/group-detail.ts');
const {readGroupOrigin,saveGroupOrigin,safeGroupReturn,readGroupEventReturn}=require('../lib/group-detail-navigation.ts');
test('所属確認はgroup/is_active/statusを全て確認し、公開閲覧では概要とメンバーだけ',()=>{
 const rows=[{club_id:'A',is_active:true,status:'inactive'},{club_id:'B',is_active:true,status:'active'}];assert.equal(activeGroupMembership(rows,'A'),undefined);
 rows.push({club_id:'A',is_active:true,status:'active'});assert.equal(activeGroupMembership(rows,'A'),rows[2]);assert.deepEqual(groupTabs(false),['概要','メンバー']);assert.deepEqual(groupTabs(true),['概要','メンバー','戦績']);
});
test('上位/直近3件は既存の順位順を並べ替えず、元配列を変更しない',()=>{
 const rows=[4,2,3,1];assert.deepEqual(groupPreview(rows),{visible:[4,2,3],hasMore:true});assert.deepEqual(rows,[4,2,3,1]);assert.equal(groupPreview([]).hasMore,false);
});
test('公開閲覧の開催取得は内部テーブルを一度も呼ばない',async()=>{
 assert.deepEqual(await readGroupEvents({from(){throw Error('private fetch')}},'A',false),[]);
});
test('所属者の開催取得は最小列/対象グループ/削除除外でページングし、形式ごとの遷移を維持',async()=>{
 const calls=[],data={events:[{id:'e',name:'自動',created_at:'2026-11-01',status:'closed',event_mode:'auto'},{id:'t',name:'チーム',created_at:'2026-11-03',status:'active',event_mode:'team'}],official_events:[{id:'o',title:'公式',created_at:'2026-11-02',status:'active'}]};
 const db={from(table){const q={select(v){calls.push([table,'select',v]);return q},eq(k,v){calls.push([table,k,v]);return q},order(){return q},range(a,b){calls.push([table,'range',a,b]);return Promise.resolve({data:data[table]})}};return q}};
 const r=await readGroupEvents(db,'A',true);assert.deepEqual(r.map(e=>e.href),['/team-matches/t','/official-matches/o','/events/e']);
 for(const table of ['events','official_events']){assert(calls.some(c=>c[0]===table&&c[1]==='club_id'&&c[2]==='A'));assert(calls.some(c=>c[0]===table&&c[1]==='is_deleted'&&c[2]===false));}
 assert(calls.every(c=>!String(c[2]).includes('match_results')));
 const failing={from(){return{select(){return this},eq(){return this},order(){return this},range(){return Promise.resolve({data:null,error:{}})}}}};await assert.rejects(readGroupEvents(failing,'A',true));
});
test('戻り先は本人の許可済み画面だけ。外部URL/別アカウント/不正storageを拒否',()=>{
 const map=new Map(),s={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)},r={account:'self',path:'/profile',y:900,expanded:true,inside:70};saveGroupOrigin(s,'token',r);assert.deepEqual(readGroupOrigin(s,'token','self'),r);assert.equal(readGroupOrigin(s,'token','other'),null);assert.equal(safeGroupReturn('https://evil.invalid'),'/profile#profile-groups');assert.equal(safeGroupReturn('__proto__'),'/profile#profile-groups');assert.equal(safeGroupReturn('discover'),'/groups/discover');
 saveGroupOrigin(s,'bad',{...r,path:'https://evil.invalid'});assert.equal(readGroupOrigin(s,'bad','self'),null);map.set('padel_group_origin_v1:bad','{');assert.equal(readGroupOrigin(s,'bad','self'),null);
});
test('開催の戻り情報は本人/既存イベントURL/グループURLを照合し、計算値や秘密情報を保存しない',()=>{
 const r={account:'self',group:'/groups/club?from=profile',path:'/events/event',tab:'戦績',stat:'個人',mode:'総合ランキング',popups:[{kind:'allStats'}],y:90,inside:20},s={getItem:()=>JSON.stringify(r)};assert.deepEqual(readGroupEventReturn(s,'token','self'),r);assert.equal(readGroupEventReturn(s,'token','other'),null);assert.equal(readGroupEventReturn({getItem:()=>JSON.stringify({...r,group:'//evil.invalid'})},'token','self'),null);
});
