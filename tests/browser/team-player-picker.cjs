// ローカル・合成データのみ。修正前後を同じ候補・375px・テーマで撮影する。
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {navigationFixture,id,user,clubA,clubB,team}=require('../fixtures/navigation-app.cjs');
const base=process.env.NAVIGATION_TEST_URL||'http://127.0.0.1:3042',remote='http://127.0.0.1:54321';
const baseline=process.env.PICKER_BASELINE==='1';
(async()=>{
 const f=navigationFixture(),errors=[],outside=[];let failGuest=false,guestGate=null;
 const teamNames=['Wytel部活・フレンドリーチーム','パデルクラブB選抜'];
 f.tables.event_team_attendance=[{event_id:team,side:'team_a',member_id:id(870),guest_id:null,status:'absent'}];
 f.tables.event_team_sides.filter(s=>s.event_id===team).forEach((s,i)=>s.team_name=teamNames[i]);
 for(let n=0;n<38;n++){const pid=id(850+n);f.tables.player_profiles.push({id:pid,display_name:n===2?'長い選手名の表示確認・フレンドリーマッチ参加メンバー':'選手'+n,is_active:true});f.tables.club_members.push({id:id(870+n),club_id:n<20?clubA:clubB,player_profile_id:pid,profile_id:null,is_active:true,role:'member'});}
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true});
  await c.addInitScript(({base,user})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{base,user});
  await c.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin===base)return route.continue();if(url.origin!==remote){outside.push(url.origin);return route.abort();}const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};if(req.method()==='OPTIONS')return route.fulfill({status:200,headers,body:'{}'});if(url.pathname.startsWith('/auth/'))return route.fulfill({status:200,headers,body:JSON.stringify(user)});if(url.pathname.endsWith('/event_team_guests')&&req.method()==='POST'){if(failGuest)return route.fulfill({status:403,headers,body:JSON.stringify({code:'42501',message:'合成試験の登録失敗'})});if(guestGate)await guestGate;}const r=await f.fetch(req.url(),{method:req.method(),headers:req.headers(),body:req.postData()||undefined});return route.fulfill({status:r.status,headers:{...headers,...Object.fromEntries(r.headers)},body:await r.text()});});
  const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/team-matches/'+team);await p.getByRole('button',{name:'試合カードを追加',exact:true}).click();
  const form=p.locator('fieldset').filter({hasText:'試合カードを追加'});
  await p.addStyleTag({content:'nextjs-portal { display:none !important; }'});
  for(const theme of ['dark','light']){
   await p.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;},theme);
   await form.evaluate(el=>el.scrollIntoView({block:'start'}));
   await p.screenshot({path:`/tmp/team-player-picker-${baseline?'before':'after'}-375-${theme}.png`});
  }
  if(baseline){console.log('同条件の修正前画像を撮影');return;}
  // 以下は実装後のPOP・下書き・重複防止を検証する。
  const slot=i=>form.locator('[data-player-slot]').nth(i),dialog=()=>p.locator('dialog[open]').last();
  assert.equal(await form.locator('[data-player-slot]').count(),4);
  assert.equal(await form.getByRole('button',{name:/の選手1を選択$/}).count(),0,'候補を常時表示しない');
  await slot(0).click();assert.equal(await dialog().getByRole('button',{name:teamNames[0]+'の選手0を選択',exact:true}).count(),0,'欠席者を除外');assert.equal(await dialog().getByRole('button',{name:teamNames[0]+'の選手20を選択',exact:true}).count(),0,'別チームを混ぜない');
  await dialog().getByRole('button',{name:teamNames[0]+'の選手1を選択',exact:true}).click();assert.equal(await p.locator('dialog[open]').count(),0);assert(await slot(0).getByText('選手1',{exact:true}).isVisible());
  await slot(0).click();await p.screenshot({path:'/tmp/team-player-picker-selected-375-light.png'});await dialog().getByRole('button',{name:teamNames[0]+'の選手3を選択',exact:true}).click();assert(await slot(0).getByText('選手3',{exact:true}).isVisible());
  await slot(1).click();assert(await dialog().getByRole('button',{name:teamNames[0]+'の選手3を選択',exact:true}).isDisabled());await p.keyboard.press('Escape');assert(await slot(0).getByText('選手3',{exact:true}).isVisible());
  const scroll=await p.evaluate(()=>scrollY);await slot(0).click();await p.mouse.click(2,2);assert.equal(await p.locator('dialog[open]').count(),0);assert(Math.abs(await p.evaluate(()=>scrollY)-scroll)<2,'背景タップ後にスクロール位置を保持');assert(await slot(0).getByText('選手3',{exact:true}).isVisible());
  await slot(0).click();await dialog().getByRole('button',{name:'選択を解除',exact:true}).click();assert(await slot(0).getByText('＋ 選手を選択',{exact:true}).isVisible());
  await slot(0).click();await dialog().getByRole('button',{name:teamNames[0]+'の本人を選択',exact:true}).click();await slot(2).click();assert(await dialog().getByRole('button',{name:teamNames[1]+'の本人を選択',exact:true}).isDisabled(),'両グループ所属でも重複禁止');await p.keyboard.press('Escape');await slot(0).click();await dialog().getByRole('button',{name:'選択を解除',exact:true}).click();
  for(const width of [320,375,390])for(const theme of ['dark','light']){
   await p.setViewportSize({width,height:812});await p.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;},theme);
   await slot(0).click();assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const candidates=dialog().locator('[data-player-candidates]');assert(await candidates.evaluate(el=>el.scrollHeight>el.clientHeight),'多数候補は内部スクロール');assert.equal(await p.locator('.app-bottom-navigation:visible').count(),0,'集中モードで下部バーを隠す');
   await p.screenshot({path:`/tmp/team-player-picker-pop-${width}-${theme}.png`});await dialog().getByRole('button',{name:'閉じる',exact:true}).click();
  }
  await slot(0).click();await dialog().getByText('＋ ゲストを追加',{exact:true}).click();await dialog().getByPlaceholder('ゲスト名',{exact:true}).fill('入力途中');await dialog().getByRole('button',{name:'閉じる',exact:true}).click();await slot(0).click();assert.equal(await dialog().getByPlaceholder('ゲスト名',{exact:true}).inputValue(),'入力途中');
  await p.setViewportSize({width:375,height:450});await dialog().getByPlaceholder('ゲスト名',{exact:true}).fill('追加ゲスト');failGuest=true;await dialog().getByRole('button',{name:'候補に追加',exact:true}).click();await dialog().getByRole('alert').waitFor();assert.equal(await dialog().getByPlaceholder('ゲスト名').inputValue(),'追加ゲスト');failGuest=false;
  let release;guestGate=new Promise(resolve=>release=resolve);await dialog().getByRole('button',{name:'候補に追加',exact:true}).click();assert(await dialog().getByRole('button',{name:'閉じる',exact:true}).isDisabled());await p.keyboard.press('Escape');assert.equal(await p.locator('dialog[open]').count(),1);release();guestGate=null;
  await dialog().getByRole('button',{name:teamNames[0]+'の追加ゲストを選択',exact:true}).click();assert(await slot(0).getByText('追加ゲスト',{exact:true}).isVisible());assert.equal(f.tables.event_team_guests.at(-1).side,'team_a');assert.equal(f.tables.event_team_guests.length,1,'再試行でも登録成功は1回');
  await slot(2).click();await dialog().getByText('その他・既存の自由入力',{exact:true}).click();await dialog().getByPlaceholder('自由入力',{exact:true}).fill('未確定の自由入力');await dialog().getByRole('button',{name:'閉じる',exact:true}).click();assert(await slot(2).getByText('＋ 選手を選択',{exact:true}).isVisible());await slot(2).click();assert.equal(await dialog().getByPlaceholder('自由入力',{exact:true}).inputValue(),'未確定の自由入力');await dialog().getByRole('button',{name:'この名前を選択',exact:true}).click();assert(await slot(2).getByText('未確定の自由入力',{exact:true}).isVisible());
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);console.log('4枠・POP選択/解除/取消・チーム分離/重複/欠席・下書き/ゲスト/自由入力・多数候補・短い画面・320/375/390px両テーマ：成功');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
