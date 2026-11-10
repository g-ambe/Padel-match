// ローカル・合成データのみ。DBの権限・競合は別の実PostgreSQL試験で確認する。
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {navigationFixture,id,user,clubA,clubB,team}=require('../fixtures/navigation-app.cjs');
require('../fixtures/friendly-round-helpers.cjs');
const base=process.env.NAVIGATION_TEST_URL||'http://127.0.0.1:3047',remote='http://127.0.0.1:54321';
(async()=>{
 const f=navigationFixture(),rounds=[],requests=new Map(),errors=[],outside=[];let revision=0,loseReply=false,seq=9100;
 f.tables.events.find(e=>e.id===team).court_count=2;
 f.tables.event_team_attendance=[];
 for(let n=0;n<10;n++){f.tables.player_profiles.push({id:id(850+n),display_name:'選手'+n,is_active:true});f.tables.club_members.push({id:id(870+n),club_id:n<6?clubA:clubB,player_profile_id:id(850+n),profile_id:null,is_active:true,role:'member'});}
 const roster=()=>{
  const result=[];for(const side of f.tables.event_team_sides.filter(s=>s.event_id===team)){
   for(const cm of f.tables.club_members.filter(m=>m.club_id===side.club_id&&m.is_active)){const p=f.tables.player_profiles.find(p=>p.id===(cm.player_profile_id??cm.profile_id)&&p.is_active);if(p&&!f.tables.event_team_attendance.some(a=>a.side===side.side&&a.member_id===cm.id&&a.status==='absent'))result.push({key:'profile:'+p.id,profile_id:p.id,member_id:cm.id,guest_id:null,source:side.side,name:p.display_name});}
   for(const g of f.tables.event_team_guests.filter(g=>g.event_id===team&&g.side===side.side))result.push({key:'guest:'+g.id,profile_id:null,member_id:null,guest_id:g.id,source:side.side,name:g.guest_name});
  }return result;
 };
 const mockRpc=(name,b)=>{
  if(name==='get_friendly_team_round_context')return {data:{revision:String(revision),court_count:2,roster:roster(),matches:f.tables.event_team_matches,rounds}};
  if(name==='create_friendly_team_round'){
   if(requests.has(b.p_request))return {data:requests.get(b.p_request)};
   if(b.p_revision!==String(revision))return {error:'出欠・試合履歴が更新されています。再度生成してください'};
   const rid=id(seq++),rn=rounds.length+1;
   rounds.push({id:rid,round_number:rn,mode:b.p_mode,court_count:b.p_cards.length,eligible:roster()});
   for(const c of b.p_cards){const m={id:id(seq++),event_id:team,match_order:f.tables.event_team_matches.length+1,round_id:rid,round_number:rn,court_number:c.court,generation_mode:b.p_mode,team_a_score:null,team_b_score:null,result:'undecided',score_detail:null,memo:null,youtube_url:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};c.pairs.flat().forEach((p,i)=>{const slot=['team_a_player1','team_a_player2','team_b_player1','team_b_player2'][i];m[slot+'_profile_id']=p.profile_id;m[slot+'_guest_id']=p.guest_id;m[slot+'_guest_name']=p.guest_id?p.name:null;m[slot+'_source_side']=p.source;});if(b.p_mode==='mixed'){m.pair_1_score=null;m.pair_2_score=null;m.pair_result='undecided';}f.tables.event_team_matches.push(m);}
   revision++;const value={round_id:rid,round_number:rn};requests.set(b.p_request,value);if(loseReply){loseReply=false;return {error:'応答を受信できませんでした。再試行してください'};}return {data:value};
  }
  if(name==='update_friendly_team_round_card'){
   const m=f.tables.event_team_matches.find(m=>m.id===b.p_match);if(!m||m.updated_at!==b.p_expected.updated_at)return {error:'他の端末で変更されています'};
   const patch={...b.p_patch};if(m.generation_mode==='mixed'){patch.pair_1_score=patch.team_a_score;patch.pair_2_score=patch.team_b_score;patch.pair_result=patch.result;patch.team_a_score=patch.team_b_score=null;patch.result='undecided';}Object.assign(m,patch,{updated_at:new Date(Date.now()+revision++).toISOString()});return {data:m};
  }
  if(name==='delete_friendly_team_round_card'){f.tables.event_team_matches=f.tables.event_team_matches.filter(m=>m.id!==b.p_match);revision++;return {data:null};}
 };
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true});await c.addInitScript(({base,user})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{base,user});
 await c.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin===base)return route.continue();if(url.origin!==remote){outside.push(url.origin);return route.abort();}const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};if(req.method()==='OPTIONS')return route.fulfill({status:200,headers,body:'{}'});if(url.pathname.startsWith('/auth/'))return route.fulfill({status:200,headers,body:JSON.stringify(user)});if(url.pathname.includes('/rpc/')){const mock=mockRpc(url.pathname.split('/').at(-1),JSON.parse(req.postData()||'{}'));if(mock)return route.fulfill({status:mock.error?503:200,headers,body:JSON.stringify(mock.error?{code:'40001',message:mock.error}:mock.data)});}if(url.pathname.endsWith('/events')&&url.searchParams.get('or')?.includes('is_deleted')){url.searchParams.delete('or');url.searchParams.set('is_deleted','eq.false');}const r=await f.fetch(url.href,{method:req.method(),headers:req.headers(),body:req.postData()||undefined});return route.fulfill({status:r.status,headers:{...headers,...Object.fromEntries(r.headers)},body:await r.text()});});
 const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/team-matches/'+team);await p.addStyleTag({content:'nextjs-portal {display:none!important}'});
 const generator=p.getByRole('region',{name:'次のラウンドを生成',exact:true}),dialog=()=>p.locator('dialog[open]').last();
 await p.getByRole('button',{name:'次のラウンドを生成',exact:true}).click();await dialog().getByText('チーム対決 · 2面',{exact:true}).waitFor();assert.equal(f.tables.event_team_matches.length,0);assert.equal(await dialog().locator('[data-score-key]').count(),0);
 await dialog().getByRole('button',{name:'再抽選',exact:true}).click();await dialog().getByRole('button',{name:'確定して追加',exact:true}).waitFor();await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(f.tables.event_team_matches.length,0);
 await p.getByRole('button',{name:'次のラウンドを生成',exact:true}).click();loseReply=true;await dialog().getByRole('button',{name:'確定して追加',exact:true}).click();await dialog().getByRole('alert').waitFor();assert.equal(f.tables.event_team_matches.length,2);await dialog().getByRole('button',{name:'確定して追加',exact:true}).click();await p.locator('[data-team-match-mount]').first().waitFor();assert.equal(f.tables.event_team_matches.length,2,'応答喪失の再試行でも二重作成しない');
 await p.getByRole('button',{name:'次のラウンドを生成',exact:true}).click();await p.getByRole('alert').getByText('未完了の試合カードのスコアを保存してください',{exact:true}).waitFor();assert.equal(rounds.length,1);
 const score=async(card,a,b)=>{await card.locator('[data-score-key] > div button').first().click();await dialog().getByRole('button',{name:String(a),exact:true}).click();await dialog().getByRole('button',{name:String(b),exact:true}).click();await card.getByRole('button',{name:new RegExp('の得点を入力：'+a)}).first().waitFor();};
 for(const card of await p.locator('[data-team-match-mount]').all())await score(card,4,2);
 await p.getByRole('button',{name:'チーム混合',exact:true}).click();await p.getByRole('button',{name:'次のラウンドを生成',exact:true}).click();await dialog().getByText('チーム混合 · 2面',{exact:true}).waitFor();assert.equal(await p.locator('dialog[open]').count(),1);assert.equal(await dialog().locator('[data-score-key]').count(),0);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 for(const theme of ['dark','light']){await p.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;},theme);await p.setViewportSize({width:375,height:568});const box=await dialog().getByRole('button',{name:'確定して追加',exact:true}).boundingBox();assert(box&&box.y>=0&&box.y+box.height<=568,'短い画面でも確定ボタンに到達可能');assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const tones=await dialog().locator('.team-side-a .team-player-heading,.team-side-b .team-player-heading').evaluateAll(es=>es.map(e=>getComputedStyle(e).color));assert(new Set(tones).size>=2,'元所属の緑青を区別');}await p.setViewportSize({width:375,height:812});await p.evaluate(()=>{document.documentElement.dataset.theme='dark';document.body.dataset.theme='dark';});
 if(process.env.TEAM_ROUND_SCREENSHOT){fs.mkdirSync(require('node:path').dirname(process.env.TEAM_ROUND_SCREENSHOT),{recursive:true});await p.screenshot({path:process.env.TEAM_ROUND_SCREENSHOT});}
 await dialog().getByRole('button',{name:'確定して追加',exact:true}).click();await p.locator('[data-score-key][data-mixed=true]').first().waitFor();assert.equal(f.tables.event_team_matches.length,4);
 const unique=await p.locator('[data-score-key]').evaluateAll(es=>es.map(e=>e.dataset.scoreKey));assert.equal(unique.length,new Set(unique).size);
 const mixed=p.locator('[data-team-match-mount]').filter({has:p.locator('[data-score-key][data-mixed=true]')});
 const first=mixed.first();await first.getByRole('button',{name:'カード編集',exact:true}).click();await first.getByText('詳細スコア・メモ・動画',{exact:true}).click();await first.getByPlaceholder('メモ',{exact:true}).fill('混合カードのメモ');await first.getByRole('button',{name:'保存',exact:true}).click();await first.getByText('メモ: 混合カードのメモ',{exact:true}).waitFor();assert.equal(await first.locator('[data-score-key]').count(),1);
 await score(first,4,2);await score(mixed.last(),0,0);assert(f.tables.event_team_matches.filter(m=>m.generation_mode==='mixed').every(m=>m.team_a_score===null&&m.team_b_score===null&&m.result==='undecided'),'旧画面向けチーム得点へ混合結果を入れない');
 p.once('dialog',d=>d.accept());await p.locator('summary').filter({hasText:'開催管理'}).click();await p.getByRole('button',{name:'フレンドリーチームマッチ終了',exact:true}).click();await p.getByRole('tab',{name:'結果',exact:true}).waitFor();
 await p.getByRole('button',{name:/チーム戦績（対決のみ）/}).click();await p.getByText('2勝0敗0分 / 勝点6 / 勝率100.0% / 得失点差+4',{exact:true}).waitFor();
 const shared=f.tables.events.find(e=>e.id===team);shared.share_enabled=true;shared.share_token='synthetic-team-round-share';await p.goto(base+'/share/events/'+shared.share_token);await p.getByText(/チーム混合（ペア1対ペア2）/).first().waitFor();assert.equal(await p.locator('[data-score-key]').count(),0,'共有ページは読み取り専用');assert((await p.locator('main').innerText()).includes('（Aチーム）'),'共有結果も元所属を表示');
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);console.log('375px：対決/混合プレビュー・再抽選/取消・応答喪失再試行・未完了拒否・スコア・混合編集・単一描画・終了後の戦績分離・共有 PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
