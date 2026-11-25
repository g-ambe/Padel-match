// 合成Auth/RESTによるローカルUI試験。実DB/RLS/施設マスターへ書き込まない。
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {navigationFixture,user,player,clubA,id}=require('../fixtures/navigation-app.cjs');
const base=process.env.HOME_COURT_TEST_URL||'http://127.0.0.1:3070',remote='http://127.0.0.1:54321';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname));
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const theme of ['dark','light']){
  const f=navigationFixture(),errors=[],outside=[],writes=[];
  f.tables.club_members[0].role='main_admin';f.tables.clubs[0].main_facility_id=id(1500);
  Object.assign(f.tables.user_preferences[0],{theme_mode:theme,tutorial_status:'completed'});
  Object.assign(f.tables.player_profiles[0],{bio:'既存紹介',play_level:'中級',dominant_hand:'右',preferred_position:'フォア',activity_area:'東京都'});
  const long='非常に長い施設名でも正しく都道府県別に表示するパデルコート';
  f.tables.padel_facilities=[{id:id(1500),name:'既存施設',prefecture:'埼玉県',availability:'open'},{id:id(1501),name:long,prefecture:'東京都',availability:'unverified',usage_note:'利用可否は要確認',address:'表示しない住所'},{id:id(1502),name:'閉業済み施設',prefecture:'大阪府',availability:'closed'}];
  let failFacilities=false,failSave=false,role='main_admin';
  let meta={profile_id:player,owner_id:user.id,instagram_username:null,instagram_version:0,avatar_key:null,avatar_version:0,home_facility_id:null,home_court_name:'以前の未掲載コート',home_court_version:2};
  const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,colorScheme:theme});
  await c.addInitScript(({base,user})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{base,user});
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};
  await c.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),method=req.method(),body=req.postData()?JSON.parse(req.postData()):null;
   const answer=(status,data)=>route.fulfill({status,headers,body:JSON.stringify(data)});
   if(u.origin===base){
    if(u.pathname.startsWith('/api/profile-media/')){
     if(method==='GET')return answer(200,{profile:meta,operation:null,imageEnabled:false});
     if(u.pathname.endsWith('/home-court')&&method==='PATCH'){
      writes.push({kind:'court',body});assert.equal(body.name,'');assert.equal(body.version,meta.home_court_version);
      const facility=f.tables.padel_facilities.find(x=>x.id===body.facilityId);assert(!facility||facility.availability!=='closed');
      meta={...meta,home_facility_id:body.facilityId,home_court_name:facility?.name??null,home_facility:facility??null,home_court_version:meta.home_court_version+1};return answer(200,{profile:meta});
     }
     throw Error('unexpected profile mutation');
    }
    if(u.pathname.startsWith('/api/'))return answer(404,{});
    return route.continue();
   }
   if(u.origin!==remote){outside.push(u.origin);return route.abort();}
   if(method==='OPTIONS')return answer(200,{});if(u.pathname.startsWith('/auth/'))return answer(200,user);
   const name=u.pathname.split('/').at(-1);
   if(name==='get_my_player_profiles')return answer(200,f.tables.player_profiles.filter(p=>p.linked_auth_user_id===user.id));
   if(name==='save_my_player_profile'){writes.push({kind:'profile',body});Object.assign(f.tables.player_profiles[0],body.p_values);return answer(200,f.tables.player_profiles[0]);}
   if(name==='get_my_profile_usage')return answer(200,[]);
   if(name==='get_my_club_memberships')return answer(200,f.tables.club_members.filter(m=>m.profile_id===user.id).map(m=>({...m,role:m.club_id===clubA?role:m.role})));
   if(name==='get_club_roster')return answer(200,f.tables.club_members.filter(m=>m.club_id===body.p_club_id).map(m=>({...m,role,created_at:'2026-01-01',status:'active',player_profiles:f.tables.player_profiles.find(p=>p.id===m.player_profile_id)??null})));
   if(name==='get_club_owner_transfer_candidates')return answer(403,{code:'42501'});
   if(name==='padel_facilities'&&failFacilities)return answer(503,{message:'fixture lookup failed'});
   if(name==='clubs'&&method==='PATCH'){
    writes.push({kind:'group',body});if(failSave)return answer(403,{code:'42501'});
    assert.equal(role,'main_admin');assert.deepEqual(Object.keys(body),['main_facility_id']);Object.assign(f.tables.clubs[0],body);return answer(204,null);
   }
   const response=await f.fetch(u.href,{method,headers:req.headers(),body:req.postData()||undefined});return route.fulfill({status:response.status,headers:{...headers,...Object.fromEntries(response.headers)},body:await response.text()});
  });
  const p=await c.newPage();p.setDefaultTimeout(18000);p.on('pageerror',e=>errors.push(e.message));
  const edit=()=>p.getByRole('dialog',{name:'プロフィールを編集',exact:true});
  const open=async()=>{await p.getByRole('button',{name:'プロフィールを編集',exact:true}).click();await edit().waitFor();await edit().getByRole('combobox',{name:'施設選択',exact:true}).waitFor();};
  const select=()=>edit().getByRole('combobox',{name:'施設選択',exact:true});
  const save=async()=>{await edit().getByRole('button',{name:'変更を保存',exact:true}).click();await edit().waitFor({state:'hidden'});};
  await p.goto(base+'/profile');await open();
  await edit().getByText('現在の登録：以前の未掲載コート',{exact:true}).waitFor();assert.equal(await edit().getByRole('option',{name:'その他・自由入力'}).count(),0);assert.equal(await edit().getByRole('textbox',{name:'ホームコート名（自由入力）'}).count(),0);
  await edit().getByRole('textbox',{name:'ひとこと',exact:true}).fill('他項目だけ変更');await save();assert.equal(writes.filter(w=>w.kind==='court').length,0);assert.equal(meta.home_court_name,'以前の未掲載コート');
  await open();await select().locator('optgroup[label="東京都"]').waitFor({state:'attached'});
  const profileMarkup=await select().innerHTML();assert.equal(await select().getByRole('option',{name:long,exact:true}).textContent(),long);assert.equal(await select().getByRole('option',{name:'閉業済み施設'}).count(),0);
  const className=await select().getAttribute('class');for(const width of [320,375]){await p.setViewportSize({width,height:812});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}await select().selectOption(id(1501));await save();assert.equal(meta.home_facility_id,id(1501));await p.reload();await open();assert.equal(await select().inputValue(),id(1501));await select().selectOption('');await save();assert.equal(meta.home_court_name,null);
  await open();await select().selectOption(id(1500));await edit().getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(meta.home_facility_id,null);
  meta={...meta,home_facility_id:null,home_court_name:'保護する従来値'};failFacilities=true;await p.reload();await open();await edit().getByRole('alert').filter({hasText:'登録済みの値は保持'}).waitFor();await edit().getByRole('textbox',{name:'ひとこと',exact:true}).fill('候補失敗でも他項目保存');const before=writes.filter(w=>w.kind==='court').length;await save();assert.equal(writes.filter(w=>w.kind==='court').length,before);assert.equal(meta.home_court_name,'保護する従来値');
  await open();await edit().getByRole('button',{name:'登録解除',exact:true}).click();await save();assert.equal(meta.home_court_name,null);failFacilities=false;
  const settings=()=>p.getByRole('dialog',{name:'グループ設定',exact:true});
  const openSettings=async()=>{await p.getByRole('tablist',{name:'グループ詳細'}).waitFor();if(await settings().isVisible())return;const menu=p.getByRole('dialog',{name:'グループの操作',exact:true});if(!await menu.isVisible())await p.getByRole('button',{name:'グループの操作',exact:true}).click();await menu.getByRole('button',{name:'グループ設定',exact:true}).click();await settings().waitFor();};
  await p.goto(base+'/groups/'+clubA);await openSettings();await settings().getByRole('button',{name:'編集',exact:true}).nth(2).click();
  const gs=()=>settings().getByRole('combobox',{name:'施設選択',exact:true});await gs().locator('optgroup[label="東京都"]').waitFor({state:'attached'});assert.equal(await gs().getAttribute('class'),className);assert.equal(await gs().innerHTML(),profileMarkup);assert.equal(await settings().getByRole('textbox').count(),0);assert.equal(await settings().getByRole('combobox').count(),1);
  await gs().selectOption(id(1501));await settings().getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(f.tables.clubs[0].main_facility_id,id(1500));
  await settings().getByRole('button',{name:'編集',exact:true}).nth(2).click();await gs().selectOption(id(1501));failSave=true;await settings().getByRole('button',{name:'保存',exact:true}).click();await settings().getByRole('alert').waitFor();assert.equal(await gs().inputValue(),id(1501));assert.equal(f.tables.clubs[0].main_facility_id,id(1500));failSave=false;
  await settings().getByRole('button',{name:'保存',exact:true}).click();await settings().getByText(long,{exact:true}).waitFor();assert.equal(f.tables.clubs[0].main_facility_id,id(1501));
  await settings().getByRole('button',{name:'編集',exact:true}).nth(2).click();await gs().selectOption('');await settings().getByRole('button',{name:'保存',exact:true}).click();assert.equal(f.tables.clubs[0].main_facility_id,null);
  f.tables.clubs[0].main_facility_id=id(1502);await p.reload();await openSettings();await settings().getByRole('button',{name:'編集',exact:true}).nth(2).click();assert.equal(await gs().inputValue(),id(1502));assert(await gs().getByRole('option',{name:'閉業済み施設',exact:true}).isDisabled());await settings().getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(f.tables.clubs[0].main_facility_id,id(1502));
  failFacilities=true;await p.reload();await openSettings();await settings().getByRole('button',{name:'編集',exact:true}).nth(2).click();await settings().getByRole('alert').filter({hasText:'登録済みの値は保持'}).waitFor();assert.equal(await gs().inputValue(),id(1502));await settings().getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(f.tables.clubs[0].main_facility_id,id(1502));failFacilities=false;
  for(const width of [320,375]){await p.setViewportSize({width,height:812});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await p.keyboard.press('Escape');await p.keyboard.press('Escape');role='member';await p.goto(base+'/groups/'+clubA);await p.getByRole('button',{name:'グループの操作',exact:true}).click();assert.equal(await p.getByRole('dialog',{name:'グループの操作',exact:true}).getByRole('button',{name:'グループ設定',exact:true}).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);await c.close();console.log('TASK-01-21 profile/group selection, legacy preservation, save/cancel/failure/permissions/320/375px PASS: '+theme);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
