// ローカルビルド専用。Playwright/Chromiumがある環境で実行する。本番APIへ接続しない。
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {fixedPairDatabase,id}=require('../fixtures/fixed-pair-db.cjs');
const {database}=require('../fixtures/stats-helpers.cjs');
const base='http://127.0.0.1:3002',remote='http://127.0.0.1:54321';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'Content-Range','content-type':'application/json'};
const poll=async(fn)=>{const until=Date.now()+15000;while(!await fn()){if(Date.now()>until)throw Error('条件待ちがタイムアウトしました');await new Promise(r=>setTimeout(r,30));}};
(async()=>{
 const f=await fixedPairDatabase(),{db,as,rpc}=f,e=await f.event(800,6);
 // グループの既存在籍者を登録済みにして、通常の自動追加対象と一致させる。
 for(let i=0;i<3;i++)await db.query("update event_participants set participant_type='member',player_profile_id=$2,profile_id=$3,guest_name=null where id=$1",[e.participants[i],id(101+i),id(1+i)]);
 // 解放済みの通常イベントを再現する。固定の利用履歴とは別の、適用前の架空の試合。
 for(let n=1;n<=10;n++){
  const rid=id(800000+n),mid=id(810000+n);await db.query('insert into rounds(id,event_id,round_number) values($1,$2,$3)',[rid,e.eid,n]);await db.query('insert into matches(id,event_id,round_id,court_number,completed) values($1,$2,$3,1,true)',[mid,e.eid,rid]);for(let j=0;j<4;j++)await db.query('insert into match_players(match_id,participant_id,team) values($1,$2,$3)',[mid,e.participants[j],j<2?'A':'B']);await db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,4,2,'A')",[mid]);
 }
 const tables={};const refresh=async()=>{await db.exec('reset role');for(const t of ['events','event_participants','rounds','matches','match_players','match_results','profiles','player_profiles','clubs','club_members','app_admins'])tables[t]=(await db.query('select * from public.'+t)).rows;};await refresh();tables.user_preferences=[{auth_user_id:id(3),theme_mode:'dark'}];
 const mock=database(tables),user={id:id(3),email:'user3@example.invalid',role:'authenticated',aud:'authenticated',user_metadata:{},app_metadata:{}};
 const args={get_event_fixed_pair_state:b=>[b.p_event_id,b.p_include_history],replace_event_fixed_pairs:b=>[b.p_event_id,b.p_expected_revision,JSON.stringify(b.p_pairs),b.p_request_id],create_fixed_pair_round:b=>[b.p_event_id,b.p_expected_revision,b.p_last_round,b.p_court_count,b.p_mode,b.p_active_ids,JSON.stringify(b.p_matches),b.p_request_id],finish_fixed_pair_event:b=>[b.p_event_id,b.p_expected_revision,b.p_close,b.p_stats_mode]};
 let rejectSave=false,loseRound=false;const requests=[],errors=[];
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  await context.addInitScript(user=>{const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+7200,user}));},user);
  await context.route(remote+'/**',async route=>{
   const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),method=req.method();
   if(method==='OPTIONS')return route.fulfill({status:200,headers:cors,body:'{}'});
   if(url.pathname.startsWith('/auth/'))return route.fulfill({status:200,headers:cors,body:JSON.stringify(user)});
   const body=req.postData()?JSON.parse(req.postData()):null;requests.push({table,method,body});
   if(url.pathname.includes('/rpc/')){
    if(!args[table])return route.fulfill({status:200,headers:cors,body:'[]'});
    if(rejectSave&&table==='replace_event_fixed_pairs')return route.fulfill({status:409,headers:cors,body:JSON.stringify({code:'40001',message:'固定設定が別端末で変更されています。最新情報を確認してください'})});
    try{await as(3);const data=await rpc(table,args[table](body));await refresh();if(loseRound&&table==='create_fixed_pair_round'){loseRound=false;return route.fulfill({status:502,headers:cors,body:JSON.stringify({message:'試験用応答喪失'})});}return route.fulfill({status:200,headers:cors,body:JSON.stringify(data)});}catch(error){return route.fulfill({status:400,headers:cors,body:JSON.stringify({code:error.code,message:error.message})});}
   }
   if(method==='PATCH'&&['events','event_participants','matches','match_results'].includes(table)){
    const target=url.searchParams.get('id')?.slice(3);assert(target,'試験用更新はID指定必須');await as(3);const keys=Object.keys(body);assert(keys.every(k=>/^[a-z_]+$/.test(k)));await db.query(`update public.${table} set ${keys.map((k,i)=>k+'=$'+(i+2)).join(',')} where id=$1`,[target,...keys.map(k=>body[k])]);await refresh();
   }
   const response=method==='PATCH'?new Response('{}',{status:200}):await mock.s.rest.fetch(req.url(),{method,headers:req.headers(),body:req.postData()||undefined});
   // PATCHのSQLは既に完了。読み取り応答だけを生成する。
   let data=await response.text();if(method==='PATCH'){const target=url.searchParams.get('id')?.slice(3);data=JSON.stringify(tables[table].find(r=>r.id===target));}
   if(table==='matches'&&method==='GET'&&url.searchParams.get('select')?.includes('rounds('))data=JSON.stringify(JSON.parse(data).map(m=>({...m,rounds:{round_number:tables.rounds.find(r=>r.id===m.round_id)?.round_number??0}})));
   await route.fulfill({status:method==='PATCH'?200:response.status,headers:{...cors,...(response.headers.get('content-range')?{'content-range':response.headers.get('content-range')}:{})},body:method==='HEAD'?'':data});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/events/'+e.eid);const settings=page.getByRole('region',{name:'固定ペア設定'}),dialog=()=>page.locator('dialog[open]').last(),generate=()=>page.locator('[data-court-generation]').getByRole('button').last();
  await settings.getByText('固定ペア：0組',{exact:true}).waitFor();
  // 6→5人に減らし、設定時・一覧の警告、複数固定、GuestName表示を確認。
  await page.getByRole('button',{name:'参加状態切替'}).nth(5).click();await settings.getByText(/5人での開催では/).waitFor();
  const add=async(a,b)=>{await settings.getByRole('button',{name:'＋ ペアを固定'}).click();await dialog().getByRole('combobox',{name:'選手A'}).selectOption(e.participants[a]);await dialog().getByRole('combobox',{name:'選手B'}).selectOption(e.participants[b]);};
  await add(0,1);for(const [width,theme] of [[375,'light'],[390,'dark']]){await page.setViewportSize({width,height:844});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;},theme);await page.screenshot({path:`/tmp/fixed-pairs-dialog-${width}-${theme}.png`});assert(await dialog().getByRole('button',{name:'固定する',exact:true}).evaluate(el=>el.getBoundingClientRect().height>=44));}await poll(async()=>await dialog().getByRole('combobox',{name:'選手B'}).locator('option[value=\"'+e.participants[0]+'\"]').evaluate(el=>el.disabled));await dialog().getByRole('button',{name:'固定する',exact:true}).click();await settings.getByText('固定ペア：1組',{exact:true}).waitFor();
  await add(2,3);await dialog().getByRole('button',{name:'固定する',exact:true}).click();await settings.getByText('固定ペア：2組',{exact:true}).waitFor();assert(await settings.getByText('ゲスト',{exact:true}).count());
  await page.reload();await settings.getByText('固定ペア：2組',{exact:true}).waitFor();
  // 保存の競合はUIに残して成功表示しない。
  rejectSave=true;await settings.getByRole('button',{name:'解除',exact:true}).first().click();await settings.getByRole('alert').waitFor();assert.equal(tables.events[0].stats_mode,'official');assert.equal((await db.query('select * from event_fixed_pairs')).rows.length,2);rejectSave=false;await settings.getByRole('button',{name:'設定を再取得'}).click();await poll(async()=>await settings.getByRole('alert').count()===0);
  // 生成の保存成功後に応答を失わせ、画面再読込後も同じUUIDで確認して二重作成しない。
  const before=tables.rounds.length;loseRound=true;await generate().click();await page.getByText(/Round生成の保存結果を確認できません/).waitFor();assert.equal(tables.rounds.length,before+1);await page.reload();await settings.waitFor();await generate().click();await page.getByText('前回生成したRoundの保存を確認しました').waitFor();assert.equal(tables.rounds.length,before+1);const saves=requests.filter(r=>r.table==='create_fixed_pair_round');assert.deepEqual(saves[0].body,saves[1].body);
  // モードを連続切替・生成しても保持。固定設定は不変。
  for(const mode of ['バランスペア','ライバル対決','通常モード']){await page.locator('[data-round-mode] summary').click();const radio=page.getByRole('radio',{name:new RegExp(mode)});await radio.check();const n=tables.rounds.length;await generate().click();await poll(()=>tables.rounds.length===n+1);await poll(async()=>await generate().isEnabled());assert(await radio.isChecked());await page.locator('[data-round-mode] summary').click();}
  // 4人に減ると追加不可、保持・一時停止・生成継続。5人へ戻ると再適用。
  await page.getByRole('button',{name:'参加状態切替'}).nth(4).click();await settings.getByText(/現在は固定を一時停止/).waitFor();assert(await settings.getByRole('button',{name:'＋ ペアを固定'}).isDisabled());const n=tables.rounds.length;await generate().click();await poll(()=>tables.rounds.length===n+1);await poll(async()=>await generate().isEnabled());await page.getByRole('button',{name:'参加状態切替'}).nth(4).click();await settings.getByText(/5人での開催では/).waitFor();
  // 明示休みは自動休憩例外にしない。6→5人で片方だけ休ませて停止を確認する。
  await page.getByRole('button',{name:'参加状態切替'}).nth(5).click();await poll(()=>tables.event_participants.find(p=>p.id===e.participants[5]).status==='active');await page.getByRole('button',{name:'参加状態切替'}).nth(1).click();await settings.getByText(/片方だけが明示的に休み/).waitFor();const stopped=tables.rounds.length;await generate().click();await page.getByText(/固定ペアの片方が欠席・休み・生成対象外です。両者/).first().waitFor();assert.equal(tables.rounds.length,stopped);await page.getByRole('button',{name:'参加状態切替'}).nth(1).click();
  // 全解除後も実使用済みは残り、未選択で終了できない。再開後は再選択する。
  while(await settings.getByRole('button',{name:'解除',exact:true}).count()){await settings.getByRole('button',{name:'解除',exact:true}).first().click();await poll(async()=>!await settings.getByText('処理中…',{exact:true}).count());}
  await page.getByRole('button',{name:'イベント終了',exact:true}).click();await dialog().getByText('このイベントの戦績をどう扱いますか？').waitFor();assert(await dialog().getByRole('button',{name:'終了する',exact:true}).isDisabled());assert.equal(await dialog().locator('input[type=radio]:checked').count(),0);await dialog().getByRole('radio',{name:/このイベント内だけに保存/}).check();await dialog().getByRole('button',{name:'終了する',exact:true}).click();await page.getByText('戦績反映：このイベント内だけに保存').waitFor();assert.equal(tables.events[0].stats_mode,'record_only');await page.getByRole('button',{name:'イベント再開'}).click();await page.getByRole('button',{name:'イベント終了',exact:true}).waitFor();assert.equal(tables.events[0].stats_mode,'undecided');await page.getByRole('button',{name:'イベント終了',exact:true}).click();assert(await dialog().getByRole('button',{name:'終了する',exact:true}).isDisabled());await dialog().getByRole('radio',{name:/グループ通算戦績に反映/}).check();await dialog().getByRole('button',{name:'終了する',exact:true}).click();await page.getByText('戦績反映：グループ通算戦績に反映').waitFor();
  for(const width of [375,390])for(const theme of ['light','dark']){await page.setViewportSize({width,height:844});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;document.documentElement.classList.toggle('light',theme==='light');},theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`/tmp/fixed-pairs-${width}-${theme}.png`,fullPage:true});}
  assert.deepEqual(errors,[]);console.log('固定ペア：設定・解除・再読込・競合、5人警告・ゲスト・全モード連続生成、応答喪失再試行、4人一時停止・復帰、明示休み停止、終了の未選択・記録用・再開・通算、375/390pxライト/ダークを確認。RPCはローカルPostgreSQLで実行。本番通信なし。');
 }finally{await browser.close();await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
