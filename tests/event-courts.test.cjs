const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validCourtCount,readEventCourts,saveEventCourts}=require('../lib/event-courts.ts');
const {handler,database,fixture}=require('./fixtures/stats-helpers.cjs');

test('利用コート数は1〜5の整数だけを保存し、過去の試合・得点には書き込まない',async()=>{
 const f=fixture();Object.assign(f.tables.events[0],{court_count:2,event_mode:'auto',status:'active',is_deleted:false});const db=database(f.tables);
 const history=structuredClone({matches:f.tables.matches,players:f.tables.match_players,results:f.tables.match_results});
 for(const count of [1,2,3,4,5]){
  const previous=f.tables.events[0].court_count;assert.equal(await saveEventCourts(db.s,'event-a',previous,count),count);
  assert.equal((await readEventCourts(db.s,'event-a')).court_count,count);
 }
 assert.deepEqual({matches:f.tables.matches,players:f.tables.match_players,results:f.tables.match_results},history);
 assert(db.calls.filter(c=>c.method==='PATCH').every(c=>c.table==='events'&&Object.keys(c.body).join(',')==='court_count'));
 for(const count of [0,6,-1,1.5,NaN,Infinity]){assert.equal(validCourtCount(count),false);const before=db.calls.length;await assert.rejects(saveEventCourts(db.s,'event-a',5,count),/1〜5/);assert.equal(db.calls.length,before);}
});

test('RLS拒否・0行更新・他端末の変更・終了済み・手動イベントを成功扱いしない',async()=>{
 for(const patch of [{},{court_count:1},{status:'closed'},{event_mode:'manual'},{is_deleted:true}]){
  const event={id:'event',court_count:2,event_mode:'auto',status:'active',is_deleted:false,...patch};
  const db=database({events:[event]},{fail:c=>Object.keys(patch).length===0&&c.method==='PATCH'});
  await assert.rejects(saveEventCourts(db.s,'event',2,3),/保存できません|変更されています/);
  assert.equal(event.court_count,patch.court_count??2);
 }
 const db=database({events:[]});await assert.rejects(readEventCourts(db.s,'missing'),/取得できません/);
});

test('権限なし・終了済みでは保存を送信せず、生成・終了処理中も設定変更を止める',async()=>{
 for(const extra of [{canManageEventName:false},{eventStatus:'closed'},{eventMode:'manual'},{boardOperation:{current:'round'}},{closingEvent:{current:true}}]){
  const db=database({}),errors=[];
  await handler('app/events/[id]/page.tsx','saveCourtCount',{boardOperation:{current:null},closingEvent:{current:false},isGeneratingRound:false,courtReady:true,canManageEventName:true,eventStatus:'active',eventMode:'auto',guestMode:false,courtDraft:1,setCourtError:v=>errors.push(v),getSupabaseClient:()=>db.s,...extra})();
  assert.equal(db.calls.length,0);
 }
});

test('コート保存中は生成・終了・削除を送信せず、同じ削除確認の二重送信を防ぐ',async()=>{
 const db=database({}),operation={current:'court'};
 for(const name of ['generateRound','closeEvent','confirmMatchDelete']){
  await handler('app/events/[id]/page.tsx',name,{boardOperation:operation,isGeneratingRound:false,closingEvent:{current:false},getSupabaseClient:()=>db.s,setError:()=>{}})();assert.equal(db.calls.length,0);
 }
 let release,calls=0;const gate=new Promise(resolve=>release=resolve),binding={boardOperation:{current:null},closingEvent:{current:false},setIsDeletingMatch:()=>{},setError:()=>{},deleteMatch:async()=>{calls++;await gate;}};
 const first=handler('app/events/[id]/page.tsx','confirmMatchDelete',binding)();await handler('app/events/[id]/page.tsx','confirmMatchDelete',binding)();assert.equal(calls,1);release();await first;assert.equal(binding.boardOperation.current,null);
});

test('コート変更に使う既存の画面権限は作成者・有効な主副管理者・super_userに限定される',async()=>{
 const uid='auth-user',profile='canonical-player';
 const cases=[
  {name:'未ログイン',user:null,club:null,creator:null,allowed:false},
  {name:'グループなしの作成者',club:null,creator:uid,allowed:true},
  {name:'グループなしの他人',club:null,creator:'other',allowed:false},
  ...['main_admin','sub_admin','member'].map(role=>({name:`選手IDが認証IDと異なる${role}`,role,allowed:role!=='member'})),
  {name:'グループの作成者だが一般メンバー',role:'member',creator:uid,allowed:false},
  {name:'退会済み管理者',role:'main_admin',active:false,allowed:false},
  {name:'他グループの管理者',role:'main_admin',memberClub:'other-club',allowed:false},
  ...['main_admin','sub_admin'].map(role=>({name:`旧profile_idの${role}`,role,legacy:true,allowed:true})),
  {name:'有効なsuper_user',admin:true,allowed:true},
  {name:'無効なsuper_user',admin:false,allowed:false},
  {name:'所属の取得エラー',role:'main_admin',failMembership:true,allowed:false}
 ];
 for(const item of cases){
  const event={id:'event',name:'権限検証',court_count:2,event_mode:'auto',status:'active',is_deleted:false,club_id:item.club===null?null:'club',created_by_auth_user_id:item.creator??'other'};
  const db=database({events:[event],player_profiles:[{id:profile,linked_auth_user_id:uid}],club_members:item.role?[{club_id:item.memberClub??'club',role:item.role,is_active:item.active!==false,...(item.legacy?{profile_id:uid}:{player_profile_id:profile})}]:[],app_admins:typeof item.admin==='boolean'?[{id:'admin',profile_id:uid,is_active:item.admin}]:[]},{fail:c=>item.failMembership&&c.table==='club_members'});
  db.s.auth.getUser=async()=>({data:{user:item.user===null?null:{id:uid}},error:null});
  const stop=new Error('権限判定まで検証し、参加者の自動反映は実行しない');let allowed;
  const setters=Object.fromEntries(['setGuestMode','setIsDeletedEvent','setEventName','setCourtCount','setEventStatus','setShareEnabled','setShareToken','setEventClubId','setEventMode','setStatsMode','setRoundUserId','setCanDeleteEvent','setCanViewVideoClickCounts','setCanManageShare','setCanManageEventVideos'].map(name=>[name,()=>{}]));
  const load=handler('app/events/[id]/page.tsx','loadAll',{...setters,eventId:'event',getSupabaseClient:()=>db.s,scoreQueue:{getRevision:()=>0},setCanManageEventName:value=>allowed=value,setCanCopyShare:()=>{throw stop;}});
  await assert.rejects(load(),error=>error===stop,item.name);
  assert.equal(allowed,item.allowed,item.name);
  assert(db.calls.every(c=>c.method==='GET'),item.name);
 }
});
