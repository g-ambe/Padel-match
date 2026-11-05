// 架空イベントとローカルビルドだけを使用する。比較元は同じデータで起動したmain。
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {navigationFixture,user,id,noGroup}=require('../fixtures/navigation-app.cjs');
const base=process.env.NAVIGATION_TEST_URL||'http://127.0.0.1:3002',before=process.env.SCOREBOARD_BEFORE_URL||'http://127.0.0.1:3003',remote='http://127.0.0.1:54321';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'Content-Range','content-type':'application/json'};
const poll=async fn=>{const end=Date.now()+15000;while(!await fn()){if(Date.now()>end)throw Error('条件待ちタイムアウト');await new Promise(r=>setTimeout(r,30));}};
(async()=>{
 const f=navigationFixture(),external=[],errors=[],evidence=[];let hold=false,fail=false,release;
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
   if(table==='match_results'&&['POST','PATCH'].includes(req.method())){if(hold)await new Promise(r=>release=r);if(fail)return respond(403,{code:'42501',message:'試験用保存拒否'});}
   const response=await f.fetch(req.url(),{method:req.method(),headers:req.headers(),body:req.postData()||undefined});return route.fulfill({status:response.status,headers:{...cors,...Object.fromEntries(response.headers)},body:await response.text()});
  });c.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));return c;
 }
 const output='/tmp/padel-scoreboard-evidence';fs.mkdirSync(output,{recursive:true});
 try{
  seed(2);
  for(const [label,url]of [['before',before],['after',base]]){
   const c=await context(),page=await c.newPage();await page.goto(url+'/events/'+noGroup);await page.getByRole('tab',{name:'対戦',exact:true}).waitFor();await page.locator('[data-score-key]').first().waitFor();
   for(const width of [320,375,390])for(const height of [568,667,844])for(const theme of ['dark','light']){
    await page.setViewportSize({width,height});await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;scrollTo(0,0);},theme);
    await page.screenshot({path:`${output}/${label}-${width}x${height}-${theme}.png`,animations:'disabled'});
    const score=page.locator(label==='after'?'[data-scoreboard-latest] [data-score-key]':'[data-match-list="normal"] [data-score-key]'),generate=page.getByRole('button',{name:'次Round生成',exact:true}),nav=page.getByRole('navigation',{name:'下部ナビゲーション'});
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
  assert(await latest().getByRole('button',{name:'メンバー変更',exact:true}).first().isDisabled());
  // 長い名前はカード内で収め、数字から開いた入力画面で全文を確認できる。
  const longName='非常に長い選手名'.repeat(12);f.tables.event_participants.find(p=>p.id===id(10040)).guest_name=longName;await page.reload();await latest().locator('[data-score-key]').first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await latest().locator('[data-score-key]').first().getByRole('button').first().click();await dialog().getByText(longName,{exact:true}).waitFor();await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();await c.close();
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('変更前後の36条件を実描画で比較。1〜5面・非表示コートの保存ガード・再試行・成功通知非表示・長い名前を確認。本番通信なし。');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
