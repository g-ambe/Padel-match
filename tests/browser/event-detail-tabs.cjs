// ローカルビルドと架空データ専用。本番APIへの通信・実データの変更は行わない。
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {navigationFixture,user,id,clubA,ordinary,manual,noGroup,match,newMatch}=require('../fixtures/navigation-app.cjs');
const base=process.env.NAVIGATION_TEST_URL||'http://127.0.0.1:3002',remote='http://127.0.0.1:54321';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'Content-Range','content-type':'application/json'};
const poll=async(fn,label='条件待ち')=>{const end=Date.now()+15000;while(!await fn()){if(Date.now()>end)throw Error(label+'がタイムアウトしました');await new Promise(r=>setTimeout(r,30));}};
(async()=>{
 const f=navigationFixture(),errors=[],external=[],writes=[];
 f.tables.club_members[0].role='sub_admin';
 for(let i=4;i<6;i++)f.tables.event_participants.push({id:id(40+i),event_id:ordinary,player_profile_id:null,profile_id:null,participant_type:'guest',guest_name:'ゲスト'+(i-1),status:'active'});
 const ordinaryIds=f.tables.event_participants.filter(p=>p.event_id===ordinary).map(p=>p.id);
 const seedPeople=(event,start)=>Array.from({length:6},(_,i)=>{const p={id:id(start+i),event_id:event,player_profile_id:null,profile_id:null,participant_type:'guest',guest_name:'選手'+i,status:'active'};f.tables.event_participants.push(p);return p.id;});
 const manualIds=seedPeople(manual,240),noGroupIds=seedPeople(noGroup,340);
 const seedHistory=(event,people,start,count)=>{for(let i=0;i<count;i++){
  const round={id:id(start+i),event_id:event,round_number:i+1},m={id:id(start+100+i),event_id:event,round_id:round.id,court_number:1,completed:true};
  f.tables.rounds.push(round);f.tables.matches.push(m);f.tables.match_players.push(...people.slice(0,4).map((participant_id,j)=>({id:id(start+200+i*4+j),match_id:m.id,participant_id,team:j<2?'A':'B'})));f.tables.match_results.push({id:id(start+400+i),match_id:m.id,score_a:4,score_b:2,winner_team:'A'});
 }};
 seedHistory(ordinary,ordinaryIds,10000,10);seedHistory(noGroup,noGroupIds,20000,10);
 let holdScore=false,failScore=false,releaseScore,holdStatus=false,releaseStatus,statusFailure='',failReadback=false,failEvent=false,holdParticipantRead=false,releaseParticipantRead;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 async function context(authenticated){
  const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});c.setDefaultTimeout(10000);
  if(authenticated)await c.addInitScript(({user,base})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{user,base});
  await c.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),method=req.method();
   if(url.origin===base)return route.continue();if(url.origin!==remote){external.push(url.origin);return route.abort();}
   const answer=(status,body)=>route.fulfill({status,headers:cors,body:JSON.stringify(body)});
   if(method==='OPTIONS')return answer(200,{});
   if(url.pathname.startsWith('/auth/'))return answer(200,authenticated?user:null);
   if(!url.pathname.includes('/rpc/')&&['POST','PATCH','DELETE'].includes(method))writes.push({table,method,body:JSON.parse(req.postData()||'null')});
   if(table==='get_event_fixed_pair_state')return answer(200,{event_id:ordinary,revision:0,used_fixed_pairs:false,pairs:[],eligible_rounds:[{round:10,eligible:ordinaryIds,played:ordinaryIds.slice(0,4)}]});
   if(table==='match_results'&&['POST','PATCH'].includes(method)){
    if(holdScore)await new Promise(r=>releaseScore=r);
    if(failScore)return answer(403,{code:'42501',message:'試験用スコア保存拒否'});
   }
   if(table==='event_participants'&&method==='PATCH'){
    if(holdStatus)await new Promise(r=>releaseStatus=r);
    if(statusFailure==='denied')return answer(403,{code:'42501',message:'試験用参加状態拒否'});
    if(statusFailure==='zero')return answer(200,[]);
   }
   if(table==='event_participants'&&method==='GET'&&url.searchParams.get('select')==='id,event_id,status'&&failReadback){failReadback=false;return answer(403,{code:'42501',message:'試験用再取得拒否'});}
   if(table==='events'&&method==='PATCH'&&failEvent)return answer(403,{code:'42501',message:'試験用開催更新拒否'});
   const response=await f.fetch(req.url(),{method,headers:req.headers(),body:req.postData()||undefined});
   if(holdParticipantRead&&table==='event_participants'&&method==='GET'&&url.searchParams.get('select')?.includes('guest_name,status'))await new Promise(r=>releaseParticipantRead=r);
   return route.fulfill({status:response.status,headers:{...cors,...Object.fromEntries(response.headers)},body:await response.text()});
  });
  c.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));return c;
 }
 try{
  const c=await context(true),page=await c.newPage();
  const tab=name=>page.getByRole('tab',{name,exact:true}),panel=name=>page.getByRole('tabpanel',{name,exact:true}),dialog=()=>page.locator('dialog[open]').last();
  const nav=()=>page.getByRole('navigation',{name:'下部ナビゲーション'});
  const card=mid=>panel('対戦').locator(`[data-score-key$="#${mid}"]:visible`).first();
  const row=pid=>panel('参加者').locator(`[data-participant-id="${pid}"]`);
  const expectTab=async name=>poll(async()=>await tab(name).getAttribute('aria-selected')==='true','初期・切替タブ');
  await page.goto(base+'/events/'+ordinary);await expectTab('対戦');await page.locator('[data-round-history] > summary').click();await card(newMatch).waitFor();
  // 初回0-0の自動保存。片方の数字入力中はモーダルがタブ切替を保護する。
  const beforeScores=writes.filter(w=>w.table==='match_results').length;
  holdScore=true;failScore=true;await card(newMatch).getByRole('button').first().click();await dialog().getByRole('button',{name:'0',exact:true}).click();
  await page.evaluate(()=>document.querySelector('#event-tab-participants').click());await expectTab('対戦');assert.equal(writes.filter(w=>w.table==='match_results').length,beforeScores);
  await dialog().getByRole('button',{name:'0',exact:true}).click();await poll(()=>!!releaseScore);await nav().waitFor();
  await tab('参加者').click();await tab('結果').click();await page.locator('[data-score-status]').waitFor();assert.equal(f.tables.matches.find(m=>m.id===newMatch).completed,false);
  holdScore=false;releaseScore();await poll(async()=>await page.locator('#event-panel-matches').getByRole('button',{name:'再試行',exact:true,includeHidden:true}).count()>0);
  assert.equal(f.tables.match_results.filter(r=>r.match_id===newMatch).length,0);
  await tab('対戦').click();failScore=false;await card(newMatch).getByRole('button',{name:'再試行',exact:true}).click();await card(newMatch).getByText('DRAW',{exact:true}).first().waitFor();
  assert.equal(f.tables.match_results.filter(r=>r.match_id===newMatch).length,1);
  // 保存済みスコアは編集確定まで送信しない。取消で元の0-0を維持する。
  const savedCount=writes.filter(w=>w.table==='match_results').length;
  await card(newMatch).getByRole('button').first().click();await dialog().getByRole('button',{name:'3',exact:true}).click();await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(writes.filter(w=>w.table==='match_results').length,savedCount);
  assert.equal(f.tables.match_results.find(r=>r.match_id===newMatch).score_a,0);
  await card(newMatch).getByRole('button').first().click();await dialog().getByRole('button',{name:'キーボードで入力'}).click();await dialog().locator('input').nth(0).fill('2');await dialog().locator('input').nth(1).fill('2');await dialog().getByRole('button',{name:'完了',exact:true}).click();await poll(()=>f.tables.match_results.find(r=>r.match_id===newMatch).score_a===2);await poll(async()=>await page.locator('[data-score-status]').count()===0);
  // YouTubeの入力・折りたたみと全体動画の編集を保持。タブ切替だけでは書き込まない。
  const youtube=card(match).locator('xpath=../..').locator('details');await youtube.locator('summary').click();await youtube.locator('input').fill('https://youtu.be/abcdefghijk');
  await page.locator('[data-event-videos] > summary').click();
  const video=panel('対戦').getByPlaceholder('全試合動画',{exact:true});await video.fill('編集中の開催動画');
  const beforeTabs=writes.length;await tab('参加者').click();await tab('結果').click();await tab('対戦').click();assert.equal(writes.length,beforeTabs);assert.equal(await youtube.locator('input').inputValue(),'https://youtu.be/abcdefghijk');assert(await youtube.evaluate(e=>e.open));assert.equal(await video.inputValue(),'編集中の開催動画');
  await youtube.getByRole('button',{name:'URLを保存',exact:true}).click();await poll(()=>f.tables.matches.find(m=>m.id===match).youtube_url==='https://youtu.be/abcdefghijk');
  const videoBox=video.locator('..');await videoBox.getByPlaceholder('https://www.youtube.com/watch?v=...',{exact:true}).fill('https://youtu.be/abcdefghijk');await videoBox.getByRole('button',{name:'保存',exact:true}).click();await poll(()=>f.tables.event_video_links.length===1);
  await panel('対戦').getByRole('button',{name:'全試合履歴を拡大'}).click();await dialog().waitFor();await poll(async()=>!await nav().isVisible());await dialog().locator('[data-score-key]').first().getByRole('button').first().click();await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();await page.keyboard.press('Escape');await nav().waitFor();
  // 参加状態：連打・0件・RLS拒否・確認失敗を区別し、他の履歴・設定を変更しない。
  await tab('参加者').click();await row(ordinaryIds[4]).getByText('直近Round 10 の自動休憩',{exact:true}).waitFor();
  const guestNameRow=row(ordinaryIds[5]);await guestNameRow.getByRole('button',{name:'編集',exact:true}).click();await guestNameRow.locator('input').fill('編集中のゲスト名');await tab('結果').click();await tab('参加者').click();assert.equal(await guestNameRow.locator('input').inputValue(),'編集中のゲスト名');await guestNameRow.getByRole('button',{name:'保存',exact:true}).click();await guestNameRow.getByText('編集中のゲスト名',{exact:true}).waitFor();
  const historyBefore=JSON.stringify([f.tables.matches,f.tables.match_players,f.tables.match_results]);
  holdStatus=true;const statusCount=writes.filter(w=>w.table==='event_participants'&&w.method==='PATCH').length;
  await row(ordinaryIds[4]).locator('button[aria-pressed]').click();await poll(()=>!!releaseStatus);await row(ordinaryIds[4]).locator('button[aria-pressed]').evaluate(el=>el.click());assert.equal(writes.filter(w=>w.table==='event_participants'&&w.method==='PATCH').length,statusCount+1);assert.equal(await row(ordinaryIds[4]).locator('[data-participant-status]').getAttribute('data-participant-status'),'active');
  await tab('対戦').click();assert(await panel('対戦').getByRole('button',{name:'次Round生成',exact:true}).isDisabled());holdStatus=false;releaseStatus();await tab('参加者').click();await row(ordinaryIds[4]).getByText('休憩中（手動）',{exact:true}).waitFor();await row(ordinaryIds[4]).getByText('直近Round 10 の自動休憩',{exact:true}).waitFor();
  await row(ordinaryIds[4]).locator('button[aria-pressed]').click();await row(ordinaryIds[4]).getByText('参加中',{exact:true}).waitFor();
  assert.equal(await row(ordinaryIds[4]).getByRole('button',{name:/参加状態を変更/}).count(),0);
  f.tables.event_participants.find(p=>p.id===ordinaryIds[4]).status='absent';await page.reload();await expectTab('対戦');await page.locator('[data-round-history] > summary').click();await tab('参加者').click();await row(ordinaryIds[4]).getByText('欠席',{exact:true}).waitFor();assert.equal(await row(ordinaryIds[4]).locator('button[aria-pressed]').count(),0);await row(ordinaryIds[4]).getByRole('button',{name:'参加に戻す',exact:true}).click();await row(ordinaryIds[4]).getByText('参加中',{exact:true}).waitFor();
  // 既存の再読み込みが遅れて届いても、その間に保存した参加状態へ戻さない。
  const videoReads=f.calls.filter(call=>call.table==='event_video_links').length;
  holdParticipantRead=true;await tab('対戦').click();await youtube.locator('summary').click();await youtube.getByRole('button',{name:'URLを保存',exact:true}).click();await poll(()=>!!releaseParticipantRead);
  await tab('参加者').click();await row(ordinaryIds[4]).locator('button[aria-pressed]').click();await row(ordinaryIds[4]).getByText('休憩中（手動）',{exact:true}).waitFor();holdParticipantRead=false;releaseParticipantRead();await poll(()=>f.calls.filter(call=>call.table==='event_video_links').length>videoReads);await row(ordinaryIds[4]).getByText('休憩中（手動）',{exact:true}).waitFor();
  await row(ordinaryIds[4]).locator('button[aria-pressed]').click();await row(ordinaryIds[4]).getByText('参加中',{exact:true}).waitFor();
  for(const failure of ['zero','denied','readback']){
   statusFailure=failure;failReadback=failure==='readback';await row(ordinaryIds[4]).locator('button[aria-pressed]').click();await page.getByRole('alert').filter({hasText:/参加状態/}).waitFor();assert.equal(await row(ordinaryIds[4]).locator('[data-participant-status]').getAttribute('data-participant-status'),'active');
   await tab('結果').click();await page.getByRole('alert').filter({hasText:/参加状態/}).waitFor();statusFailure='';await page.getByRole('button',{name:'参加状態を再読み込み'}).click();await poll(async()=>await page.getByRole('button',{name:'参加状態を再読み込み'}).count()===0);await tab('参加者').click();
   if(failure==='readback'){await row(ordinaryIds[4]).getByText('休憩中（手動）',{exact:true}).waitFor();await row(ordinaryIds[4]).locator('button[aria-pressed]').click();await row(ordinaryIds[4]).getByText('参加中',{exact:true}).waitFor();}
  }
  assert.equal(JSON.stringify([f.tables.matches,f.tables.match_players,f.tables.match_results]),historyBefore);
  // モバイル3幅・両テーマ。全タブで横溢れ・タップ領域・下部ナビを確認。
  await row(ordinaryIds[4]).locator('button[aria-pressed]').click();await row(ordinaryIds[4]).getByText('休憩中（手動）',{exact:true}).waitFor();
  for(const width of [320,375,390])for(const theme of ['dark','light'])for(const name of ['対戦','参加者','結果']){
   await page.setViewportSize({width,height:844});await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;},theme);await tab(name).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await tab(name).evaluate(el=>el.getBoundingClientRect().height>=44));await nav().waitFor();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`/tmp/event-tabs-${width}-${theme}-${name}.png`,animations:'disabled'});
  }
  // 手動Roundの編成中と組み合わせ編集を、タブをまたいで保持する。
  await page.goto(base+'/events/'+manual);await expectTab('対戦');const draft=panel('対戦').getByRole('heading',{name:'手動で試合を作成',exact:true}).locator('..');
  const selects=draft.getByRole('combobox');for(let i=0;i<4;i++)await selects.nth(i).selectOption(manualIds[i]);await tab('参加者').click();await tab('結果').click();await tab('対戦').click();for(let i=0;i<4;i++)assert.equal(await selects.nth(i).inputValue(),manualIds[i]);
  await draft.getByRole('button',{name:'Roundを作成',exact:true}).click();await poll(()=>f.tables.matches.some(m=>m.event_id===manual));const manualMatch=f.tables.matches.find(m=>m.event_id===manual).id;
  await panel('対戦').getByRole('button',{name:'組み合わせ編集',exact:true}).click();const lineup=panel('対戦').locator('[data-scoreboard-latest]').getByRole('combobox');await lineup.nth(0).selectOption(manualIds[4]);await tab('参加者').click();await tab('対戦').click();assert.equal(await lineup.nth(0).inputValue(),manualIds[4]);
  const manualInput=await lineup.nth(0).elementHandle();await page.locator('[data-round-history] > summary').click();await panel('対戦').getByRole('button',{name:'全試合履歴を拡大',exact:true}).click();
  const expandedLineup=page.locator('[data-match-list="all"]').getByRole('combobox');await expandedLineup.nth(0).waitFor();assert.equal(await expandedLineup.nth(0).inputValue(),manualIds[4]);assert(await expandedLineup.nth(0).evaluate((node,original)=>node===original,manualInput));assert.equal(await page.locator('[data-score-key]').count(),1);await page.keyboard.press('Escape');assert(await lineup.nth(0).evaluate((node,original)=>node===original,manualInput));
  await panel('対戦').locator('[data-scoreboard-latest]').getByRole('button',{name:'保存',exact:true}).click();await poll(()=>f.tables.match_players.some(p=>p.match_id===manualMatch&&p.participant_id===manualIds[4]));
  await card(manualMatch).getByRole('button').first().click();await dialog().getByRole('button',{name:'0',exact:true}).click();await dialog().getByRole('button',{name:'0',exact:true}).click();await card(manualMatch).getByText('DRAW',{exact:true}).first().waitFor();
  await panel('対戦').getByRole('button',{name:'イベント終了',exact:true}).click();await dialog().getByRole('radio',{name:'記録用として保存する',exact:true}).check();await dialog().getByRole('button',{name:'終了する',exact:true}).click();await expectTab('結果');assert.equal(f.tables.events.find(e=>e.id===manual).stats_mode,'record_only');await panel('結果').getByRole('button',{name:'イベント再開',exact:true}).click();await expectTab('対戦');
  // グループなし・各モードの連続生成、終了失敗時のタブ、成功時と再読込・再開。
  await page.goto(base+'/events/'+noGroup);await expectTab('対戦');
  for(const mode of ['通常モード','バランスペア','ライバル対決']){
   await panel('対戦').locator('[data-round-mode] summary').click();const radio=panel('対戦').getByRole('radio',{name:new RegExp(mode)});await radio.check();
   for(let i=0;i<2;i++){const count=f.tables.rounds.filter(r=>r.event_id===noGroup).length;await panel('対戦').getByRole('button',{name:'次Round生成',exact:true}).click();await poll(()=>f.tables.rounds.filter(r=>r.event_id===noGroup).length===count+1);await poll(async()=>await panel('対戦').getByRole('button',{name:'次Round生成',exact:true}).isEnabled());assert(await radio.isChecked());}await panel('対戦').locator('[data-round-mode] summary').click();
  }
  await page.locator('[data-round-history] > summary').click();await tab('参加者').click();assert(await panel('参加者').getByText(/当時の参加状態は未記録/).count()>0);assert.equal(await panel('参加者').getByText(/^直近Round .* の自動休憩$/).count(),0);assert(f.tables.event_participants.filter(p=>p.event_id===noGroup).every(p=>p.status==='active'));await tab('対戦').click();
  failEvent=true;await panel('対戦').getByRole('button',{name:'イベント終了',exact:true}).click();await dialog().getByRole('button',{name:'終了する',exact:true}).click();await page.getByRole('alert').filter({hasText:'イベントの終了に失敗'}).waitFor();await expectTab('対戦');assert.equal(f.tables.events.find(e=>e.id===noGroup).status,'active');
  failEvent=false;await dialog().getByRole('button',{name:'終了する',exact:true}).click();await expectTab('結果');await page.reload();await expectTab('結果');await tab('対戦').click();await page.locator('[data-round-history] > summary').click();assert(await card(f.tables.matches.find(m=>m.event_id===noGroup).id).getByRole('button').first().isDisabled());await tab('参加者').click();assert(await row(noGroupIds[0]).locator('button[aria-pressed]').isDisabled());await tab('結果').click();
  await panel('結果').getByRole('button',{name:'共有リンクを作成',exact:true}).click();await poll(()=>!!f.tables.events.find(e=>e.id===noGroup).share_token);
  failEvent=true;await panel('結果').getByRole('button',{name:'イベント再開',exact:true}).click();await page.getByRole('alert').filter({hasText:'イベントの再開に失敗'}).waitFor();await expectTab('結果');failEvent=false;await panel('結果').getByRole('button',{name:'イベント再開',exact:true}).click();await expectTab('対戦');
  f.tables.events.find(e=>e.id===noGroup).created_by_auth_user_id=id(999);await page.reload();await expectTab('対戦');await tab('参加者').click();assert(await row(noGroupIds[0]).locator('button[aria-pressed]').isDisabled());assert.equal(await row(noGroupIds[0]).getByRole('button',{name:/参加状態を変更/}).count(),0);f.tables.events.find(e=>e.id===noGroup).created_by_auth_user_id=user.id;
  await c.close();
  // ゲストも同じタブ。自動・手動、状態変更、通常ナビでの一時データ保持を確認。
  const g=await context(false),gp=await g.newPage();await gp.goto(base+'/login');
  await gp.evaluate(()=>{sessionStorage.setItem('padel_guest_mode_v1','1');sessionStorage.setItem('padel_guest_events_v1',JSON.stringify(['auto','manual'].map(mode=>({id:'guest_tabs_'+mode,name:'ゲスト'+mode,event_mode:mode,stats_mode:mode==='manual'?'undecided':'official',status:'active',court_count:1,created_at:new Date().toISOString(),matches:[],participants:Array.from({length:5},(_,i)=>({id:'g'+i,guest_name:'ゲスト'+i,participant_type:'guest',status:'active'}))}))));});
  for(const mode of ['auto','manual']){
   await gp.goto(base+'/events/guest_tabs_'+mode);await gp.getByRole('tab',{name:'参加者',exact:true}).click();const guestRow=gp.locator('[data-participant-id="g4"]');await guestRow.locator('button[aria-pressed]').click();await guestRow.getByText('休憩中（手動）',{exact:true}).waitFor();await gp.evaluate(mode=>{const all=JSON.parse(sessionStorage.getItem('padel_guest_events_v1'));all.find(e=>e.id==='guest_tabs_'+mode).participants[4].status='absent';sessionStorage.setItem('padel_guest_events_v1',JSON.stringify(all));},mode);await gp.reload();await gp.getByRole('tab',{name:'参加者',exact:true}).click();await guestRow.getByText('欠席',{exact:true}).waitFor();await guestRow.getByRole('button',{name:'参加に戻す',exact:true}).click();await guestRow.getByText('参加中',{exact:true}).waitFor();await gp.getByRole('tab',{name:'対戦',exact:true}).click();
   if(mode==='manual'){const box=gp.getByRole('heading',{name:'手動で試合を作成',exact:true}).locator('..');for(let i=0;i<4;i++)await box.getByRole('combobox').nth(i).selectOption('g'+i);await box.getByRole('button',{name:'Roundを作成',exact:true}).click();}else await gp.getByRole('button',{name:'次Round生成',exact:true}).click();
   const score=gp.locator('[data-scoreboard-latest] [data-score-key]').first();await score.getByRole('button').first().click();await gp.locator('dialog[open]').getByRole('button',{name:'0',exact:true}).click();await gp.locator('dialog[open]').getByRole('button',{name:'0',exact:true}).click();await score.getByText('DRAW',{exact:true}).first().waitFor();await gp.getByRole('button',{name:'イベント終了',exact:true}).click();await gp.locator('dialog[open]').getByRole('button',{name:'終了する',exact:true}).click();await poll(async()=>await gp.getByRole('tab',{name:'結果',exact:true}).getAttribute('aria-selected')==='true');await gp.getByRole('button',{name:'イベント再開',exact:true}).click();await poll(async()=>await gp.getByRole('tab',{name:'対戦',exact:true}).getAttribute('aria-selected')==='true');
  }
  const guestBefore=await gp.evaluate(()=>sessionStorage.getItem('padel_guest_events_v1'));await gp.getByRole('navigation',{name:'下部ナビゲーション'}).getByRole('link',{name:'試合',exact:true}).click();await gp.getByRole('heading',{name:/開催中の試合/}).waitFor();assert.equal(await gp.evaluate(()=>sessionStorage.getItem('padel_guest_events_v1')),guestBefore);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('3タブ初期状態・切替・入力保持、0点と自動保存/編集/取消/再試行、参加/休憩/欠席/復帰と連打/拒否/0件/再取得失敗、自動休憩表示、手動Round/編成編集、全モード連続生成、動画、終了/再開/共有、ゲスト/グループなし、320/375/390px両テーマを確認。本番通信なし。');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
