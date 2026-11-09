// ローカル・合成データのみ。カード追加POPの連続選択と作成後の得点保存を重点確認。
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {navigationFixture,id,user,clubA,clubB,team}=require('../fixtures/navigation-app.cjs');
const base=process.env.NAVIGATION_TEST_URL||'http://127.0.0.1:3042',remote='http://127.0.0.1:54321';
(async()=>{
 const f=navigationFixture(),errors=[],outside=[];let failCard=false;
 const teamNames=['Wytel部活・フレンドリーチーム','パデルクラブB選抜'];
 f.tables.event_team_attendance=[{event_id:team,side:'team_a',member_id:id(870),guest_id:null,status:'absent'}];
 f.tables.event_team_sides.filter(s=>s.event_id===team).forEach((s,i)=>s.team_name=teamNames[i]);
 for(let n=0;n<18;n++){const pid=id(850+n);f.tables.player_profiles.push({id:pid,display_name:n===2?'長い選手名の表示確認・フレンドリーマッチ参加メンバー':'選手'+n,is_active:true});f.tables.club_members.push({id:id(870+n),club_id:n<3?clubA:clubB,player_profile_id:pid,profile_id:null,is_active:true,role:'member'});}
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true});
  await c.addInitScript(({base,user})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{base,user});
  await c.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin===base)return route.continue();if(url.origin!==remote){outside.push(url.origin);return route.abort();}const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};if(req.method()==='OPTIONS')return route.fulfill({status:200,headers,body:'{}'});if(url.pathname.startsWith('/auth/'))return route.fulfill({status:200,headers,body:JSON.stringify(user)});if(failCard&&url.pathname.endsWith('/event_team_matches')&&req.method()==='POST')return route.fulfill({status:403,headers,body:JSON.stringify({code:'42501',message:'合成試験の保存失敗'})});const r=await f.fetch(req.url(),{method:req.method(),headers:req.headers(),body:req.postData()||undefined});return route.fulfill({status:r.status,headers:{...headers,...Object.fromEntries(r.headers)},body:await r.text()});});
  const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/team-matches/'+team);await p.getByRole('button',{name:'試合カードを追加',exact:true}).click();
  const dialog=()=>p.locator('dialog[open]').last();
  const slot=i=>dialog().locator(`[data-player-slot="${i}"]`);
  const choose=(side,name)=>dialog().getByRole('button',{name:teamNames[side]+'の'+name+'を選択',exact:true}).click();
  const active=async i=>assert.equal(await slot(i).getAttribute('aria-pressed'),'true');
  const candidates=()=>dialog().locator('[data-player-candidates]');
  const confirmation=()=>dialog().getByRole('group',{name:'相手チームの選択確認',exact:true});
  assert.equal(await candidates().count(),0,'初期状態は候補非表示');
  assert.equal(await dialog().locator('[data-player-slot]').count(),4);
  assert.equal(await dialog().locator('[data-score-key],select,input[placeholder="詳細スコア"]').count(),0,'新規追加中は得点欄なし');
  await slot(1).click();await choose(0,'本人');await active(0); // A2からA1へ
  assert.equal(await dialog().getByRole('button',{name:teamNames[0]+'の選手0を選択',exact:true}).count(),0,'欠席者は候補なし');
  assert(await dialog().getByRole('button',{name:teamNames[0]+'の本人を選択',exact:true}).isDisabled(),'他枠と重複不可');
  await choose(0,'選手1');await confirmation().waitFor();
  assert.equal(await p.locator('dialog[open]').count(),1,'確認モーダルを重ねない');
  await confirmation().getByRole('button',{name:'あとで',exact:true}).click();assert.equal(await candidates().count(),0);
  await slot(0).click();await choose(0,'選手1');await active(0); // 同じ候補で解除
  assert(await slot(0).getByText('＋ 選手を選択',{exact:true}).isVisible());
  await choose(0,'選手1');assert.equal(await confirmation().count(),0,'同じ確認を繰り返さない');
  await slot(0).click();await choose(0,'長い選手名の表示確認・フレンドリーマッチ参加メンバー');await active(0);
  assert(await slot(1).getByText('本人',{exact:true}).isVisible(),'変更で相方を変えない');
  for(const theme of ['dark','light']){
   await p.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;},theme);
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'375pxで横スクロールなし');
   assert.equal(await slot(0).evaluate(el=>getComputedStyle(el).outlineStyle),'none','選択中の二重枠なし');
  }
  await dialog().getByRole('button',{name:'選手候補を閉じる',exact:true}).click();assert.equal(await candidates().count(),0);
  assert(await slot(0).getByText('長い選手名の表示確認・フレンドリーマッチ参加メンバー',{exact:true}).isVisible());
  await slot(2).click();await p.setViewportSize({width:375,height:568});assert(await candidates().evaluate(el=>el.scrollHeight>el.clientHeight),'多数候補は候補一覧内でスクロール');const addBox=await dialog().getByRole('button',{name:'追加',exact:true}).boundingBox();assert(addBox&&addBox.y>=0&&addBox.y+addBox.height<=568,'短い375px画面でも追加ボタンへ到達可能');await p.setViewportSize({width:375,height:812});assert(await dialog().getByRole('button',{name:teamNames[1]+'の本人を選択',exact:true}).isDisabled(),'チーム間でも重複不可');
  await choose(1,'選手3');await active(3);
  await slot(0).click();await choose(0,'長い選手名の表示確認・フレンドリーマッチ参加メンバー');await active(0);
  await slot(3).click();await choose(1,'選手4');await active(0); // 相手が一部選択済みなら残りへ
  await choose(0,'選手1');await dialog().getByText('4/4名 · 追加してください',{exact:true}).waitFor();
  assert.equal(await candidates().count(),0);assert.equal(await confirmation().count(),0);
  await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();
  assert.equal(f.tables.event_team_matches.length,0,'キャンセルでは登録しない');
  await p.reload();await p.getByRole('button',{name:'試合カードを追加',exact:true}).click();
  await slot(3).click();await choose(1,'選手4');await active(2); // B2からB1へ
  await choose(1,'選手3');await confirmation().waitFor();
  await confirmation().getByRole('button',{name:'選択する',exact:true}).click();await active(0);
  await choose(0,'本人');await active(1);await choose(0,'選手1');
  await dialog().getByText('4/4名 · 追加してください',{exact:true}).waitFor();
  failCard=true;await dialog().getByRole('button',{name:'追加',exact:true}).click();
  await dialog().getByRole('alert').getByText('試合カードの保存に失敗しました',{exact:true}).waitFor();
  assert.equal(f.tables.event_team_matches.length,0);assert(await slot(0).getByText('本人',{exact:true}).isVisible(),'失敗時も選択を保持');
  failCard=false;await dialog().getByRole('button',{name:'追加',exact:true}).click();
  const card=p.locator('[data-team-match-mount]');await card.waitFor();
  assert.equal(f.tables.event_team_matches.length,1);const saved=f.tables.event_team_matches[0];
  assert.equal(saved.team_a_player1_profile_id,id(20));assert.equal(saved.team_a_player2_profile_id,id(851));
  assert.equal(saved.team_b_player1_profile_id,id(853));assert.equal(saved.team_b_player2_profile_id,id(854));
  assert.equal(await card.locator('[data-score-key]').count(),1,'作成済みカードのスコアは単一描画');
  await card.locator('[data-score-key] > div button').first().click();
  await dialog().getByRole('button',{name:'4',exact:true}).click();await dialog().getByRole('button',{name:'2',exact:true}).click();
  await card.getByRole('button',{name:/の得点を入力：4/}).waitFor();
  assert.equal(saved.team_a_score,4);assert.equal(saved.team_b_score,2);assert.equal(f.tables.event_team_matches.length,1);
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
  console.log('初期候補非表示・再タップ解除・A2/B2からの遷移・相手確認（選択する/あとで）・部分選択/変更・4名追加/失敗保持/取消・欠席/重複除外・単一スコア保存・375px両テーマ：成功（合成データ）');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
