const {test}=require('node:test'),assert=require('node:assert/strict');
require('node:module').registerHooks({resolve(s,c,next){return next(s==='./profile-options'&&c.parentURL?.endsWith('/padel-facilities.ts')?'./profile-options.ts':s,c);}});
const {FACILITY_REGIONS,filterFacilities,facilityPrefecture,facilityDisplayName,PROFILE_GROUP_ACTIONS}=require('../lib/padel-facilities.ts');
const {PREFECTURES}=require('../lib/profile-options.ts');
const {mergePrivateProfile}=require('../lib/profile-media/shared.ts');
test('地域は47都道府県を重複なく含み、既存の都道府県表記も検索できる',()=>{
 assert.deepEqual(Object.values(FACILITY_REGIONS).flat().sort(),[...PREFECTURES].sort());
 assert.equal(facilityPrefecture('東京'),'東京都');assert.equal(facilityPrefecture('北海道'),'北海道');
 const rows=[{id:'a',name:'コートＡ',prefecture:'東京',aliases:['旧コート']},{id:'b',name:'大阪のコート',prefecture:'大阪府'},{id:'c',name:'閉業コート',prefecture:'東京',availability:'closed'}];
 assert.deepEqual(filterFacilities(rows,'region:関東','').map(f=>f.id),['a']);
 assert.deepEqual(filterFacilities(rows,'pref:東京都','コートa').map(f=>f.id),['a']);
 assert.deepEqual(filterFacilities(rows,'','旧 コート').map(f=>f.id),['a']);
 assert.deepEqual(filterFacilities(rows,'pref:大阪府','コートa'),[]);
 assert.equal(rows[0].prefecture,'東京');assert.equal(rows.length,3);
});
test('施設名は選択IDに対応するマスターを優先し、既存自由入力は保持する',()=>{
 const p={home_facility_id:'a',home_facility:{id:'a',name:'改称後の施設'},home_court_name:'登録時の施設'};
 assert.equal(facilityDisplayName(p),'改称後の施設');
 assert.equal(facilityDisplayName({...p,home_facility:{id:'b',name:'別施設'}}),'登録時の施設');
 assert.equal(facilityDisplayName({home_court_name:'  以前の自由入力  '}),'  以前の自由入力  ');
 assert.equal(facilityDisplayName({}), '');
});
test('応答逆転・他項目更新でも施設IDと表示名が旧状態に戻らず、解除時は残らない',()=>{
 const current={profile_id:'p',owner_id:'u',avatar_version:1,instagram_version:1,home_court_version:3,home_court_name:'施設A',home_facility_id:'a',home_facility:{id:'a',name:'改称後A'}};
 let m=mergePrivateProfile(current,{...current,home_court_version:2,home_facility_id:'b',home_facility:{id:'b',name:'旧B'}});
 assert.equal(m.home_facility_id,'a');assert.equal(facilityDisplayName(m),'改称後A');
 const {home_facility_id,home_facility,...oldResponse}=current;
 m=mergePrivateProfile(current,{...oldResponse,instagram_version:2});assert.equal(m.home_facility_id,'a');assert.equal(facilityDisplayName(m),'改称後A');
 m=mergePrivateProfile(current,{...current,home_court_version:4,home_facility_id:'b'});assert.equal(m.home_facility,undefined);assert.equal(m.home_facility_id,'b');
 m=mergePrivateProfile(current,{...current,home_court_version:4,home_facility_id:null,home_court_name:null});assert.equal(m.home_facility,null);assert.equal(facilityDisplayName(m),'');
});
test('所属グループの補助操作は探す・新規作成の既存URLだけ',()=>{
 assert.deepEqual(PROFILE_GROUP_ACTIONS.map(({href,label})=>({href,label})),[{href:'/groups/discover',label:'グループを探す'},{href:'/groups/new',label:'グループ新規作成'}]);
});
