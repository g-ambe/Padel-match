// Local UI + synthetic API only. This does not exercise staging Auth/DB.
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {navigationFixture,user,player,clubA,clubB,id}=require('../fixtures/navigation-app.cjs');
const base=process.env.CLUB_NAME_TEST_URL||'http://127.0.0.1:3070',remote='http://127.0.0.1:54321';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const theme of ['dark','light']){
  const f=navigationFixture(),own=f.tables.club_members.find(m=>m.club_id===clubA);
  f.tables.player_profiles.push({id:id(91),linked_auth_user_id:id(92),display_name:'他人の本人名',is_active:true},{id:id(93),linked_auth_user_id:null,display_name:'仮登録名',is_active:true});
  f.tables.club_members.push({id:id(94),club_id:clubA,player_profile_id:id(91),profile_id:null,role:'member',is_active:true,status:'active'},{id:id(95),club_id:clubA,player_profile_id:id(93),profile_id:null,role:'member',is_active:true,status:'active'});
  for(const m of f.tables.club_members){m.club_display_name=null;m.public_name_confirmed=false;}
  Object.assign(f.tables.user_preferences[0],{theme_mode:theme,tutorial_status:'completed'});
  const before=structuredClone(f.tables.player_profiles),otherAlias=f.tables.club_members.find(m=>m.club_id===clubB);
  otherAlias.club_display_name='Bだけの名前';
  const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,colorScheme:theme});
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
   if(name==='get_club_roster')return answer(outsider?403:200,outsider?{code:'42501',message:'denied'}:f.tables.club_members.filter(m=>m.club_id===b.p_club_id).map(m=>{const p=f.tables.player_profiles.find(p=>p.id===m.player_profile_id);return{...m,player_profiles:{...p,club_display_name:m.club_display_name,public_name_confirmed:m.public_name_confirmed}}}));
   if(name==='get_public_club_directory')return answer(200,f.tables.club_members.filter(m=>m.club_id===b.p_club_id&&m.is_active).flatMap(m=>{const p=f.tables.player_profiles.find(p=>p.id===m.player_profile_id);return !p.linked_auth_user_id||m.public_name_confirmed?[{reference:'opaque-'+m.id,display_name:m.club_display_name??p.display_name,is_unlinked:!p.linked_auth_user_id}]:[]}));
   if(name==='save_club_member_display_name'){
    if(hold)await new Promise(r=>release=r);
    if(fail){fail=false;own.club_display_name='別の端末の名前';return answer(409,{code:'PT409',message:'conflict'});}
    const m=f.tables.club_members.find(m=>m.id===b.p_member_id&&m.club_id===b.p_club_id);
    assert(m);assert.equal(b.p_expected_club_display_name,m.club_display_name);assert(m.is_active);
    const publicName=m.player_profile_id===player&&f.tables.clubs.find(g=>g.id===m.club_id).visibility==='public';
    assert.equal(b.p_public_confirmation,publicName);m.club_display_name=b.p_display_name;m.public_name_confirmed=publicName;
    return answer(200,{member_id:m.id,club_display_name:m.club_display_name,public_name_confirmed:publicName});
   }
   if(['PATCH','DELETE'].includes(method)&&['club_members','player_profiles','profiles'].includes(name))throw Error('Unexpected direct write');
   const response=await f.fetch(u.href,{method,headers:req.headers(),body:req.postData()||undefined});
   return route.fulfill({status:response.status,headers:{...headers,...Object.fromEntries(response.headers)},body:await response.text()});
  });
  const p=await c.newPage();p.setDefaultTimeout(18000);p.on('pageerror',e=>errors.push(e.message));
  const membersTab=async()=>{await p.getByRole('tab',{name:'メンバー',exact:true}).waitFor();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent==='処理中...'));for(let i=0;i<6&&await p.locator('dialog[open]').count();i++){await p.keyboard.press('Escape');await p.waitForTimeout(80);}await p.getByRole('tab',{name:'メンバー',exact:true}).click();};
  const rows=()=>p.locator(`[data-member-id="${own.id}"]`),dialog=()=>p.getByRole('dialog',{name:'グループ内表示名を編集'});
  const open=async()=>{const member=p.getByRole('dialog',{name:'メンバー詳細',exact:true});if(!await member.isVisible())await rows().click();await member.getByRole('button',{name:/グループ内表示名を設定|表示名を編集/}).click();await dialog().waitFor();};
  const count=()=>calls.filter(c=>c.name==='save_club_member_display_name').length;
  await p.goto(base+'/groups/'+clubA);await membersTab();
  await rows().getByText('グループ内表示名 未設定（本人）',{exact:true}).waitFor();
  assert.equal(await p.locator(`[data-member-id="${id(94)}"]`).getByRole('button',{name:/表示名/}).count(),0);
  assert.equal(await p.locator(`[data-member-id="${id(95)}"]`).getByRole('button',{name:/表示名/}).count(),0);
  await open();await p.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);const box=await dialog().boundingBox();assert(box.x>=0&&box.x+box.width<=375);assert((await dialog().getByRole('button',{name:'保存',exact:true}).boundingBox()).height>=44);assert.equal(await dialog().getByLabel('グループ内表示名',{exact:true}).inputValue(),'');
  await dialog().getByLabel('グループ内表示名',{exact:true}).fill('破棄する入力');await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(count(),0);
  await open();await dialog().getByLabel('グループ内表示名',{exact:true}).fill('Aでの本人');assert(await dialog().getByRole('button',{name:'保存',exact:true}).isDisabled());
  await dialog().getByRole('checkbox').check();hold=true;await dialog().getByRole('button',{name:'保存',exact:true}).click();await p.waitForTimeout(100);
  assert.equal(count(),1);assert(await dialog().getByRole('button',{name:'保存中…',exact:true}).isDisabled());hold=false;release();await dialog().waitFor({state:'hidden'});
  await rows().getByText('Aでの本人（本人）',{exact:true}).waitFor();assert.equal(otherAlias.club_display_name,'Bだけの名前');
  await open();await dialog().getByLabel('グループ内表示名',{exact:true}).fill('競合でも保持');await dialog().getByRole('checkbox').check();const beforeConflict=count(),beforeReload=calls.filter(c=>c.name==='get_club_roster').length;fail=true;await dialog().getByRole('button',{name:'保存',exact:true}).click();
  await dialog().getByRole('alert').filter({hasText:'表示名が更新されています'}).waitFor();assert.equal(await dialog().getByLabel('グループ内表示名',{exact:true}).inputValue(),'競合でも保持');
  assert.equal(count(),beforeConflict+1);assert.equal(calls.filter(c=>c.name==='get_club_roster').length,beforeReload);
  await dialog().getByRole('button',{name:'最新の状態を確認'}).click();await dialog().getByText('現在のグループ内表示名：別の端末の名前',{exact:true}).waitFor();
  assert.equal(calls.filter(c=>c.name==='get_club_roster').length,beforeReload+1);
  assert.equal(await dialog().getByLabel('グループ内表示名',{exact:true}).inputValue(),'競合でも保持');assert(!(await dialog().getByRole('checkbox').isChecked()));
  await dialog().getByRole('checkbox').check();await dialog().getByRole('button',{name:'保存',exact:true}).click();await dialog().waitFor({state:'hidden'});
  f.tables.clubs.find(g=>g.id===clubA).visibility='private';await p.reload();await membersTab();await open();
  assert.equal(await dialog().getByRole('checkbox').count(),0);await dialog().getByLabel('グループ内表示名',{exact:true}).fill('非公開の名前');await dialog().getByRole('button',{name:'保存',exact:true}).click();await dialog().waitFor({state:'hidden'});assert.equal(own.public_name_confirmed,false);
  // Administrative role never enables edits of another linked account; unlinked remains editable.
  own.role='main_admin';await p.reload();await membersTab();await p.locator(`[data-member-id="${id(95)}"]`).click();await p.getByRole('dialog',{name:'メンバー詳細',exact:true}).getByRole('button',{name:'グループ内表示名を設定'}).waitFor();await p.getByRole('dialog',{name:'メンバー詳細',exact:true}).getByRole('button',{name:'閉じる',exact:true}).first().click();
  assert.equal(await p.locator(`[data-member-id="${id(94)}"]`).getByRole('button',{name:/表示名/}).count(),0);
  const rect=await rows().boundingBox();assert(rect.x>=0&&rect.x+rect.width<=375);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Public result omits old/unconfirmed linked entries: no fallback roster or profile name.
  outsider=true;actor.id=id(99);actor.email='outsider@example.invalid';await p.evaluate(actor=>sessionStorage.setItem('club_test_actor',JSON.stringify(actor)),actor);f.tables.clubs.find(g=>g.id===clubA).visibility='public';own.role='member';const start=calls.length;
  await p.reload();await membersTab();await p.locator('[data-member-id]').getByText('仮登録名',{exact:true}).waitFor();
  assert.equal(await p.getByText('他人の本人名',{exact:true}).count(),0);assert.equal(await p.getByText('非公開の名前（本人）',{exact:true}).count(),0);
  assert.equal(calls.slice(start).filter(c=>c.name==='get_club_roster').length,0);
  assert.deepEqual(f.tables.player_profiles,before);assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
  await c.close();console.log(`375px ${theme}: alias editor/cancel/consent/CAS/private/admin/public directory PASS (synthetic API)`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
