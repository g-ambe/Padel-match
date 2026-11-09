// ローカル・合成データのみ。カード追加POPの連続選択と作成後の得点保存を重点確認。
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {navigationFixture,id,user,clubA,clubB,team}=require('../fixtures/navigation-app.cjs');
const base=process.env.NAVIGATION_TEST_URL||'http://127.0.0.1:3042',remote='http://127.0.0.1:54321';
(async()=>{
 const f=navigationFixture(),errors=[],outside=[];
 const teamNames=['Wytel部活・フレンドリーチーム','パデルクラブB選抜'];
 f.tables.event_team_attendance=[{event_id:team,side:'team_a',member_id:id(870),guest_id:null,status:'absent'}];
 f.tables.event_team_sides.filter(s=>s.event_id===team).forEach((s,i)=>s.team_name=teamNames[i]);
 for(let n=0;n<6;n++){const pid=id(850+n);f.tables.player_profiles.push({id:pid,display_name:n===2?'長い選手名の表示確認・フレンドリーマッチ参加メンバー':'選手'+n,is_active:true});f.tables.club_members.push({id:id(870+n),club_id:n<3?clubA:clubB,player_profile_id:pid,profile_id:null,is_active:true,role:'member'});}
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true});
  await c.addInitScript(({base,user})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{base,user});
  await c.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin===base)return route.continue();if(url.origin!==remote){outside.push(url.origin);return route.abort();}const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};if(req.method()==='OPTIONS')return route.fulfill({status:200,headers,body:'{}'});if(url.pathname.startsWith('/auth/'))return route.fulfill({status:200,headers,body:JSON.stringify(user)});const r=await f.fetch(req.url(),{method:req.method(),headers:req.headers(),body:req.postData()||undefined});return route.fulfill({status:r.status,headers:{...headers,...Object.fromEntries(r.headers)},body:await r.text()});});
  const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/team-matches/'+team);await p.getByRole('button',{name:'試合カードを追加',exact:true}).click();
  const dialog=()=>p.locator('dialog[open]').last();
  const slot=i=>dialog().locator(`[data-player-slot="${i}"]`);
  const choose=(side,name)=>dialog().getByRole('button',{name:teamNames[side]+'の'+name+'を選択',exact:true}).click();
  const active=async i=>assert.equal(await slot(i).getAttribute('aria-pressed'),'true');
  await active(0);assert.equal(await dialog().locator('[data-score-key],select,input[placeholder="詳細スコア"]').count(),0,'新規追加中は得点欄なし');
  assert.equal(await dialog().getByRole('button',{name:teamNames[0]+'の選手0を選択',exact:true}).count(),0,'欠席者は候補なし');
  await choose(0,'本人');await active(1);
  assert(await dialog().getByRole('button',{name:teamNames[0]+'の本人を選択',exact:true}).isDisabled(),'同じチーム内の重複不可');
  await slot(0).click();await dialog().getByRole('button',{name:'選択を解除',exact:true}).click();await active(0);
  assert(await slot(0).getByText('＋ 選手を選択',{exact:true}).isVisible());
  await choose(0,'本人');await active(1);await choose(0,'選手1');await active(2);
  assert(await dialog().getByRole('button',{name:teamNames[1]+'の本人を選択',exact:true}).isDisabled(),'チーム間の重複不可');
  await choose(1,'選手3');await active(3);await choose(1,'選手4');
  await dialog().getByText('4/4名 · 追加してください',{exact:true}).waitFor();
  assert.equal(await p.locator('dialog[open]').count(),1,'4名選択までPOPを閉じない');
  await slot(3).click();await choose(1,'選手5');assert(await slot(3).getByText('選手5',{exact:true}).isVisible(),'選択完了後も変更可能');
  await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();
  assert.equal(await p.locator('dialog[open]').count(),0);assert.equal(f.tables.event_team_matches.length,0,'キャンセルでカードを作らない');
  await p.getByRole('button',{name:'試合カードを追加',exact:true}).click();
  // キャンセル後も元の入力は維持。枠を指定して再選択し、追加を明示的に確定する。
  await active(0);await choose(0,'本人');await slot(1).click();await choose(0,'選手1');
  await slot(2).click();await choose(1,'選手3');await slot(3).click();await choose(1,'選手4');
  await dialog().getByRole('button',{name:'追加',exact:true}).click();
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
  console.log('連続4名選択・途中変更/解除・キャンセル未作成・欠席/重複除外・得点欄非表示・追加後の単一スコア保存：成功（375px・合成データ）');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
