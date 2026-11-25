// Real React + exact candidate SQL in PGlite; Auth/REST transport is synthetic, no hosted access.
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {lineupFixture}=require('../fixtures/lineup-home-court-candidates.cjs');
const {database}=require('../fixtures/stats-helpers.cjs');
const base=process.env.NONFIXED_LINEUP_TEST_URL||'http://127.0.0.1:3070',remote='http://127.0.0.1:54321';assert.equal(new URL(base).hostname,'127.0.0.1');
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};
(async()=>{
 const f=await lineupFixture(),{db,as,rpc,id}=f;
 const cases=[['出場',[[0,1]],[0,1,2,3,4,5,6,7]],['片方休憩',[[0,1]],[0,2,3,4]],['両方休憩',[[0,1]],[2,3,4,5]]],events=[];
 for(const [label,pairs,slots]of cases)events.push({label,...await f.seed(9,pairs,slots)});
 const tables={},refresh=async()=>{await db.exec('reset role');for(const n of ['events','event_participants','rounds','matches','match_players','match_results','profiles','player_profiles','clubs','club_members','app_admins'])tables[n]=(await db.query('select * from '+n)).rows;};await refresh();
 const user={id:id(3),email:'synthetic@example.invalid',role:'authenticated',aud:'authenticated',user_metadata:{},app_metadata:{}};
 tables.user_preferences=[{auth_user_id:user.id,theme_mode:'dark',tutorial_status:'completed'}];
 const mock=database(tables),args={get_friendly_lineup_versions:b=>[b.p_event_id],get_friendly_round_lineup:b=>[b.p_event_id,b.p_round_id],replace_friendly_round_lineup:b=>[b.p_event_id,b.p_round_id,JSON.stringify(b.p_expected),JSON.stringify(b.p_cards),b.p_request_id],get_event_fixed_pair_state:b=>[b.p_event_id,b.p_include_history]};
 let invalid=null,loseReply=false;const calls=[],errors=[],outside=[];
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const theme of ['dark','light']){
  tables.user_preferences[0].theme_mode=theme;
  const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,colorScheme:theme});
  await c.addInitScript(({user,base})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{user,base});
  await c.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').at(-1);
   if(url.origin===base)return route.continue();if(url.origin!==remote){outside.push(url.origin);return route.abort();}
   const answer=(status,data)=>route.fulfill({status,headers:cors,body:JSON.stringify(data)});if(req.method()==='OPTIONS')return answer(200,{});if(url.pathname.startsWith('/auth/'))return answer(200,user);
   if(args[name]){const body=req.postDataJSON();calls.push({name,body});try{await as();let result=await rpc(name,args[name](body));await refresh();if(name==='get_friendly_round_lineup'&&invalid){result={...result,...invalid};}if(name==='replace_friendly_round_lineup'&&loseReply){loseReply=false;return answer(502,{message:'応答喪失'});}return answer(200,result);}catch(e){return answer(400,{code:e.code,message:e.message});}}
   if(name==='get_my_club_memberships')return answer(200,tables.club_members.filter(m=>tables.player_profiles.some(p=>p.id===m.player_profile_id&&p.linked_auth_user_id===user.id)).map(m=>({...m,status:'active'})));
   if(name==='get_my_player_profiles')return answer(200,tables.player_profiles.filter(p=>p.linked_auth_user_id===user.id));
   if(url.pathname.includes('/rpc/'))return answer(200,[]);
   const response=await mock.s.rest.fetch(url.href,{method:req.method(),headers:req.headers(),body:req.postData()||undefined});return route.fulfill({status:response.status,headers:{...cors,...Object.fromEntries(response.headers)},body:await response.text()});
  });
  const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  const dialog=()=>p.getByRole('dialog',{name:/Round .* のメンバー変更/}),open=async()=>{await p.locator('[data-scoreboard-latest]').getByRole('button',{name:'メンバー変更',exact:true}).first().click();await dialog().waitFor();};
  for(const e of events){
   await p.goto(base+'/events/'+e.eid);await open();
   for(const n of [0,1]){const b=dialog().getByRole('button',{name:`ゲスト${n}（固定）`,exact:true});if(await b.count())assert(await b.isDisabled());else assert.fail('active fixed participant must remain visible');}
   const before=await f.snap(e),free=before.cards.flatMap(card=>card.players.map(p=>({...p,match:card.id}))).filter(p=>!before.protected_participant_ids.includes(p.participant_id));
   const a=free[0],b=free.find(p=>p.team!==a.team||p.match!==a.match);assert(b);const label=id=>before.people.find(p=>p.id===id).name;
   await dialog().getByRole('button',{name:label(a.participant_id),exact:true}).click();await dialog().getByRole('button',{name:label(b.participant_id),exact:true}).click();
   loseReply=true;await dialog().getByRole('button',{name:'保存',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'応答喪失'}).waitFor();await dialog().getByRole('button',{name:'再試行',exact:true}).click();await dialog().waitFor({state:'hidden'});
   const edits=calls.filter(x=>x.name==='replace_friendly_round_lineup');assert.deepEqual(edits.at(-1).body,edits.at(-2).body);await as();const after=await f.snap(e);assert.deepEqual(after.protected_participant_ids,before.protected_participant_ids);const audit=structuredClone(after.audit);audit.played_ids=before.audit.played_ids;assert.deepEqual(audit,before.audit);
   await open();assert.equal(await dialog().getByRole('button',{name:label(b.participant_id),exact:true}).count(),1);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();
  }
  for(const malformed of [{lineup_protection_version:undefined,protected_participant_ids:undefined},{lineup_protection_version:2},{protected_participant_ids:['bad']},{protected_participant_ids:[id(999)]}]){
   invalid=malformed;await p.goto(base+'/events/'+events[0].eid);const count=calls.filter(x=>x.name==='replace_friendly_round_lineup').length;await open();await dialog().getByRole('alert').filter({hasText:'保護情報を確認できません'}).waitFor();assert(await dialog().getByRole('button',{name:'保存',exact:true}).isDisabled());for(const button of await dialog().locator('section button').all())assert(await button.isDisabled());assert.equal(calls.filter(x=>x.name==='replace_friendly_round_lineup').length,count);await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();invalid=null;
  }
  await c.close();console.log('PASS: nonfixed lineup 375px '+theme+' / fixed active+rest disabled / idempotent save / missing-invalid DTO blocked');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
 }finally{await browser.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
