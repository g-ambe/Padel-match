// 本番の公開アプリを操作するが、保存先は専用ブラウザのsessionStorageだけ。
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const BASE='https://padel-match.ranbo-ga.workers.dev';
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:375,height:667},hasTouch:true});
 context.setDefaultTimeout(20000);
 const mutations=[],errors=[];
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===BASE && ['GET','HEAD'].includes(req.method()))return route.continue();
  if(url.origin==='https://ntczrmvffmpjzilfebyi.supabase.co' && ['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
  if(!['GET','HEAD','OPTIONS'].includes(req.method()))mutations.push(true);
  return route.abort();
 });
 try{
  const p=await context.newPage();p.on('pageerror',()=>errors.push(true));
  for(const path of ['/','/login','/groups']){const response=await p.goto(BASE+path);assert.equal(response.status(),200);assert(!await p.getByText('Application error',{exact:false}).count());}
  await p.goto(BASE+'/login');
  await p.evaluate(()=>{
   sessionStorage.setItem('padel_guest_mode_v1','1');
   const people=Array.from({length:9},(_,i)=>({id:'release_guest_'+i,guest_name:'検証選手'+i,status:'active',participant_type:'guest'}));
   sessionStorage.setItem('padel_guest_events_v1',JSON.stringify([{id:'guest_release_check',name:'リリース検証用の一時試合',court_count:2,status:'active',event_mode:'auto',stats_mode:'official',created_at:new Date().toISOString(),participants:people,matches:[0,1].map(c=>({id:'release_match_'+c,court_number:c+1,round_number:1,eligible_ids:people.map(p=>p.id),created_at:new Date().toISOString(),completed:false,result:null,youtube_url:null,players:Array.from({length:4},(_,i)=>({participant_id:people[c*4+i].id,team:i<2?'A':'B'}))}))}]));
  });
  await p.goto(BASE+'/events/guest_release_check');
  const board=()=>p.locator('[data-scoreboard-latest]'),dialog=()=>p.locator('dialog[open]').last();
  await board().getByRole('button',{name:'メンバー変更',exact:true}).first().waitFor();
  // キャンセルは元データを維持。
  const data=()=>p.evaluate(()=>JSON.parse(sessionStorage.getItem('padel_guest_events_v1'))[0]);
  const initial=await data();
  await board().getByRole('button',{name:'メンバー変更',exact:true}).first().click();
  await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();assert.deepEqual(await data(),initial);
  for(const partner of ['検証選手2','検証選手4','検証選手8']){
   await board().getByRole('button',{name:'メンバー変更',exact:true}).first().click();
   const source=await dialog().locator('section').first().getByRole('button').first().innerText();
   await dialog().getByRole('button',{name:source,exact:true}).click();
   await dialog().getByRole('button',{name:partner,exact:true}).click();
   await dialog().getByRole('button',{name:'保存',exact:true}).click();
   await p.waitForFunction(()=>!document.querySelector('dialog[open]'));
  }
  await board().locator('[data-score-key]').first().getByRole('button').first().click();
  await dialog().getByRole('button',{name:'0',exact:true}).click();await dialog().getByRole('button',{name:'0',exact:true}).click();
  await board().getByText('DRAW',{exact:true}).first().waitFor();
  await p.getByRole('button',{name:'次Round生成',exact:true}).click();
  await p.waitForFunction(()=>JSON.parse(sessionStorage.getItem('padel_guest_events_v1'))[0].matches.some(m=>m.round_number===2));
  await p.getByRole('tab',{name:'参加者',exact:true}).click();await p.getByRole('tab',{name:'結果',exact:true}).click();await p.getByRole('tab',{name:'対戦',exact:true}).click();
  for(const width of [320,375,390])for(const theme of ['dark','light']){
   await p.setViewportSize({width,height:667});await p.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;},theme);
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  assert.equal(new Set((await data()).matches.filter(m=>m.round_number===2).flatMap(m=>m.players.map(p=>p.participant_id))).size,8);
  assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
  console.log(JSON.stringify({public_pages:true,guest_same_cross_bench_swap:true,cancel:true,draw_score:true,next_round:true,tabs:true,mobile_themes:true,production_db_writes:0}));
 }finally{await context.close();await browser.close();}
})().catch(()=>{console.error('本番公開画面の専用ゲスト試験に失敗。詳細データは非公開。');process.exitCode=1;});
