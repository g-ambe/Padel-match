// 架空イベントとローカルビルドだけを使用する。比較元URLを指定した場合のみ変更前も計測する。
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {navigationFixture,user,id,noGroup,ordinary,manual}=require('../fixtures/navigation-app.cjs');
const base=process.env.NAVIGATION_TEST_URL||'http://127.0.0.1:3002',before=process.env.SCOREBOARD_BEFORE_URL,remote='http://127.0.0.1:54321';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'Content-Range','content-type':'application/json'};
const poll=async fn=>{const end=Date.now()+15000;while(!await fn()){if(Date.now()>end)throw Error('条件待ちタイムアウト');await new Promise(r=>setTimeout(r,30));}};
(async()=>{
 const f=navigationFixture(),external=[],errors=[],evidence=[];let hold=false,fail=false,release,holdVideo=false,releaseVideo,videoWrites=0;
 const seed=courts=>{
  Object.assign(f.tables.events.find(e=>e.id===noGroup),{name:'土曜パデル',court_count:courts,event_mode:'auto',status:'active'});
  f.tables.event_participants=f.tables.event_participants.filter(p=>p.event_id!==noGroup).concat(Array.from({length:20},(_,i)=>({id:id(10040+i),event_id:noGroup,profile_id:null,player_profile_id:null,participant_type:'guest',guest_name:'選手'+i,status:'active'})));
  f.tables.rounds=f.tables.rounds.filter(r=>r.event_id!==noGroup).concat({id:id(11000),event_id:noGroup,round_number:1});
  const previous=f.tables.matches.filter(m=>m.event_id===noGroup).map(m=>m.id);f.tables.match_players=f.tables.match_players.filter(p=>!previous.includes(p.match_id));f.tables.match_results=f.tables.match_results.filter(r=>!previous.includes(r.match_id));
  f.tables.matches=f.tables.matches.filter(m=>m.event_id!==noGroup).concat(Array.from({length:courts},(_,i)=>({id:id(12000+i),event_id:noGroup,round_id:id(11000),court_number:i+1,completed:false,youtube_url:null})));
  f.tables.match_players.push(...Array.from({length:courts},(_,i)=>Array.from({length:4},(_,j)=>({id:id(13000+i*4+j),match_id:id(12000+i),participant_id:id(10040+i*4+j),team:j<2?'A':'B'}))).flat());
 };
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 async function context(authenticated=true){
  const c=await browser.newContext({viewport:{width:375,height:667},hasTouch:true});c.setDefaultTimeout(10000);
  if(authenticated)await c.addInitScript(user=>{if(!location.origin.startsWith('http://127.0.0.1:300'))return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+7200,user}));},user);
  await c.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1);if([base,before].includes(url.origin))return route.continue();if(url.origin!==remote){external.push(url.origin);return route.abort();}
   const respond=(status,body)=>route.fulfill({status,headers:cors,body:JSON.stringify(body)});
   if(req.method()==='OPTIONS')return respond(200,{});if(url.pathname.startsWith('/auth/'))return respond(200,authenticated?user:null);
   if(table==='matches'&&req.method()==='PATCH'&&Object.hasOwn(req.postDataJSON()||{},'youtube_url')){videoWrites++;if(holdVideo)await new Promise(r=>releaseVideo=r);}
   if(['match_results','save_friendly_match_score'].includes(table)&&['POST','PATCH'].includes(req.method())){if(hold)await new Promise(r=>release=r);if(fail)return respond(403,{code:'42501',message:'試験用保存拒否'});}
   const response=await f.fetch(req.url(),{method:req.method(),headers:req.headers(),body:req.postData()||undefined});return route.fulfill({status:response.status,headers:{...cors,...Object.fromEntries(response.headers)},body:await response.text()});
  });c.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));return c;
 }
 const output='/tmp/padel-scoreboard-evidence';fs.mkdirSync(output,{recursive:true});
 try{
  seed(2);
  for(const [label,url]of [...(before?[['before',before]]:[]),['after',base]]){
   const c=await context(),page=await c.newPage();await page.goto(url+'/events/'+noGroup);await page.getByRole('tab',{name:'対戦',exact:true}).waitFor();await page.locator('[data-score-key]').first().waitFor();
   for(const width of [320,375,390])for(const height of [568,667,844])for(const theme of ['dark','light']){
    await page.setViewportSize({width,height});await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;scrollTo(0,0);},theme);
    await page.screenshot({path:`${output}/${label}-${width}x${height}-${theme}.png`,animations:'disabled'});
    const score=page.locator(await page.locator('[data-scoreboard-latest]').count()?'[data-scoreboard-latest] [data-score-key]':'[data-match-list="normal"] [data-score-key]'),generate=page.getByRole('button',{name:'次Round生成',exact:true}),nav=page.getByRole('navigation',{name:'下部ナビゲーション'});
    const [first,second,g,n]=await Promise.all([score.nth(0).boundingBox(),score.nth(1).boundingBox(),generate.boundingBox(),nav.boundingBox()]);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await score.first().getByRole('button').first().evaluate(el=>el.getBoundingClientRect().height>=44));
    if(label==='after'){const colors=await score.first().getByRole('button').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor.match(/[0-9.]+/g).slice(0,3).map(Number)));assert(colors[0][1]>colors[0][0]&&colors[0][1]>colors[0][2],'ペアAは緑系');assert(colors[1][2]>colors[1][0]&&colors[1][2]>colors[1][1],'ペアBは青系');}
    evidence.push({label,width,height,theme,firstScoreBottom:Math.ceil(first.y+first.height),secondScoreBottom:Math.ceil(second.y+second.height),generateBottom:Math.ceil(g.y+g.height),navigationTop:Math.floor(n.y),fits:g.y+g.height<=n.y});
   }await c.close();
  }
  fs.writeFileSync(output+'/layout.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence.filter(r=>r.theme==='dark'&&r.width===375),null,2));
  // 1〜5面と、折りたたまれたコートの未保存判定。
  const c=await context(),page=await c.newPage(),latest=()=>page.locator('[data-scoreboard-latest]'),dialog=()=>page.locator('dialog[open]').last();
  for(const courts of [1,2,3,4,5]){seed(courts);await page.goto(base+'/events/'+noGroup);await poll(async()=>await latest().locator('[data-score-key]').count()===courts);assert.equal(await latest().locator('[data-score-key]:visible').count(),Math.min(2,courts));if(courts>2){await page.getByRole('button',{name:`残り${courts-2}コートを表示`,exact:true}).click();assert.equal(await latest().locator('[data-score-key]:visible').count(),courts);}}
  hold=true;fail=true;const last=latest().locator('[data-score-key]').last();await last.getByRole('button').first().click();await dialog().getByRole('button',{name:'0',exact:true}).click();await dialog().getByRole('button',{name:'0',exact:true}).click();await poll(()=>!!release);await page.getByRole('button',{name:/コートを2面にまとめる/}).click();assert(await page.getByRole('button',{name:'次Round生成',exact:true}).isDisabled());await page.getByRole('tab',{name:'参加者',exact:true}).click();hold=false;release();await page.locator('[data-score-status]').getByText(/保存エラー/).waitFor();assert.equal(await page.locator('[data-event-score-notice]').count(),0);await page.getByRole('tab',{name:/対戦/}).click();await page.getByRole('button',{name:/残り3コートを表示/}).click();fail=false;await last.getByRole('button',{name:'再試行',exact:true}).click();await last.getByText('DRAW',{exact:true}).first().waitFor();await poll(async()=>await page.locator('[data-score-status]').count()===0);assert.equal(await page.getByText('スコアを保存しました',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'メンバー変更',exact:true}).count(),0);assert.equal(await page.getByText('メンバー変更について',{exact:true}).count(),0);
  // 長い名前はカード内で収め、数字から開いた入力画面で全文を確認できる。
  const longName='非常に長い選手名'.repeat(12);f.tables.event_participants.find(p=>p.id===id(10040)).guest_name=longName;await page.reload();await latest().locator('[data-score-key]').first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await latest().locator('[data-score-key]').first().getByRole('button').first().click();await dialog().getByText(longName,{exact:true}).waitFor();await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();
  // 同じmatchIdの入力は非表示分を含め常に1つ。拡大はDOMとReact状態を保持して配置だけ移す。
  const past=id(14000);f.tables.rounds.find(r=>r.id===id(11000)).round_number=2;f.tables.rounds.push({id:id(14001),event_id:noGroup,round_number:1});f.tables.matches.push({id:past,event_id:noGroup,round_id:id(14001),court_number:1,completed:false});f.tables.match_players.push(...Array.from({length:4},(_,j)=>({id:id(14010+j),match_id:past,participant_id:id(10040+j),team:j<2?'A':'B'})));
  await page.reload();await poll(async()=>await page.locator('[data-score-key]').count()===6);
  const unique=async()=>{const keys=await page.locator('[data-score-key]').evaluateAll(nodes=>nodes.map(n=>n.dataset.scoreKey));assert.equal(keys.length,new Set(keys).size,'同じmatchIdを二重マウントしない');assert.equal(keys.length,f.tables.matches.filter(m=>m.event_id===noGroup).length);};
  await unique();assert.equal(await page.locator('[data-match-list="normal"] [data-score-key]').count(),1);assert.equal(await latest().locator('[data-score-key]').count(),5);
  await page.evaluate(()=>window.__scoreNodes=new Map([...document.querySelectorAll('[data-score-key]')].map(n=>[n.dataset.scoreKey,n])));
  const retained=async()=>assert(await page.evaluate(()=>[...window.__scoreNodes].every(([key,node])=>node===document.querySelector(`[data-score-key="${key}"]`))),'拡大・閉じる・タブ切替で入力DOMを再生成しない');
  const firstKey=`/events/${noGroup}#${id(12000)}`,firstCard=()=>page.locator(`[data-score-key="${firstKey}"]`),firstVideo=()=>firstCard().locator('xpath=../..').locator('details');
  await firstVideo().locator('summary').click();await firstVideo().locator('input').fill('https://youtu.be/retainedDraft');await page.locator('[data-round-history] > summary').click();
  const expand=async()=>{await page.getByRole('button',{name:'全試合履歴を拡大',exact:true}).click();await page.getByRole('dialog',{name:'全試合履歴',exact:true}).waitFor();await poll(async()=>await page.locator('[data-match-list="all"] [data-score-key]').count()===6);await unique();await retained();};
  await expand();assert.equal(await firstVideo().locator('input').inputValue(),'https://youtu.be/retainedDraft');assert(await firstVideo().evaluate(n=>n.open));
  await firstCard().getByRole('button').first().click();await dialog().getByRole('button',{name:'3',exact:true}).click();await page.evaluate(()=>document.querySelector('#event-tab-results').click());assert.equal(await page.getByRole('tab',{name:'対戦',exact:true}).getAttribute('aria-selected'),'true');await unique();await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),1);await page.keyboard.press('Escape');await poll(async()=>await page.locator('dialog[open]').count()===0);await retained();assert.equal(f.tables.match_results.filter(r=>r.match_id===id(12000)).length,0);
  // 拡大内の保存失敗→閉じる→タブ切替→再試行。保存キューは一つの入力に引き継ぐ。
  await firstVideo().locator('summary').click();await expand();fail=true;await firstCard().getByRole('button').first().click();await dialog().getByRole('button',{name:'0',exact:true}).click();await dialog().getByRole('button',{name:'0',exact:true}).click();await firstCard().getByRole('button',{name:'再試行',exact:true}).waitFor();await unique();await retained();assert.equal(f.tables.match_results.filter(r=>r.match_id===id(12000)).length,0);
  await page.keyboard.press('Escape');await retained();await firstCard().getByRole('button',{name:'再試行',exact:true}).waitFor();await page.getByRole('tab',{name:'参加者',exact:true}).click();await page.locator('[data-score-status]').getByText(/保存エラー/).waitFor();await page.getByRole('tab',{name:'対戦',exact:true}).click();await retained();fail=false;await firstCard().getByRole('button',{name:'再試行',exact:true}).click();await firstCard().getByText('DRAW',{exact:true}).first().waitFor();await poll(async()=>await page.locator('[data-score-status]').count()===0);assert.equal(f.tables.match_results.filter(r=>r.match_id===id(12000)).length,1);
  // 保存済み編集・取消も拡大中の同一入力で動き、背景・×で閉じても内容は保持。
  await expand();await firstCard().getByRole('button').first().click();await dialog().getByRole('button',{name:'3',exact:true}).click();await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(f.tables.match_results.find(r=>r.match_id===id(12000)).score_a,0);
  await firstCard().getByRole('button').first().click();await dialog().getByRole('button',{name:'3',exact:true}).click();await dialog().getByRole('button',{name:'完了',exact:true}).click();await poll(()=>f.tables.match_results.find(r=>r.match_id===id(12000)).score_a===3);await poll(async()=>await page.locator('[data-score-status]').count()===0);assert.equal(f.tables.match_results.filter(r=>r.match_id===id(12000)).length,1);await page.getByRole('dialog',{name:'全試合履歴',exact:true}).getByRole('button',{name:'閉じる',exact:true}).click();await retained();
  await expand();await page.mouse.click(1,1);await poll(async()=>await page.locator('dialog[open]').count()===0);await retained();
  // 新Roundへの配置変更でも古い入力は同一DOM。試合履歴・選手・スコアは変わらない。
  const oldPlayers=JSON.stringify(f.tables.match_players.filter(p=>p.match_id===id(12000))),oldScore=JSON.stringify(f.tables.match_results.filter(r=>r.match_id===id(12000)));
  await page.getByRole('button',{name:'次Round生成',exact:true}).click();await poll(async()=>await latest().locator(`[data-score-key="${firstKey}"]`).count()===0);await retained();await unique();assert.equal(JSON.stringify(f.tables.match_players.filter(p=>p.match_id===id(12000))),oldPlayers);assert.equal(JSON.stringify(f.tables.match_results.filter(r=>r.match_id===id(12000))),oldScore);
  // 短い画面＋iPhone相当34px inset。操作領域を縮めず、必要な分だけ自然にスクロールできる。
  seed(2);await page.reload();await poll(async()=>await latest().locator('[data-score-key]').count()===2);
  await page.addStyleTag({content:'.app-bottom-navigation{padding-bottom:34px!important}body.app-navigation-active{padding-bottom:calc(var(--app-navigation-height) + 34px + 1rem)!important}body.app-navigation-active>aside[role=status]{bottom:calc(var(--app-navigation-height) + 34px + 1rem)!important}'});
  for(const width of [320,375,390])for(const height of [568,667])for(const theme of ['dark','light']){
   await page.setViewportSize({width,height});await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;scrollTo(0,0);},theme);const generate=page.getByRole('button',{name:'次Round生成',exact:true}),nav=page.getByRole('navigation',{name:'下部ナビゲーション'});await nav.waitFor();const [g,n]=await Promise.all([generate.boundingBox(),nav.boundingBox()]);await page.evaluate(delta=>scrollBy(0,Math.max(0,delta)),g.y+g.height-n.y+12);await poll(async()=>{const [gb,nb]=await Promise.all([generate.boundingBox(),nav.boundingBox()]);return gb.y>=0&&gb.y+gb.height<=nb.y-8;});assert(await generate.evaluate(n=>n.getBoundingClientRect().height>=44));assert(await latest().locator('[data-score-key]').first().getByRole('button').first().evaluate(n=>n.getBoundingClientRect().height>=44));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const [gb,nb]=await Promise.all([generate.boundingBox(),nav.boundingBox()]);evidence.push({label:'after-safe-area',width,height,theme,inset:34,scrollY:await page.evaluate(()=>scrollY),generateBottom:Math.ceil(gb.y+gb.height),navigationTop:Math.floor(nb.y),fits:gb.y+gb.height<=nb.y});await page.screenshot({path:`${output}/after-safe-area-${width}x${height}-${theme}.png`,animations:'disabled'});
   await latest().locator('[data-score-key]').first().getByRole('button').first().click();await poll(async()=>!await nav.isVisible());await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();await nav.waitFor();
  }
  // 表示の微調整。固定・履歴の矢印、標準マーカー抑止、開閉状態の保持。
  f.tables.event_video_links.push({id:id(15000),event_id:ordinary,title:'確認用動画',video_url:'https://youtu.be/listPreview',memo:null,display_order:1});
  await page.goto(base+'/events/'+ordinary);await page.getByText('開催中 · 乱数',{exact:true}).waitFor();
  const fold=key=>page.locator(`[data-${key}]`),arrow=async key=>fold(key).locator('summary > span[aria-hidden] > span').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>n.textContent).join(''));
  for(const width of [320,375,390])for(const theme of ['dark','light']){
   await page.setViewportSize({width,height:667});await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;},theme);
   for(const key of ['fixed-settings','round-history','event-videos','round-mode']){
    const details=fold(key),summary=details.locator(':scope > summary');await summary.waitFor();assert.equal(await arrow(key),'▶');assert.equal(await summary.evaluate(n=>getComputedStyle(n).listStyleType),'none');assert.equal(await summary.evaluate(n=>getComputedStyle(n).display),'flex');await summary.click();assert.equal(await arrow(key),'▼');
    const color=await summary.locator('.event-disclosure-icon').evaluate(n=>getComputedStyle(n).color);const rgb=color.match(/[0-9.]+/g).map(Number);assert(rgb[1]>rgb[0]&&rgb[1]>rgb[2]);assert.equal(color,await page.locator('[data-scoreboard-latest] .friendly-scoreboard-video .event-disclosure-icon').first().evaluate(n=>getComputedStyle(n).color));
    if(key==='event-videos')assert.equal(await details.getByRole('link',{name:'YouTubeで見る',exact:true}).getAttribute('href'),'https://youtu.be/listPreview');
    await page.getByRole('tab',{name:'参加者',exact:true}).click();await page.getByRole('tab',{name:'対戦',exact:true}).click();assert(await details.evaluate(n=>n.open));assert.equal(await arrow(key),'▼');
    if(key==='round-history'){
     const expand=page.getByRole('button',{name:'全試合履歴を拡大',exact:true});assert.equal((await expand.innerText()).trim(),'');assert.equal(await expand.locator('svg[aria-hidden="true"]').count(),1);assert(await expand.evaluate(n=>{const r=n.getBoundingClientRect();return r.height>=44&&r.width>=44;}));assert.equal(await page.getByText('一覧内をスクロールして確認',{exact:true}).count(),0);
     await page.screenshot({path:`/tmp/friendly-ui-polish-${width}-${theme}.png`,animations:'disabled'});
    }
    await summary.click();assert.equal(await arrow(key),'▶');
   }
   const video=page.locator('[data-scoreboard-latest] .friendly-scoreboard-video').first();await video.locator('summary').click();
   const close=video.getByRole('button',{name:'動画登録を閉じる',exact:true});assert(await close.evaluate(n=>{const r=n.getBoundingClientRect();return r.width>=44&&r.height>=44;}));
   const writes=videoWrites;await video.locator('input').fill('https://youtu.be/keepVideoDraft');await close.click();assert(!await video.evaluate(n=>n.open));assert.equal(videoWrites,writes);await video.locator('summary').click();assert.equal(await video.locator('input').inputValue(),'https://youtu.be/keepVideoDraft');await close.click();
   await page.getByRole('tab',{name:'結果',exact:true}).click();
   for(const label of ['勝利数ランキング','勝率ランキング','得失点差ランキング','MVP']){const button=page.getByRole('button',{name:label,exact:true}),icon=button.locator('.event-disclosure-icon');assert.equal(await icon.evaluate(n=>getComputedStyle(n).color),await fold('fixed-settings').locator('summary .event-disclosure-icon').evaluate(n=>getComputedStyle(n).color));assert.equal(await icon.innerText(),'▶');await button.click();assert.equal(await icon.innerText(),'▼');await button.click();const rgb=(await icon.evaluate(n=>getComputedStyle(n).color)).match(/[0-9.]+/g).map(Number);assert(rgb[1]>rgb[0]&&rgb[1]>rgb[2]);}
   await page.getByRole('tab',{name:'対戦',exact:true}).click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  // URLの保存/削除中は閉じる・入力・再送を防ぎ、既存の保存結果を維持。
  const video=page.locator('[data-scoreboard-latest] .friendly-scoreboard-video').first();await video.locator('summary').click();const closeVideo=()=>video.getByRole('button',{name:'動画登録を閉じる',exact:true});
  holdVideo=true;releaseVideo=null;const writesBefore=videoWrites;await video.getByRole('button',{name:'URLを保存',exact:true}).click();await poll(()=>!!releaseVideo);assert(await closeVideo().isDisabled());assert(await video.locator('input').isDisabled());assert(await video.getByRole('button',{name:'URLを保存',exact:true}).isDisabled());await video.locator('summary').evaluate(n=>n.click());assert(await video.evaluate(n=>n.open));holdVideo=false;releaseVideo();await poll(async()=>!await closeVideo().isDisabled());assert.equal(videoWrites,writesBefore+1);assert.equal(await video.getByRole('link',{name:'動画を見る',exact:true}).getAttribute('href'),'https://youtu.be/keepVideoDraft');
  holdVideo=true;releaseVideo=null;await video.getByRole('button',{name:'URLを削除',exact:true}).click();await poll(()=>!!releaseVideo);assert(await closeVideo().isDisabled());holdVideo=false;releaseVideo();await poll(async()=>!await closeVideo().isDisabled());assert.equal(await video.locator('input').inputValue(),'');await closeVideo().click();assert(!await video.evaluate(n=>n.open));
  // 矢印だけを取り除き、既存コート数ダイアログと保存は1〜5面とも維持。
  const court=()=>page.getByRole('button',{name:'利用コート数を変更',exact:true});
  for(const count of [1,2,3,4,5]){
   assert(!/[⌄▼]/.test(await court().innerText()));assert(await court().evaluate(n=>n.getBoundingClientRect().height>=44));await court().click();await dialog().getByRole('button',{name:count+'面',exact:true}).click();await dialog().getByRole('button',{name:'保存',exact:true}).click();await poll(async()=>await page.locator('dialog[open]').count()===0);assert.equal(f.tables.events.find(e=>e.id===ordinary).court_count,count);assert.match(await court().innerText(),new RegExp(count+'面'));
  }
  // 表示名だけの変更。auto/manualのDB値を維持し、終了済みでも同じ分類を使う。
  f.tables.events.find(e=>e.id===ordinary).status='closed';await page.reload();await page.getByText('終了済み · 乱数',{exact:true}).waitFor();assert.equal(f.tables.events.find(e=>e.id===ordinary).event_mode,'auto');assert.equal(await page.getByRole('tab',{name:'結果',exact:true}).getAttribute('aria-selected'),'true');
  await page.goto(base+'/events/'+manual);await page.getByText('開催中 · 手動',{exact:true}).waitFor();f.tables.events.find(e=>e.id===manual).status='closed';await page.reload();await page.getByText('終了済み · 手動',{exact:true}).waitFor();assert.equal(f.tables.events.find(e=>e.id===manual).event_mode,'manual');
  fs.writeFileSync(output+'/layout.json',JSON.stringify(evidence,null,2));await c.close();
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('動画登録×の44px・入力保持・保存/削除中の開閉抑止、固定/履歴/動画一覧/モード/結果の▶▼と両テーマの緑統一、モバイル3幅・両テーマ＋34pxセーフエリア12条件、固定/履歴の矢印・単一マーカー・開閉保持・拡大アイコン・1〜5面変更・乱数/手動/終了ヘッダー、1〜5面、二重マウント防止・同一DOM保持、拡大内の初回/修正/取消/保存失敗/再試行、次Roundの配置変更、タブ・動画入力保持を確認。本番通信なし。');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
