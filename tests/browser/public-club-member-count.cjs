// Local Next + synthetic Auth/API only. No Stage/production reads or writes.
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {navigationFixture,user,clubA,clubB,id}=require('../fixtures/navigation-app.cjs');
const base=process.env.PUBLIC_COUNT_TEST_URL||'http://127.0.0.1:3070',remote='http://127.0.0.1:54321';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const theme of ['dark','light']){
  const f=navigationFixture();Object.assign(f.tables.user_preferences[0],{theme_mode:theme,tutorial_status:'completed'});
  let member=false,failure=null,valueA=2,holdA=false,releaseA,oldResponseFinished=false;
  const calls=[],outside=[],errors=[];
  const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,colorScheme:theme});
  await c.addInitScript(({base,user})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{base,user});
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};
  await c.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url()),method=r.method(),body=r.postData()?JSON.parse(r.postData()):null;
   const answer=(status,value)=>route.fulfill({status,headers,body:JSON.stringify(value)});
   if(u.origin===base){if(u.pathname.startsWith('/api/')){calls.push({name:u.pathname});return answer(200,{profile:null,imageEnabled:false});}return route.continue();}
   if(u.origin!==remote){outside.push(u.origin);return route.abort();}
   if(method==='OPTIONS')return answer(200,{});if(u.pathname.startsWith('/auth/'))return answer(200,user);
   const name=u.pathname.split('/').at(-1);calls.push({name,body,method,url:u.href});
   if(name==='get_my_club_memberships')return answer(200,member?f.tables.club_members:[]);
   if(name==='get_public_club_directory')return answer(200,valueA===0&&body.p_club_id===clubA?[]:[{reference:id(700),display_name:'公開された別名',is_unlinked:false}]);
   if(name==='get_public_club_member_count'){
    assert(!member);assert.deepEqual(Object.keys(body),['p_club_id']);assert([clubA,clubB].includes(body.p_club_id));
    if(failure){const fail=failure;failure=null;if(fail==='network')return route.abort();if(fail==='invalid')return answer(200,'2');return answer(403,{code:fail,message:'公開しない本人名'});}
    const value=body.p_club_id===clubA?valueA:7;
    if(body.p_club_id===clubA&&holdA){holdA=false;await new Promise(resolve=>releaseA=resolve);await answer(200,value);oldResponseFinished=true;return;}
    return answer(200,value);
   }
   if(name==='get_club_roster')return answer(200,f.tables.club_members.filter(m=>m.club_id===body.p_club_id).map(m=>({...m,created_at:'2026-01-01',player_profiles:f.tables.player_profiles.find(p=>p.id===m.player_profile_id)})));
   if(name==='get_club_owner_transfer_candidates')return answer(403,{code:'42501'});
   if(method!=='GET'&&method!=='HEAD'&&!u.pathname.includes('/rpc/'))throw Error('Unexpected direct write');
   const response=await f.fetch(u.href,{method,headers:r.headers(),body:r.postData()||undefined});return route.fulfill({status:response.status,headers:{...headers,...Object.fromEntries(response.headers)},body:await response.text()});
  });
  const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  const count=()=>p.locator('dt').filter({hasText:/^所属人数$/}).locator('xpath=following-sibling::dd[1]');
  const retry=()=>p.getByRole('button',{name:'所属人数を再読み込み',exact:true});
  const ready=async()=>{await p.getByRole('tablist',{name:'グループ詳細'}).waitFor();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent==='処理中...'));};
  const publicStart=calls.length;await p.goto(base+'/groups/'+clubA+'?from=discover');await ready();assert.equal(await count().innerText(),'2人');await p.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
  await p.getByRole('tab',{name:'メンバー',exact:true}).click();assert.equal(await p.locator('[data-member-id]').count(),1);await p.getByText('公開された別名',{exact:true}).waitFor();assert.equal(await p.getByText('公開しない本人名',{exact:false}).count(),0);await p.getByRole('tab',{name:'概要',exact:true}).click();await p.getByText('開催情報は所属後に確認できます。',{exact:true}).waitFor();
  // Zero is a real result. Errors must never use directory length, zero or a previous count.
  valueA=0;await p.reload();await ready();assert.equal(await count().innerText(),'0人');valueA=2;
  for(const fail of ['42501','PGRST202','network','invalid']){
   failure=fail;const n=calls.filter(c=>c.name==='get_public_club_member_count').length;await p.reload();await ready();assert.equal(await count().innerText(),'不明');await p.getByRole('alert').filter({hasText:'所属人数を取得できませんでした'}).waitFor();assert.equal(await p.getByText('公開しない本人名',{exact:false}).count(),0);assert.equal(calls.filter(c=>c.name==='get_public_club_member_count').length,n+1);
   await retry().click();await ready();assert.equal(await count().innerText(),'2人');assert.equal(await retry().count(),0);
  }
  // Hold A while navigating through the search to B; its late result cannot replace B's count.
  failure='42501';await p.reload();await ready();holdA=true;await retry().click();await p.waitForFunction(()=>Array.from(document.querySelectorAll('dd')).some(e=>e.textContent==='確認中…'));for(let tries=0;!releaseA;tries++){assert(tries<750,'Count request reaches the held response');await p.waitForTimeout(20);}
  await p.getByRole('link',{name:'戻る',exact:true}).click();await p.waitForURL(/\/groups\/discover/);await p.getByRole('link').filter({hasText:'グループB'}).first().click();await ready();assert.equal(await count().innerText(),'7人');releaseA();for(let tries=0;!oldResponseFinished;tries++){assert(tries<750,'Old response completes');await p.waitForTimeout(20);}assert.equal(await count().innerText(),'7人');
  await p.getByRole('link',{name:'戻る',exact:true}).click();await p.getByRole('link').filter({hasText:'グループA'}).first().click();await ready();assert.equal(await count().innerText(),'2人');
  const forbidden=['club_members','player_profiles','profiles','get_club_roster','events','official_events','event_participants','matches','get_club_stats_members','get_club_stats_player_names','get_club_join_requests','list_player_profile_link_requests'];assert.deepEqual(calls.slice(publicStart).filter(c=>forbidden.includes(c.name)||c.name.startsWith('/api/profile-media')),[]);
  for(const patch of [{visibility:'private'},{visibility:'public',is_active:false}]){Object.assign(f.tables.clubs[0],patch);const n=calls.filter(c=>c.name==='get_public_club_member_count').length;await p.goto(base+'/groups/'+clubA);await p.getByRole('alert').filter({hasText:'このグループを表示できません'}).waitFor();assert.equal(calls.filter(c=>c.name==='get_public_club_member_count').length,n);}
  member=true;for(const visibility of ['public','private']){Object.assign(f.tables.clubs[0],{visibility,is_active:true});const memberStart=calls.filter(c=>c.name==='get_public_club_member_count').length;await p.goto(base+'/groups/'+clubA);await ready();assert.equal(await count().innerText(),'1人');assert.equal(calls.filter(c=>c.name==='get_public_club_member_count').length,memberStart);}
  const unknownStart=calls.filter(c=>c.name==='get_public_club_member_count').length;await p.goto(base+'/groups/'+id(9999));await p.getByRole('alert').filter({hasText:'このグループを表示できません'}).waitFor();assert.equal(calls.filter(c=>c.name==='get_public_club_member_count').length,unknownStart);
  assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await c.close();
  const anon=await browser.newContext({viewport:{width:375,height:812},colorScheme:theme}),anonymous=[];await anon.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin===base)return route.continue();anonymous.push(u.pathname);return route.fulfill({status:401,headers,body:'{}'});});const a=await anon.newPage();await a.goto(base+'/groups/'+clubA);await a.getByRole('alert').filter({hasText:'ログインして'}).waitFor();assert(!anonymous.some(p=>p.includes('/rest/v1/')));await anon.close();
  console.log(`375px ${theme}: directory 1 vs count 2 / hidden-name privacy / zero / error-invalid-network + retry / late response and back / member-private-anon guards PASS (synthetic API)`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
