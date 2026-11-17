const {test}=require('node:test'),assert=require('node:assert/strict');
const {avatarGeometry,clampAvatarPosition,moveAvatarPosition,validAvatarPosition,sameAvatarPosition,CENTERED_AVATAR}=require('../lib/profile-media/position.ts');
const {mergePrivateProfile}=require('../lib/profile-media/shared.ts');
const {orderProfileGroups}=require('../lib/profile-group-usage.ts');
test('正規化座標は縦横・大小の円で同じ切抜き位置を再現し、空白を出さない',()=>{
 for(const [w,h] of [[512,256],[256,512],[512,512]])for(const zoom of [1,2,4]){
  const p=clampAvatarPosition(w,h,{x:0,y:1,zoom}),g=avatarGeometry(w,h,p);
  assert(g.width>=1&&g.height>=1);assert(g.x*g.width>=.5);assert((1-g.x)*g.width>=.5);assert(g.y*g.height>=.5);assert((1-g.y)*g.height>=.5);
  const small=moveAvatarPosition(w,h,80,{x:.5,y:.5,zoom},8,-8),large=moveAvatarPosition(w,h,240,{x:.5,y:.5,zoom},24,-24);assert.deepEqual(small,large);
  const edge=moveAvatarPosition(w,h,80,p,1e5,-1e5);assert.deepEqual(edge,p);
 }
 for(const p of [{x:NaN,y:.5,zoom:1},{x:.5,y:Infinity,zoom:1},{x:-1,y:0,zoom:1},{x:.5,y:.5,zoom:0},{x:.5,y:.5,zoom:4.01}])assert.equal(validAvatarPosition(p),false);
 assert(sameAvatarPosition(CENTERED_AVATAR,{x:.5,y:.5,zoom:1}));
});
test('画像・Instagram・位置の応答逆転でも新しい設定を失わず、新画像は中央から開始する',()=>{
 const base={profile_id:'p',owner_id:'u',avatar_key:'a',avatar_version:1,instagram_username:'old',instagram_version:1,avatar_focus_x:.6,avatar_focus_y:.4,avatar_zoom:2,avatar_pose_version:4};
 const ig={...base,instagram_username:'new',instagram_version:2,avatar_pose_version:2,avatar_zoom:1};const merged=mergePrivateProfile(base,ig);assert.equal(merged.avatar_zoom,2);assert.equal(merged.instagram_username,'new');
 assert.equal(mergePrivateProfile(merged,{...base,avatar_pose_version:5,avatar_focus_x:.7}).instagram_username,'new');
 const newer={...base,avatar_key:'b',avatar_version:2,avatar_pose_version:5,avatar_focus_x:.5,avatar_focus_y:.5,avatar_zoom:1};assert.equal(mergePrivateProfile(newer,{...base,avatar_pose_version:99}).avatar_zoom,1);
 const legacy={...base};for(const key of ['avatar_pose_version','avatar_focus_x','avatar_focus_y','avatar_zoom'])delete legacy[key];assert.equal(mergePrivateProfile(base,legacy).avatar_zoom,2);
 assert.equal(mergePrivateProfile(base,{...legacy,avatar_version:2}).avatar_focus_x,.5);
});
test('所属候補だけを件数・最終利用日・安定した名前順に並べ、取得失敗でも一覧を保つ',()=>{
 const groups=[{id:'b',name:'B'},{id:'a',name:'A'},{id:'c',name:'C'}];
 assert.deepEqual(orderProfileGroups(groups,[{club_id:'c',event_count:2,last_used_at:'2026-11-01'},{club_id:'b',event_count:2,last_used_at:'2026-11-02'},{club_id:'foreign',event_count:99,last_used_at:'2026-11-15'}]).map(g=>g.id),['b','c','a']);
 assert.deepEqual(orderProfileGroups(groups,[]).map(g=>g.id),['a','b','c']);assert.equal(groups[0].id,'b');
});
