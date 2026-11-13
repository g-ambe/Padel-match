// 既存フォームと合成APIだけを利用。本番通信・実データへの書込みは禁止。
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {navigationFixture,id,user,clubA,clubB}=require('../fixtures/navigation-app.cjs');
const base=process.env.NAVIGATION_TEST_URL||'http://127.0.0.1:3065',remote='http://127.0.0.1:54321';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json','access-control-expose-headers':'Content-Range'};
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 const f=navigationFixture(),errors=[],outside=[];
 f.tables.events.push({id:id(980),club_id:clubB,name:'直近のグループ利用',status:'closed',is_deleted:false,event_mode:'auto',created_by_auth_user_id:user.id,created_at:'2026-11-13T12:00:00Z'});
 const open=async(auth=true)=>{
  const c=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
  await c.addInitScript(({auth,user})=>{localStorage.setItem('padel-theme-mode','dark');if(auth){const e=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:e({alg:'HS256'})+'.'+e({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+7200})+'.test',refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+7200,user}));}},{auth,user});
  await c.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin===base)return route.continue();
   if(url.origin!==remote){outside.push(url.origin);return route.abort();}
   if(req.method()==='OPTIONS')return route.fulfill({status:200,headers:cors,body:'{}'});
   if(url.pathname.startsWith('/auth/'))return route.fulfill({status:200,headers:cors,body:JSON.stringify(auth?user:null)});
   const r=await f.fetch(url.href,{method:req.method(),headers:req.headers(),body:req.postData()||undefined});return route.fulfill({status:r.status,headers:{...cors,...Object.fromEntries(r.headers)},body:await r.text()});
  });
  const p=await c.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));return {c,p};
 };
 try{
  const {c,p}=await open();await p.goto(base+'/home');await p.getByRole('link',{name:'＋ 新しいイベントを作成',exact:true}).click();
  const cards=p.locator('[data-event-formats]');await cards.waitFor();assert.equal(await cards.locator(':scope > div').count(),3);assert.equal(await p.getByText(/オフィシャル|準備中/).count(),0);
  const count=f.tables.events.length;
  for(const title of ['自動で組む','自分で組む','チーム戦']){
   await p.getByRole('button',{name:title+'の説明',exact:true}).click();await p.getByRole('dialog').getByRole('heading',{name:title,exact:true}).waitFor();assert.equal(new URL(p.url()).pathname,'/matches/new');await p.getByRole('dialog').getByRole('button',{name:'閉じる',exact:true}).click();
  }
  assert.equal(f.tables.events.length,count);
  for(const width of [320,375,390])for(const theme of ['light','dark']){await p.setViewportSize({width,height:812});await p.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;},theme);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await p.setViewportSize({width:375,height:812});
  await p.getByRole('link',{name:'自動で組む',exact:true}).click();await p.getByRole('button',{name:'作成',exact:true}).waitFor();
  const group=p.getByRole('combobox',{name:'作成先グループ'});assert.deepEqual(await group.locator('option').evaluateAll(items=>items.map(x=>x.value)),['',clubB,clubA]);
  await p.getByRole('textbox',{name:'開催名'}).fill('往復して作成');await p.getByRole('combobox',{name:'コート数'}).selectOption('3');await group.selectOption(clubA);
  await p.getByRole('button',{name:'イベント形式へ戻る',exact:true}).click();await p.getByRole('link',{name:'自分で組む',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('input[aria-label="開催名"]')?.value==='往復して作成');assert.equal(await p.getByRole('combobox',{name:'コート数'}).inputValue(),'3');assert.equal(await group.inputValue(),clubA);assert.equal(await p.getByRole('combobox',{name:'対戦作成方式'}).inputValue(),'manual');
  await p.getByRole('button',{name:'作成',exact:true}).click();await p.waitForURL(/\/events\/[0-9a-f-]+$/);const manual=f.tables.events.find(e=>e.name==='往復して作成');assert.equal(manual.event_mode,'manual');assert.equal(manual.court_count,3);assert.equal(manual.club_id,clubA);
  assert.equal(await p.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.includes(':form:')&&key.endsWith(':ordinary')).length),0);
  await p.goto(base+'/matches/new');await p.getByRole('link',{name:'自動で組む',exact:true}).click();await p.getByRole('textbox',{name:'開催名'}).fill('グループなし自動');await group.selectOption('');
  await p.goBack();await p.getByRole('link',{name:'自動で組む',exact:true}).click();await p.waitForFunction(()=>document.querySelector('input[aria-label="開催名"]')?.value==='グループなし自動');
  await p.getByRole('button',{name:'作成',exact:true}).click();await p.waitForURL(/\/events\/[0-9a-f-]+$/);const auto=f.tables.events.find(e=>e.name==='グループなし自動');assert.equal(auto.event_mode,'auto');assert.equal(auto.club_id,null);
  await p.goto(base+'/matches/new');await p.getByRole('link',{name:'チーム戦',exact:true}).click();let d=()=>p.getByRole('dialog');await d().getByLabel('イベント名（必須）').fill('保持するチームイベント');
  await d().locator('summary').filter({hasText:'コメント・メモ'}).click();await d().getByLabel('コメント',{exact:true}).fill('コメント保持');await d().getByLabel('メモ',{exact:true}).fill('メモ保持');await d().getByRole('button',{name:'次へ',exact:true}).click();
  await d().getByRole('combobox',{name:'チームAのグループ'}).selectOption(clubA);await d().getByLabel('チーム名',{exact:true}).fill('Aの名前');await d().getByRole('button',{name:'次へ',exact:true}).click();await d().getByRole('combobox',{name:'チームBのグループ'}).selectOption(clubB);await d().getByLabel('チーム名',{exact:true}).fill('Bの名前');
  await d().getByRole('button',{name:'戻る',exact:true}).click();assert.equal(await d().getByLabel('チーム名',{exact:true}).inputValue(),'Aの名前');await d().getByRole('button',{name:'戻る',exact:true}).click();await d().getByRole('button',{name:'形式へ戻る',exact:true}).click();
  await p.getByRole('link',{name:'チーム戦',exact:true}).click();await d().getByRole('button',{name:'次へ',exact:true}).click();await d().getByRole('combobox',{name:'チームAのグループ'}).waitFor();assert.equal(await d().getByLabel('チーム名',{exact:true}).inputValue(),'Aの名前');await d().getByRole('button',{name:'次へ',exact:true}).click();assert.equal(await d().getByLabel('チーム名',{exact:true}).inputValue(),'Bの名前');await d().getByRole('button',{name:'次へ',exact:true}).click();await d().getByText('コメント保持',{exact:true}).waitFor();await d().getByText('メモ保持',{exact:true}).waitFor();await d().getByRole('button',{name:'この内容で作成',exact:true}).click();await p.waitForURL(/\/team-matches\/[0-9a-f-]+$/);
  const team=f.tables.events.find(e=>e.name==='保持するチームイベント');assert.equal(team.event_mode,'team');assert.equal(team.description,'コメント保持');assert.equal(team.memo,'メモ保持');assert.deepEqual(f.tables.event_team_sides.filter(s=>s.event_id===team.id).map(s=>[s.club_id,s.team_name]),[[clubA,'Aの名前'],[clubB,'Bの名前']]);
  await c.close();
  const guest=await open(false);await guest.p.goto(base+'/login');await guest.p.evaluate(()=>sessionStorage.setItem('padel_guest_mode_v1','1'));await guest.p.goto(base+'/matches/new');await guest.p.locator('[data-event-formats]').waitFor();assert.equal(await guest.p.getByRole('link',{name:'チーム戦',exact:true}).count(),0);await guest.p.getByText('ログイン後に利用できます',{exact:true}).waitFor();await guest.p.getByRole('link',{name:'自分で組む',exact:true}).click();await guest.p.getByRole('textbox',{name:'開催名'}).fill('ゲストの手動');await guest.p.getByRole('button',{name:'イベント形式へ戻る',exact:true}).click();await guest.p.getByRole('link',{name:'自分で組む',exact:true}).click();await guest.p.waitForFunction(()=>document.querySelector('input[aria-label="開催名"]')?.value==='ゲストの手動');await guest.p.getByRole('button',{name:'作成',exact:true}).click();await guest.p.waitForURL(/\/events\/guest_/);await guest.c.close();
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);console.log('3形式/i説明/公式非表示/通常・手動・チーム作成/往復・ステップ入力保持/最近のグループ/グループなし/ゲスト/320・375・390px両テーマ PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
