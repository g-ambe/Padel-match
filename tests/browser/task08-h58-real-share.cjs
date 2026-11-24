// H58: actual anonymous HTTP and Worker browser, synthetic tokens only.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(path.join(process.env.RUNNER_TEMP,'task08-playwright','node_modules','playwright'));
const {url,base,key,mode,privateIds}=JSON.parse(fs.readFileSync(0,'utf8'));
const tokens={friendly:'TASK08H12HTTPFRIENDLYONLY',mixed:'TASK08H12HTTPMIXEDONLY',official:'TASK08H12HTTPOFFICIALONLY',bad:'TASK08H58INVALIDONLY'};
let phase='setup',checks=0,httpStatus=null;
const mark=()=>{checks++};
async function request(endpoint,body,token){
 const headers={apikey:key,'Content-Type':'application/json'};
 if(token)headers['x-padel-share-token']=token;
 const r=await fetch(url+'/rest/v1/'+endpoint,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
 httpStatus=r.status;
 const raw=await r.text();let data=null;if(raw) data=JSON.parse(raw);
 return {ok:r.ok,status:r.status,data};
}
async function rpc(name,args,token){
 const r=await request('rpc/'+name,args,token);assert(r.ok);return r.data;
}
const read=(token,kind)=>rpc('get_shared_event',{p_token:token,p_kind:kind},token);
function safeDto(data,own){
 const serialized=JSON.stringify(data);
 for(const secret of [...Object.values(tokens),...privateIds])assert(!serialized.includes(secret));
 for(const field of ['share_token','created_by_auth_user_id','linked_auth_user_id','owner_id','email','instagram_username','avatar_key','club_id'])assert(!serialized.includes('"'+field+'"'));
 for(const name of ['TASK08-H12-HTTP-FRIENDLY-ONLY','TASK08-H12-HTTP-MIXED-ONLY','TASK08-H12-HTTP-OFFICIAL-ONLY'].filter(n=>n!==own))assert(!serialized.includes(name));
}
async function clickRpc(test,token){
 return rpc(test[0],{[test[1]]:test[2],p_share_token:token,p_user_agent:'task08-h58-http',p_referrer:'https://example.invalid/share/synthetic'},token);
}
async function main(){
 assert.equal(url,'http://127.0.0.1:54321');assert.equal(base,'http://127.0.0.1:3070');
 assert(['before','after','disabled'].includes(mode));
 if(mode==='disabled'){
  phase='disabled_http';
  for(const [token,kind] of [[tokens.friendly,'event'],[tokens.mixed,'event'],[tokens.official,'official']])assert.equal(await read(token,kind),null);
  mark();return {ok:true,checks};
 }
 phase='dto_friendly';
 const f=await read(tokens.friendly,'event');
 assert.equal(f.event.name,'TASK08-H12-HTTP-FRIENDLY-ONLY');assert.equal(f.participants.length,4);assert.equal(f.matches.length,1);assert.equal(f.matches[0].match_players.length,4);assert.equal(f.matches[0].result.score_a,4);assert.equal(f.matches[0].result.score_b,2);assert.equal(f.videos.length,1);
 safeDto(f,f.event.name);mark();
 phase='dto_mixed';
 const m=await read(tokens.mixed,'event');assert.equal(m.event.name,'TASK08-H12-HTTP-MIXED-ONLY');assert.equal(m.event.event_mode,'team');assert.equal(m.team_matches.length,1);assert.equal(m.team_matches[0].generation_mode,'mixed');assert.equal(m.team_matches[0].pair_1_score,4);assert.equal(m.team_matches[0].pair_2_score,2);assert.equal(m.team_guests.length,4);assert(m.team_guests.every(g=>/^[a-f0-9]{32}$/.test(g.id)));safeDto(m,m.event.name);mark();
 phase='dto_official';
 const o=await read(tokens.official,'official');assert.equal(o.event.title,'TASK08-H12-HTTP-OFFICIAL-ONLY');assert.equal(o.matches.length,1);assert.equal(o.matches[0].our_score,4);assert.equal(o.matches[0].opponent_score,2);safeDto(o,o.event.title);mark();
 phase='token_negative';
 for(const [token,kind] of [[tokens.bad,'event'],[tokens.bad,'official'],[tokens.official,'event'],[tokens.friendly,'official'],[tokens.friendly,'bad'],['','event']])assert.equal(await read(token,kind),null);
 mark();
 const clicks=[['record_event_video_click_by_token','p_match_id',f.matches[0].id,tokens.friendly,tokens.official],['record_event_video_link_click_by_token','p_video_link_id',f.videos[0].id,tokens.friendly,tokens.official],['record_official_video_click_by_token','p_match_id',o.matches[0].id,tokens.official,tokens.friendly]];
 phase='click_http';
 for(const test of clicks){
  for(const t of [test[4],tokens.bad,test[3]])assert.equal(await clickRpc(test,t),null);
 }mark();
 if(mode==='after'){
  phase='legacy_click_denied';
  for(const test of clicks){
   const r=await request('rpc/'+test[0].replace('_by_token',''),{[test[1]]:test[2],p_user_agent:'task08-h58-legacy',p_referrer:null});
   assert(!r.ok&&[401,403,404].includes(r.status));
  }mark();
  phase='raw_table_denied';
  for(const table of ['event_team_matches','event_team_guests','event_team_sides','event_video_links','official_events','official_matches','official_opponents']){
   for(const token of [undefined,tokens.bad,tokens.friendly]){
    const r=await request(table+'?select=*&limit=1',undefined,token);
    assert(!r.ok&&[401,403,404].includes(r.status));
   }
  }mark();
  phase='raw_other_scope';
  for(const table of ['events','event_participants','matches','match_players','match_results']){
   for(const token of [undefined,tokens.bad]){
    const r=await request(table+'?select=*&limit=1',undefined,token);
    assert((!r.ok&&[401,403,404].includes(r.status))||(r.ok&&Array.isArray(r.data)&&r.data.length===0));
   }
  }mark();
 }
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const errors=[];
 try{
  const ctx=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,serviceWorkers:'block',userAgent:'task08-h58-browser'});
  await ctx.route('**/*',route=>{const origin=new URL(route.request().url()).origin;return origin===base||origin===url?route.continue():route.abort()});
  const p=await ctx.newPage();p.setDefaultTimeout(25000);p.on('pageerror',e=>errors.push(e.name));
  const go=async(route,token)=>{const r=await p.goto(base+route+token);assert.equal(r.status(),200);};
  const click=async(test,locator)=>{
   const res=p.waitForResponse(r=>r.url()===url+'/rest/v1/rpc/'+test[0]&&r.request().method()==='POST');
   const [r]=await Promise.all([res,locator.click()]);httpStatus=r.status();assert(r.ok());
   const b=r.request().postDataJSON();assert.equal(b.p_share_token,test[3]);assert.equal(b[test[1]],test[2]);assert.equal(b.p_referrer,null);
  };
  const fits=async()=>assert(await p.evaluate(()=>innerWidth===375&&document.documentElement.scrollWidth<=innerWidth));
  phase='browser_friendly';
  await go('/share/events/',tokens.friendly);
  await p.getByRole('heading',{name:f.event.name,exact:true}).waitFor();
  await p.getByLabel('スコア 4 対 2').first().waitFor();
  await click(clicks[0],p.getByRole('link',{name:'動画を見る',exact:true}).first());
  await p.getByText('開催動画',{exact:true}).click();
  await click(clicks[1],p.getByRole('link',{name:'YouTubeで見る',exact:true}).first());await fits();mark();
  phase='browser_mixed';
  await go('/share/events/',tokens.mixed);await p.getByRole('heading',{name:m.event.name,exact:true}).waitFor();
  await p.getByText('チーム混合（ペア1対ペア2）',{exact:false}).first().waitFor();await p.getByLabel('スコア 4 対 2').first().waitFor();await fits();mark();
  phase='browser_official';
  await go('/share/official-events/',tokens.official);await p.getByText(o.event.title,{exact:true}).first().waitFor();
  await p.getByText('スコア: 4 - 2',{exact:true}).waitFor();
  await click(clicks[2],p.getByRole('link',{name:'動画を見る',exact:true}).first());await fits();mark();
  phase='browser_invalid';
  for(const [route,token] of [['/share/events/',tokens.bad],['/share/official-events/',tokens.friendly]]){
   await go(route,token);await p.getByText('この共有リンクは無効です',{exact:true}).waitFor();
   assert.equal(await p.getByRole('link',{name:'動画を見る',exact:true}).count(),0);
  }mark();
  phase='browser_errors';assert.deepEqual(errors,[]);mark();
 }finally{await browser.close()}
 return {ok:true,checks};
}
main().then(r=>console.log(JSON.stringify(r))).catch(e=>console.log(JSON.stringify({ok:false,phase,checks,httpStatus,errorKind:e?.name==='TimeoutError'?'timeout':e?.name==='AssertionError'?'assertion':String(e?.message??'').includes('strict mode violation')?'ambiguous_locator':'other'})));
