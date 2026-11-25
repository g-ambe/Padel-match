// Local UI + synthetic API only. This does not exercise staging Auth/DB.
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {navigationFixture,user,player,clubA,clubB,id}=require('../fixtures/navigation-app.cjs');
const base=process.env.CLUB_NAME_TEST_URL||'http://127.0.0.1:3070',remote='http://127.0.0.1:54321';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const [width,theme] of [[375,'dark'],[375,'light'],[320,'dark'],[320,'light']]){
  const f=navigationFixture(),own=f.tables.club_members.find(m=>m.club_id===clubA);
  f.tables.player_profiles.push({id:id(91),linked_auth_user_id:id(92),display_name:'他人の本人名',is_active:true},{id:id(93),linked_auth_user_id:null,display_name:'仮登録名',is_active:true});
  f.tables.club_members.push({id:id(94),club_id:clubA,player_profile_id:id(91),profile_id:null,role:'member',is_active:true,status:'active'},{id:id(95),club_id:clubA,player_profile_id:id(93),profile_id:null,role:'member',is_active:true,status:'active'});
  for(const m of f.tables.club_members){m.club_display_name=null;m.public_name_confirmed=false;m.public_name_choice=null;}
  Object.assign(f.tables.user_preferences[0],{theme_mode:theme,tutorial_status:'completed'});
  const before=structuredClone(f.tables.player_profiles),otherAlias=f.tables.club_members.find(m=>m.club_id===clubB);
  otherAlias.club_display_name='Bだけの名前';
  const c=await browser.newContext({viewport:{width,height:812},hasTouch:true,colorScheme:theme});
  const actor={...user};let outsider=false,fail=false,hold=false,release;
  const calls=[],outside=[],errors=[];
  await c.addInitScript(({base,user})=>{if(location.origin!==base)return;user=JSON.parse(sessionStorage.getItem('club_test_actor')||'null')||user;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{base,user:actor});
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};
  await c.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),method=req.method(),b=req.postData()?JSON.parse(req.postData()):null;
   const answer=(status,value)=>route.fulfill({status,headers,body:JSON.stringify(value)});
   if(u.origin===base){if(u.pathname.startsWith('/api/'))return answer(200,{profile:null,imageEnabled:false});return route.continue();}
   if(u.origin!==remote){outside.push(u.origin);return route.abort();}
   if(method==='OPTIONS')return answer(200,{});
   if(u.pathname.startsWith('/auth/'))return answer(200,actor);
   const name=u.pathname.split('/').at(-1);calls.push({name,method,b});
   if(name==='get_my_club_memberships')return answer(200,outsider?[]:f.tables.club_members.filter(m=>m.player_profile_id===player));
   if(name==='get_club_roster')return answer(outsider?403:200,outsider?{code:'42501',message:'denied'}:f.tables.club_members.filter(m=>m.club_id===b.p_club_id).map(m=>{const p=f.tables.player_profiles.find(p=>p.id===m.player_profile_id);return{...m,player_profiles:{...p,club_display_name:m.club_display_name,public_name_confirmed:m.public_name_confirmed,public_name_choice:m.public_name_choice,public_name_enabled:!!m.public_name_confirmed||m.public_name_choice==='default_on',group_visibility:f.tables.clubs.find(c=>c.id===m.club_id).visibility}}}));
   if(name==='get_public_club_member_count')return answer(200,f.tables.club_members.filter(m=>m.club_id===b.p_club_id&&m.is_active).length);
   if(name==='get_public_club_directory')return answer(200,f.tables.club_members.filter(m=>m.club_id===b.p_club_id&&m.is_active).flatMap(m=>{const p=f.tables.player_profiles.find(p=>p.id===m.player_profile_id);return !p.linked_auth_user_id||m.public_name_confirmed?[{reference:'opaque-'+m.id,display_name:m.club_display_name??p.display_name,is_unlinked:!p.linked_auth_user_id}]:[]}));
   if(name==='save_club_member_field_v2'){
    if(hold)await new Promise(r=>release=r);
    if(fail){fail=false;own.club_display_name='別の端末の名前';return answer(409,{code:'PT409',message:'conflict'});}
    const m=f.tables.club_members.find(m=>m.id===b.p_member_id&&m.club_id===b.p_club_id);
    assert.equal(b.p_expected_name,m.club_display_name);assert.equal(b.p_expected_choice,m.public_name_choice);assert.equal(b.p_expected_confirmed,m.public_name_confirmed);
    if(b.p_field==='name'){m.club_display_name=b.p_name;if(b.p_expected_name===null&&m.public_name_choice===null)m.public_name_choice='default_on';}
    else {m.club_display_name??='本人';m.public_name_choice=b.p_public?'on':'off';m.public_name_confirmed=b.p_public;}
    return answer(200,{member_id:m.id,club_display_name:m.club_display_name,public_name_choice:m.public_name_choice,public_name_confirmed:m.public_name_confirmed,public_name_enabled:m.public_name_confirmed||m.public_name_choice==='default_on',group_visibility:'public'});
   }
   if(name==='club_members'&&method==='PATCH'){
    assert.deepEqual(Object.keys(b),['role']);const target=f.tables.club_members.find(m=>m.id===u.searchParams.get('id')?.slice(3));assert(target);target.role=b.role;return route.fulfill({status:200,headers:{...headers,'content-range':'0-0/1','access-control-expose-headers':'Content-Range'},body:JSON.stringify([target])});
   }
   if(['PATCH','DELETE'].includes(method)&&['club_members','player_profiles','profiles'].includes(name))throw Error('Unexpected direct write');
   const response=await f.fetch(u.href,{method,headers:req.headers(),body:req.postData()||undefined});
   return route.fulfill({status:response.status,headers:{...headers,...Object.fromEntries(response.headers)},body:await response.text()});
  });
  const p=await c.newPage();p.setDefaultTimeout(18000);p.on('pageerror',e=>errors.push(e.message));
  const membersTab=async()=>{await p.getByRole('tab',{name:'メンバー',exact:true}).waitFor();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent==='処理中...'));for(let i=0;i<6&&await p.locator('dialog[open]').count();i++){await p.locator('dialog[open]').last().getByRole('button',{name:'閉じる',exact:true}).first().click();await p.waitForTimeout(80);}await p.getByRole('tab',{name:'メンバー',exact:true}).click();};
  const rows=()=>p.locator(`[data-member-id="${own.id}"]`),dialog=()=>p.getByRole('dialog',{name:'メンバー詳細',exact:true});
  const open=async()=>{if(!await dialog().isVisible())await rows().click();await dialog().getByRole('button',{name:'グループ内表示名を編集',exact:true}).click();};
  const count=()=>calls.filter(c=>c.name==='save_club_member_field_v2').length;
  await p.goto(base+'/groups/'+clubA);await membersTab();await open();await p.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
  const input=()=>dialog().getByRole('textbox',{name:'グループ内表示名',exact:true}),toggle=()=>dialog().getByRole('switch');
  await input().fill('OFFで初期化する名前');assert.equal(count(),0);assert.equal(await toggle().getAttribute('aria-checked'),'true');
  hold=true;await toggle().click();await p.waitForTimeout(100);assert.equal(count(),1);assert(await toggle().isDisabled());hold=false;release();
  await dialog().getByRole('status',{name:'保存しました',exact:true}).waitFor();assert.equal(count(),2);
  const sent=calls.filter(c=>c.name==='save_club_member_field_v2');assert.equal(sent[0].b.p_field,'public');assert.equal(sent[0].b.p_public,false);assert.equal(sent[1].b.p_expected_choice,'off');assert.equal(own.public_name_choice,'off');
  await open();await input().fill('日本語入力中');await input().dispatchEvent('compositionstart');await input().press('Enter');await p.waitForTimeout(80);assert.equal(count(),2);await input().dispatchEvent('compositionend');await input().press('Enter');await dialog().getByRole('button',{name:'グループ内表示名を編集',exact:true}).waitFor();assert.equal(count(),3);assert.equal(own.public_name_choice,'off');
  await open();await input().fill('競合でも保持');fail=true;await input().press('Enter');await dialog().getByRole('alert').waitFor();assert.equal(await input().inputValue(),'競合でも保持');const failed=count();await p.waitForTimeout(100);assert.equal(count(),failed);
  await dialog().getByRole('button',{name:'最新の状態を確認',exact:true}).click();await dialog().getByRole('alert').waitFor({state:'hidden'});assert.equal(await input().inputValue(),'競合でも保持');await input().press('Enter');await dialog().getByRole('button',{name:'グループ内表示名を編集',exact:true}).waitFor();assert.equal(own.club_display_name,'競合でも保持');
  assert.equal(await p.getByRole('dialog',{name:'グループ内表示名を編集',exact:true}).count(),0);
  const rect=await dialog().boundingBox();assert(rect.x>=0&&rect.x+rect.width<=width);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert((await toggle().boundingBox()).height>=44);
  await p.keyboard.press('Escape');await membersTab();await p.locator(`[data-member-id="${id(94)}"]`).click();assert.equal(await dialog().getByRole('button',{name:'グループ内表示名を編集',exact:true}).count(),0);
  // Existing role path and target-role authorization remain in use; no save button.
  own.role='main_admin';await p.reload();await membersTab();await p.locator(`[data-member-id="${id(95)}"]`).click();await dialog().getByRole('button',{name:'役職を編集',exact:true}).click();await dialog().getByRole('combobox',{name:'役職',exact:true}).selectOption('sub_admin');await dialog().getByRole('status',{name:'役職を保存しました',exact:true}).waitFor();assert.equal(f.tables.club_members.find(m=>m.id===id(95)).role,'sub_admin');assert.equal(await dialog().getByRole('button',{name:'役職を保存',exact:true}).count(),0);assert.equal(await dialog().getByRole('switch').count(),0);
  const remove=dialog().getByRole('button',{name:'非表示／退会',exact:true});assert((await remove.boundingBox()).height>=44);
  await p.keyboard.press('Escape');await p.getByRole('button',{name:'グループの操作',exact:true}).click();await p.getByRole('dialog',{name:'グループの操作',exact:true}).waitFor();assert(await p.getByRole('link',{name:'戻る',exact:true}).isVisible());
  assert.deepEqual(f.tables.player_profiles,before);assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
  await c.close();console.log(`${width}px ${theme}: inline/IME/OFF-first/serialization/CAS/input preservation/mobile PASS (synthetic API)`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
