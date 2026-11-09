// ローカルのNext.jsと架空データのみで検証。本番Supabase・外部サイトへの通信を遮断する。
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {navigationFixture,id,user,clubA,clubB,player,ordinary,team,official,match,newMatch}=require('../fixtures/navigation-app.cjs');
const base=process.env.NAVIGATION_TEST_URL||'http://127.0.0.1:3002',remote='http://127.0.0.1:54321';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'Content-Range','content-type':'application/json'};
const poll=async fn=>{const until=Date.now()+12000;while(!await fn()){if(Date.now()>until)throw Error('条件待ちタイムアウト');await new Promise(r=>setTimeout(r,30));}};
(async()=>{
 const f=navigationFixture(),errors=[],external=[];let holdScore=false,rejectScore=false,releaseScore;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 async function context(authenticated){
  const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  if(authenticated)await c.addInitScript(({user,base})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{user,base});
  await c.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin===base)return route.continue();
   if(url.origin!==remote){external.push(req.url());return route.abort();}
   if(req.method()==='OPTIONS')return route.fulfill({status:200,headers:cors,body:'{}'});
   if(url.pathname.startsWith('/auth/'))return route.fulfill({status:200,headers:cors,body:JSON.stringify(user)});
   if(['match_results','save_friendly_match_score'].includes(url.pathname.split('/').at(-1))&&['POST','PATCH'].includes(req.method())){
    if(holdScore)await new Promise(resolve=>releaseScore=resolve);
    if(rejectScore)return route.fulfill({status:403,headers:cors,body:JSON.stringify({message:'試験用保存失敗',code:'42501'})});
   }
   const response=await f.fetch(req.url(),{method:req.method(),headers:req.headers(),body:req.postData()||undefined});
   return route.fulfill({status:response.status,headers:{...cors,...Object.fromEntries(response.headers)},body:await response.text()});
  });
  c.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));
  return c;
 }
 try{
  const c=await context(true),page=await c.newPage(),nav=()=>page.getByRole('navigation',{name:'下部ナビゲーション'});
  await page.goto(base+'/home');await page.getByRole('heading',{name:'開催中の試合（5）'}).waitFor();assert.equal(await page.locator('[data-active-match]').count(),2);
  await page.getByRole('button',{name:'残り3件を表示'}).click();assert.equal(await page.locator('[data-active-match]').count(),5);await page.getByText('古い開催中',{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'表示対象グループ'}).selectOption(clubA);assert.equal(await page.locator(`[data-active-match][href="/team-matches/${team}"]`).count(),1);
  await page.getByRole('combobox',{name:'表示対象グループ'}).selectOption(clubB);assert.equal(await page.locator(`[data-active-match][href="/team-matches/${team}"]`).count(),1);
  await page.getByRole('combobox',{name:'表示対象グループ'}).selectOption('none');assert.equal(await page.locator('[data-active-match]').count(),1);await page.getByText('本人のグループなし',{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'表示対象グループ'}).selectOption('all');await page.getByRole('button',{name:'オフィシャル',exact:true}).click();assert.equal(await page.locator('[data-past-match]').count(),1);await page.getByText('過去公式',{exact:true}).waitFor();
  await page.getByRole('button',{name:'フレンドリー',exact:true}).click();assert.equal(await page.locator('[data-past-match]').count(),26);
  for(const width of [375,390])for(const theme of ['dark','light']){
   await page.setViewportSize({width,height:844});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;},theme);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await nav().waitFor();
   const last=await page.locator('[data-past-match]').last();await last.scrollIntoViewIfNeeded();const [a,b]=await Promise.all([last.boundingBox(),nav().boundingBox()]);assert(a.y+a.height<=b.y+1,'下部バーが最終行を隠さない');
   await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`/tmp/match-navigation-${width}-${theme}.png`});
  }
  // 一般メンバーのグループを初期候補にして、通常・手動の既存作成処理を実行。
  for(const mode of ['auto','manual']){
   await page.goto(base+'/home');await page.getByRole('combobox',{name:'表示対象グループ'}).selectOption(clubA);await page.getByRole('link',{name:'＋ 新しい試合を作成'}).click();
   await page.getByRole('link',{name:mode==='auto'?'組み合わせ戦・自動生成':'組み合わせ戦・手動作成',exact:true}).click();await page.getByRole('button',{name:'作成',exact:true}).waitFor();
   assert.equal(await page.getByRole('combobox',{name:'作成先グループ'}).inputValue(),clubA);await page.getByRole('textbox',{name:'開催名'}).fill('作成テスト'+mode);
   await page.getByRole('button',{name:'作成',exact:true}).click();await page.waitForURL(/\/events\/[0-9a-f-]+$/);
   const created=f.tables.events.find(e=>e.name==='作成テスト'+mode);assert.equal(created.club_id,clubA);assert.equal(created.event_mode,mode);
  }
  // A/Bを独立して指定。試験内だけA側も管理可能な役職へ変更する。
  f.tables.club_members[0].role='sub_admin';await page.goto(base+'/matches/new');await page.getByRole('link',{name:'チーム戦',exact:true}).first().click();await page.getByLabel('イベント名',{exact:true}).fill('作成テストチーム');
  for(const [label,group]of [['チームA',clubA],['チームB',clubB]]){const box=page.getByText(label,{exact:true}).locator('..');await box.getByRole('combobox').first().selectOption(group);}
  await page.getByRole('button',{name:'作成',exact:true}).click();await page.waitForURL(/\/team-matches\/[0-9a-f-]+$/);
  const made=f.tables.events.find(e=>e.name==='作成テストチーム'),sides=f.tables.event_team_sides.filter(side=>side.event_id===made.id);assert.equal(sides[0].club_id,clubA);assert.equal(sides[1].club_id,clubB);f.tables.club_members[0].role='member';
  await page.goto(base+'/matches/new');await page.getByRole('link',{name:'チーム戦',exact:true}).last().click();await page.getByLabel('大会/リーグ名').fill('作成テスト公式');await page.getByLabel('所属グループ').selectOption(clubB);await page.getByRole('button',{name:'作成',exact:true}).click();await page.waitForURL(/\/official-matches\/[0-9a-f-]+$/);assert(f.tables.official_events.some(e=>e.title==='作成テスト公式'));
  // サンプルランキングを出さず、グループの既存戦績タブへ遷移する。
  await nav().getByRole('link',{name:'ランキング',exact:true}).click();await page.getByRole('heading',{name:'ランキング',exact:true}).waitFor();assert(!await page.getByText('田中').count());await page.getByRole('link',{name:/グループA/}).click();await page.waitForURL(/tab=stats/);await page.getByRole('heading',{name:'グループ戦績',exact:true}).waitFor();assert.equal(await nav().locator('[aria-current=page]').getAttribute('href'),'/ranking');
  await nav().getByRole('link',{name:'マイページ',exact:true}).click();await page.getByRole('heading',{name:'マイページ',exact:true}).waitFor();await page.getByRole('link',{name:/グループA/}).waitFor();await page.getByRole('link',{name:'通知・申請を確認する'}).click();await page.getByText('テスト通知',{exact:true}).waitFor();
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'アカウント・アプリ設定',exact:true}).click();await page.getByRole('button',{name:'ホワイトモード',exact:true}).click();await poll(()=>page.evaluate(()=>document.documentElement.dataset.theme==='light'));
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'アプリについて',exact:true}).click();await page.getByRole('link',{name:'利用規約',exact:true}).waitFor();
  // 保存済みの編集はキャンセルでき、履歴モーダル・スコア入力中は下部バーを隠す。
  await page.goto(base+'/events/'+ordinary);await page.locator('[data-round-history] > summary').click();await page.locator(`[data-score-key="/events/${ordinary}#${match}"]`).waitFor();
  const card=key=>page.locator(`[data-score-key="/events/${ordinary}#${key}"]:visible`).first(),dialog=()=>page.locator('dialog[open]').last();
  const before=f.calls.filter(call=>['POST','PATCH'].includes(call.method)&&['match_results','save_friendly_match_score'].includes(call.table)).length;
  await card(match).getByRole('button').first().click();await dialog().waitFor();await poll(async()=>!await nav().isVisible());await dialog().getByRole('button',{name:'0',exact:true}).click();await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();await nav().waitFor();assert.equal(f.calls.filter(call=>['POST','PATCH'].includes(call.method)&&['match_results','save_friendly_match_score'].includes(call.table)).length,before);
  await page.getByRole('button',{name:'全試合履歴を拡大'}).click();await dialog().waitFor();await poll(async()=>!await nav().isVisible());await page.keyboard.press('Escape');await nav().waitFor();
  holdScore=true;rejectScore=true;await card(newMatch).getByRole('button').first().click();await dialog().getByRole('button',{name:'0',exact:true}).click();await dialog().getByRole('button',{name:'0',exact:true}).click();await poll(()=>!!releaseScore);await nav().waitFor();
  await nav().getByRole('link',{name:'ランキング',exact:true}).click();assert(page.url().endsWith('/events/'+ordinary));await page.getByRole('alert').filter({hasText:'未保存のスコア'}).waitFor();await poll(()=>page.evaluate(()=>parseFloat(document.body.style.getPropertyValue('--app-navigation-height'))>100));holdScore=false;releaseScore();await card(newMatch).getByRole('button',{name:'再試行'}).waitFor();
  // 既存のメニュー経由で移動した場合も、Providerの警告が下部バーの上に出る。
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'使い方・ヘルプ',exact:true}).click();const warning=page.locator('body > aside[role="status"]');await warning.waitFor();const [w,n]=await Promise.all([warning.boundingBox(),nav().boundingBox()]);assert(w.y+w.height<=n.y,'未保存警告が下部バーと重ならない');
  await warning.getByRole('link',{name:'入力画面へ戻る'}).click();rejectScore=false;await card(newMatch).getByRole('button',{name:'再試行'}).click();await poll(()=>f.tables.matches.find(m=>m.id===newMatch).completed===true);await poll(async()=>!await card(newMatch).getByRole('button',{name:'再試行'}).count());assert.equal(f.tables.match_results.filter(r=>r.match_id===newMatch).length,1);assert.equal(f.tables.match_results.find(r=>r.match_id===newMatch).winner_team,'draw');
  // 公開共有・ログインには下部バーを出さない。実データを必要としない無効リンクでも確認。
  await page.goto(base+'/share/events/invalid');await page.getByRole('heading',{name:'イベント結果共有'}).waitFor();assert.equal(await nav().count(),0);
  // 管理者入口は既存条件で出し分ける。
  f.tables.app_admins.push({id:id(900),profile_id:user.id,is_active:true});await page.goto(base+'/home');await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'スーパーユーザー管理'}).waitFor();
  await c.close();
  const g=await context(false),gp=await g.newPage();await gp.goto(base+'/login');assert.equal(await gp.getByRole('navigation',{name:'下部ナビゲーション'}).count(),0);await gp.getByRole('button',{name:'ゲストで利用'}).click();await gp.waitForURL(base+'/home');await gp.getByRole('link',{name:'＋ 新しい試合を作成'}).click();await gp.getByRole('link',{name:'組み合わせ戦・自動生成',exact:true}).click();await gp.getByRole('textbox',{name:'開催名'}).fill('ゲスト保持テスト');await gp.getByRole('button',{name:'作成',exact:true}).click();await gp.waitForURL(/\/events\/guest_/);
  const saved=await gp.evaluate(()=>sessionStorage.getItem('padel_guest_events_v1'));await gp.getByRole('navigation',{name:'下部ナビゲーション'}).getByRole('link',{name:'試合',exact:true}).click();await gp.getByText('ゲスト保持テスト',{exact:true}).waitFor();assert.equal(await gp.evaluate(()=>sessionStorage.getItem('padel_guest_events_v1')),saved);
  await gp.getByRole('navigation',{name:'下部ナビゲーション'}).getByRole('link',{name:'マイページ',exact:true}).click();await gp.getByRole('heading',{name:'ログイン・アカウント登録',exact:true}).waitFor();await gp.locator('dialog[open]').getByRole('button',{name:'閉じる',exact:true}).last().click();assert.equal(await gp.evaluate(()=>sessionStorage.getItem('padel_guest_events_v1')),saved);
  await gp.getByRole('button',{name:'TOPへ戻る',exact:true}).click();await gp.waitForURL(base+'/');assert.equal(await gp.evaluate(()=>sessionStorage.getItem('padel_guest_events_v1')),null);
  assert.equal(f.tables.player_profiles.length,1,'今回のUI操作で選手プロフィールを増やさない');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('全形式の作成と詳細遷移、2件＋展開・過去フィルター、A/B・グループなし、古い開催中、ランキング・マイ・通知・管理者、テーマ、375/390px、ゲスト保持と明示削除、スコア取消・保存中/失敗の離脱防止・再試行・警告位置、公開共有のバー除外を確認。本番通信なし。');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
