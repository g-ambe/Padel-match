const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const {loadOrdinaryMatches,loadFriendlyTeamMatches,loadOfficialTeamMatches,matchTopEntries}=require('../lib/match-top.ts');
const {loadFriendlyEventAccess}=require('../lib/friendly-event-access.ts');
const {appSection,isGuestAppPath}=require('../lib/app-navigation.ts');

// Supabase SDKで送信先・フィルター・ページングを確認する。通信はこのモック内で完結する。
function mock(tables,{fail}={}) {
 const calls=[];
 const s=createClient('https://match-top.invalid','public-test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url),table=url.pathname.split('/').at(-1),method=init.method??'GET';
  calls.push({table,method,url});assert.equal(method,'GET','一覧取得でデータを書き換えない');
  if(fail?.(table,url))return new Response(JSON.stringify({message:'取得失敗',code:'42501'}),{status:403});
  let rows=[...(tables[table]??[])];
  for(const [key,value] of url.searchParams){
   if(['select','limit','offset','order'].includes(key))continue;
   if(key==='or'){
    const clubs=value.match(/club_id\.in\.\(([^)]+)\)/)?.[1]?.split(',')??[];
    const uid=value.match(/created_by_auth_user_id\.eq\.([^,)]+)/)?.[1];
    rows=rows.filter(row=>clubs.includes(row.club_id)||(row.club_id===null&&row.created_by_auth_user_id===uid));
   }else if(value.startsWith('eq.'))rows=rows.filter(row=>String(row[key])===value.slice(3));
   else if(value==='is.null')rows=rows.filter(row=>row[key]===null);
   else if(value.startsWith('in.(')){const ids=value.slice(4,-1).split(',');rows=rows.filter(row=>ids.includes(String(row[key])));}
  }
  const start=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??1000);
  rows=rows.slice(start,start+limit);
  if((init.headers?.Accept??init.headers?.accept??'').includes('vnd.pgrst.object+json'))return new Response(JSON.stringify(rows[0]??null),{status:200});
  return new Response(JSON.stringify(rows),{status:200,headers:{'Content-Type':'application/json'}});
 }}});
 s.auth.getUser=async()=>({data:{user:{id:'user'}},error:null});
 return {s,calls};
}
const access={uid:'user',superUser:false,groups:[{id:'A',name:'グループA'}]};
const event=(id,patch={})=>({id,name:id,title:id,club_id:'A',created_by_auth_user_id:'user',event_mode:'auto',status:'active',is_deleted:false,created_at:'2026-11-05T00:00:00Z',...patch});

test('通常の最新500件より前にある開催中もページングで取得し、削除・別形式・他人のグループなしを除く',async()=>{
 const events=Array.from({length:502},(_,i)=>event('event-'+i,{status:i===501?'active':'closed'}));
 events.push(event('deleted',{is_deleted:true}),event('team',{event_mode:'team'}),event('foreign',{club_id:null,created_by_auth_user_id:'other'}));
 const {s,calls}=mock({events});const rows=await loadOrdinaryMatches(s,access);
 assert.equal(rows.length,502);assert.equal(matchTopEntries(rows,'all','all').active[0].id,'event-501');
 assert.equal(calls.length,2);assert.equal(calls[1].url.searchParams.get('offset'),'500');
 assert.equal(rows.find(row=>row.id==='event-501').href,'/events/event-501');
});

test('チーム戦はA/B所属のどちらからも表示し、未所属の第三グループと他人のグループなしを含めない',async()=>{
 const events=[event('cross',{event_mode:'team',club_id:'B'}),event('none',{event_mode:'team',club_id:null}),event('foreign',{event_mode:'team',club_id:null,created_by_auth_user_id:'other'}),event('hidden',{event_mode:'team',club_id:'C'})];
 const event_team_sides=[{id:'1',event_id:'cross',side:'team_a',club_id:'B',team_name:'B側'},{id:'2',event_id:'cross',side:'team_b',club_id:'A',team_name:'A側'},{id:'3',event_id:'hidden',side:'team_a',club_id:'C',team_name:'C側'}];
 const {s}=mock({events,event_team_sides});const rows=await loadFriendlyTeamMatches(s,access);
 assert.deepEqual(rows.map(row=>row.id),['cross','none']);assert.equal(rows[0].href,'/team-matches/cross');
 assert.equal(matchTopEntries(rows,'A','all').active[0].id,'cross');assert.equal(matchTopEntries(rows,'B','all').active[0].id,'cross');
 assert.equal(matchTopEntries(rows,'none','all').active[0].id,'none');
});

