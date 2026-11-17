const {test}=require('node:test'),assert=require('node:assert/strict');
const {PREFECTURES,BROAD_ACTIVITY_AREAS,legacyActivityArea,homeCourtName,profileGroupPreview}=require('../lib/profile-options.ts');
const {mergePrivateProfile}=require('../lib/profile-media/shared.ts');
test('活動エリアは47都道府県と広域の単一候補、従来の文字列は無変換で保持',()=>{
 assert.equal(PREFECTURES.length,47);assert.equal(new Set(PREFECTURES).size,47);assert(PREFECTURES.includes('北海道'));assert(PREFECTURES.includes('沖縄県'));assert(BROAD_ACTIVITY_AREAS.includes('関東'));
 for(const v of ['',...PREFECTURES,...BROAD_ACTIVITY_AREAS])assert.equal(legacyActivityArea(v),null);
 for(const v of ['東京・埼玉','中国地方',' 関東近郊 '])assert.equal(legacyActivityArea(v),v);
});
test('所属上位3件と全件は同じ利用頻度順、0〜3件では全件ボタン不要',()=>{
 for(let n=0;n<=5;n++){const sorted=Array.from({length:n},(_,i)=>({id:'g'+i})),copy=structuredClone(sorted),p=profileGroupPreview(sorted);assert.deepEqual(p.visible,sorted.slice(0,3));assert.deepEqual(p.all,sorted);assert.equal(p.hasMore,n>3);assert.deepEqual(sorted,copy);}
});
test('ホームコート名は任意・最大80文字、制御文字を拒否し任意HTMLも文字として扱う',()=>{
 assert.equal(homeCourtName('  コートA  '),'コートA');assert.equal(homeCourtName(' '),null);assert.equal(homeCourtName('あ'.repeat(80)).length,80);assert.throws(()=>homeCourtName('あ'.repeat(81)));assert.throws(()=>homeCourtName('コート\nA'));assert.throws(()=>homeCourtName('a\u0000b'));assert.equal(homeCourtName('<court>'),'<court>');
});
test('ホームコート・写真・Instagramの応答順が逆転しても各最新版と所有者分離を維持',()=>{
 const old={profile_id:'p',owner_id:'u',instagram_username:'old',instagram_version:1,avatar_key:'a',avatar_version:1,home_court_name:'court1',home_court_version:1};
 const current={...old,home_court_name:'court2',home_court_version:2};let m=mergePrivateProfile(current,{...old,instagram_username:'new',instagram_version:2});assert.equal(m.home_court_name,'court2');assert.equal(m.instagram_username,'new');
 m=mergePrivateProfile(m,{...old,avatar_version:2,avatar_key:'b'});assert.equal(m.home_court_name,'court2');assert.equal(m.instagram_username,'new');assert.equal(m.avatar_key,'b');
 assert.equal(mergePrivateProfile(m,{...old,owner_id:'other',home_court_name:null}).home_court_name,null);
});
