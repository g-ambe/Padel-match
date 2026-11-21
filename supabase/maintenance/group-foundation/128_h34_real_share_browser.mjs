// Stage-only synthetic share acceptance. Never use production or real tokens.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const stage='https://zzjwpresqkefnyjyisgd.supabase.co';
const base='http://127.0.0.1:3174';
const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const tokens={friendly:'TASK08H12HTTPFRIENDLYONLY',mixed:'TASK08H12HTTPMIXEDONLY',official:'TASK08H12HTTPOFFICIALONLY',bad:'TASK08H34INVALIDONLY'};
let phase='preflight';
async function rpc(name,args,token){
 const res=await fetch(stage+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,'Content-Type':'application/json','x-padel-share-token':token},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
 assert.ok(res.ok);
 return res.status===204?null:await res.json();
}
async function read(token,kind){return rpc('get_shared_event',{p_token:token,p_kind:kind},token);}
async function main(){
 assert.ok(key?.startsWith('sb_publishable_'));
 phase='HTTP three sharing modes';
 const f=await read(tokens.friendly,'event'),m=await read(tokens.mixed,'event'),o=await read(tokens.official,'official');
 assert.equal(f?.event?.name,'TASK08-H12-HTTP-FRIENDLY-ONLY');
 assert.equal(f.participants.length,4); assert.equal(f.matches[0].result.score_a,4);assert.equal(f.matches[0].result.score_b,2);
 assert.equal(m?.event?.event_mode,'team');assert.equal(m.team_matches[0].generation_mode,'mixed');assert.equal(m.team_matches[0].pair_1_score,4);assert.equal(m.team_matches[0].pair_2_score,2);
 assert.equal(o?.event?.title,'TASK08-H12-HTTP-OFFICIAL-ONLY');assert.equal(o.matches[0].our_score,4);assert.equal(o.matches[0].opponent_score,2);
 for(const [data,token] of [[f,tokens.friendly],[m,tokens.mixed],[o,tokens.official]]) assert.ok(!JSON.stringify(data).includes(token));
 assert.equal(await read(tokens.bad,'event'),null);assert.equal(await read(tokens.bad,'official'),null);assert.equal(await read(tokens.official,'event'),null);assert.equal(await read(tokens.friendly,'official'),null);
 console.log('H34 HTTP shared DTO positive/negative PASS');
 phase='HTTP video click token cases';
 const checks=[['record_event_video_click_by_token','p_match_id',f.matches[0].id,tokens.friendly,tokens.official],['record_event_video_link_click_by_token','p_video_link_id',f.videos[0].id,tokens.friendly,tokens.official],['record_official_video_click_by_token','p_match_id',o.matches[0].id,tokens.official,tokens.friendly]];
 if(process.env.H34_BROWSER_ONLY!=='1') for(const [name,arg,id,good,bad] of checks){
  assert.ok(id);
  for(const token of [bad,tokens.bad,good]) assert.equal(await rpc(name,{[arg]:id,p_share_token:token,p_user_agent:'task08-h34-http',p_referrer:'https://example.invalid/share/synthetic'},token),null);
 }
 console.log(process.env.H34_BROWSER_ONLY==='1'?'H34 HTTP clicks previously verified; browser-only retry':'H34 HTTP click RPC requests PASS (DB counts require separate verification)');
 phase='Chromium';
 const browser=await chromium.launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,userAgent:'task08-h34-browser'});
  // The real Stage Data API is NOT mocked. External links are intercepted only to avoid opening YouTube.
  await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin===base||u.origin===stage)return route.continue();return route.abort();});
  const page=await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror',e=>console.log('H34 page error type: '+e.name));
  page.on('response',r=>{if(r.url().startsWith(stage+'/rest/v1/rpc/')&&r.status()>=400)console.log('H34 browser RPC HTTP '+r.status());});
  const click=async (name,locator,token)=>{
   const response=page.waitForResponse(r=>r.url()===stage+'/rest/v1/rpc/'+name&&r.request().method()==='POST');
   const [r]=await Promise.all([response,locator.click()]);
   assert.ok(r.ok());const body=r.request().postDataJSON();assert.equal(body.p_share_token,token);assert.equal(body.p_referrer,null);
  };
  phase='browser friendly';
  const initial=await page.goto(base+'/share/events/'+tokens.friendly);assert.equal(initial?.status(),200,'friendly page HTTP status');
  await page.getByRole('heading',{name:'TASK08-H12-HTTP-FRIENDLY-ONLY'}).waitFor();
  await page.getByLabel('スコア 4 対 2').first().waitFor();
  await click(checks[0][0],page.getByRole('link',{name:'動画を見る',exact:true}).first(),tokens.friendly);
  await page.getByText('開催動画',{exact:true}).click();
  await click(checks[1][0],page.getByRole('link',{name:'YouTubeで見る',exact:true}).first(),tokens.friendly);
  console.log('H34 browser friendly PASS');
  phase='browser mixed';
  await page.goto(base+'/share/events/'+tokens.mixed);await page.getByRole('heading',{name:'TASK08-H12-HTTP-MIXED-ONLY'}).waitFor();
  await page.getByText('チーム混合（ペア1対ペア2）',{exact:false}).first().waitFor();await page.getByLabel('スコア 4 対 2').first().waitFor();
  console.log('H34 browser mixed PASS');
  phase='browser official';
  await page.goto(base+'/share/official-events/'+tokens.official);
  await page.getByText('TASK08-H12-HTTP-OFFICIAL-ONLY',{exact:true}).first().waitFor();
  await page.getByText('スコア: 4 - 2',{exact:true}).waitFor();
  await click(checks[2][0],page.getByRole('link',{name:'動画を見る',exact:true}).first(),tokens.official);
  console.log('H34 browser official PASS');
  phase='browser invalid';
  await page.goto(base+'/share/events/'+tokens.bad);await page.getByText('この共有リンクは無効です',{exact:true}).waitFor();
  await page.goto(base+'/share/official-events/'+tokens.friendly);await page.getByText('この共有リンクは無効です',{exact:true}).waitFor();
  console.log('H34 browser invalid PASS');
 }finally{await browser.close();}
}
main().catch(e=>{const m=String(e?.message??'').replaceAll(key??'__none__','[key]').replace(/sb_publishable_[A-Za-z0-9_-]+/g,'[key]');console.error('H34 FAIL at '+phase+' '+e?.name+' '+m.slice(0,1000));process.exitCode=1;});