test('公式は専用テーブルの既存所属範囲を使い、通常と同じIDも別形式として保持する',async()=>{
 const {s}=mock({official_events:[event('same',{status:'closed'}),event('own',{club_id:null,status:'closed'}),event('other',{club_id:'B'})]});
 const official=await loadOfficialTeamMatches(s,access);assert.deepEqual(official.map(row=>row.id),['same','own']);
 const ordinary={...official[0],kind:'ordinary',href:'/events/same'};
 const result=matchTopEntries([...official,ordinary,ordinary],'all','all');assert.equal(result.past.length,3);
 assert.equal(matchTopEntries([...official,ordinary],'all','official').past.length,2);
 assert.equal(matchTopEntries([...official,ordinary],'all','friendly').past.length,1);
 assert.equal(official[0].href,'/official-matches/same');
});

test('グループ未所属は本人作成分だけ、super_userは既存の全件取得範囲を維持する',async()=>{
 const {s}=mock({events:[event('group'),event('own',{club_id:null}),event('other',{club_id:null,created_by_auth_user_id:'other'})]});
 assert.deepEqual((await loadOrdinaryMatches(s,{...access,groups:[]})).map(row=>row.id),['own']);
 assert.equal((await loadOrdinaryMatches(s,{...access,superUser:true,groups:[]})).length,3);
});

test('ページ途中・チーム所属情報・公式の取得エラーを空一覧に置き換えない',async()=>{
 const ordinary=mock({events:Array.from({length:501},(_,i)=>event(String(i)))},{fail:(table,url)=>url.searchParams.get('offset')==='500'});
 await assert.rejects(loadOrdinaryMatches(ordinary.s,access),/取得/);
 const team=mock({events:[event('team',{event_mode:'team'})]},{fail:table=>table==='event_team_sides'});
 await assert.rejects(loadFriendlyTeamMatches(team.s,access),/取得/);
 const official=mock({},{fail:table=>table==='official_events'});await assert.rejects(loadOfficialTeamMatches(official.s,access),/取得/);
});

test('通常作成の所属取得は一般メンバーと旧profile_idフォールバックを維持する',async()=>{
 const tables={app_admins:[],player_profiles:[],club_members:[{club_id:'A',profile_id:'user',is_active:true,status:'active'}],clubs:[{id:'A',name:'グループA',is_active:true,is_deleted:false}]};
 const {s,calls}=mock(tables);const result=await loadFriendlyEventAccess(s);assert.equal(result.superUser,false);assert.equal(result.groups[0].id,'A');
 assert(calls.some(call=>call.url.searchParams.get('profile_id')==='eq.user'));
});

test('下部バーは3分類に限定し、認証・公開共有・規約ページを除く。ゲスト通常移動の経路も区別する',()=>{
 for(const path of ['/home','/events/new','/events/abc','/team-matches/abc','/official-matches/new'])assert.equal(appSection(path),'matches');
 assert.equal(appSection('/ranking'),'ranking');assert.equal(appSection('/profile'),'my');assert.equal(appSection('/groups/A'),'my');
 for(const path of ['/','/login','/signup/check-email','/share/events/token','/share/official-events/token','/terms','/privacy'])assert.equal(appSection(path),null);
 assert.equal(isGuestAppPath('/events/guest_test'),true);assert.equal(isGuestAppPath('/matches/new'),true);assert.equal(isGuestAppPath('/events/real'),false);
});

test('所属IDがある名称未取得の開催をグループなしと誤表示しない',async()=>{
 const {s}=mock({events:[event('unknown')],official_events:[event('official')]});
 const superAccess={...access,superUser:true,groups:[]};
 assert.equal((await loadOrdinaryMatches(s,superAccess))[0].groupLabel,'名称未設定');
 assert.equal((await loadOfficialTeamMatches(s,superAccess))[0].groupLabel,'名称未設定');
});
