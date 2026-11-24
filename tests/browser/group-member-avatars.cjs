// Local UI with synthetic Auth/REST/image responses; no hosted services or R2.
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {navigationFixture,user,clubA,id}=require('../fixtures/navigation-app.cjs');
const base=process.env.GROUP_AVATAR_TEST_URL||'http://127.0.0.1:3070',remote='http://127.0.0.1:54321';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const theme of ['light','dark']){
  const f=navigationFixture();Object.assign(f.tables.user_preferences[0],{theme_mode:theme,tutorial_status:'completed'});
  for(let n=0;n<24;n++){
   f.tables.player_profiles.push({id:id(200+n),linked_auth_user_id:n===2?null:id(300+n),display_name:'選手'+n,is_active:true});
   f.tables.club_members.push({id:id(400+n),club_id:clubA,player_profile_id:id(200+n),profile_id:null,role:'member',is_active:true,status:'active'});
  }
  const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,colorScheme:theme});
  await c.addInitScript(({base,user})=>{
   if(location.origin!==base)return;
   const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
   localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+7200,user}));
   window.avatarUrls={created:[],revoked:[]};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
   URL.createObjectURL=b=>{const u=create(b);window.avatarUrls.created.push(u);return u};
   URL.revokeObjectURL=u=>{window.avatarUrls.revoked.push(u);revoke(u)};
  },{base,user});
  let activeUser=user,member=true,running=0,maximum=0;const gets=[],outside=[],errors=[];
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','Content-Type':'application/json'};
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  // Real WebP decoding/geometry in the browser, synthetic bytes only.
  const image=Buffer.from(await p.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=20;c.getContext('2d').fillRect(0,0,40,20);return c.toDataURL('image/webp').split(',')[1]}),'base64');
  await c.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),body=req.postData()?JSON.parse(req.postData()):null;
   const answer=(data,status=200)=>route.fulfill({status,headers,body:JSON.stringify(data)});
   if(u.origin===base){
    if(/^\/api\/groups\/[^/]+\/members\/[^/]+\/avatar$/.test(u.pathname)){
     assert(req.headers().authorization?.startsWith('Bearer '));gets.push(u.pathname);if(!member)return answer({error:'画像を確認できません'},404);running++;maximum=Math.max(maximum,running);await delay(80);running--;
     return route.fulfill({status:200,headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Avatar-Focus-X':'.3','X-Avatar-Focus-Y':'.7','X-Avatar-Zoom':'2'},body:image}).catch(()=>{});
    }
    if(u.pathname.startsWith('/api/'))return answer({profile:null,imageEnabled:false});return route.continue();
   }
   if(u.origin!==remote){outside.push(u.origin);return route.abort()}
   if(req.method()==='OPTIONS')return answer({});if(u.pathname.startsWith('/auth/'))return answer(activeUser);
   const name=u.pathname.split('/').at(-1);
   if(name==='get_my_club_memberships')return answer(member?f.tables.club_members.filter(m=>m.profile_id===user.id):[]);
   if(name==='get_club_roster')return answer(f.tables.club_members.filter(m=>m.club_id===body.p_club_id).map(m=>({...m,created_at:'2026-01-01',player_profiles:{...f.tables.player_profiles.find(p=>p.id===m.player_profile_id),club_display_name:null,public_name_confirmed:false}})));
   if(name==='get_public_club_directory')return answer([{reference:id(900),display_name:'公開名',is_unlinked:false}]);
   if(name==='get_public_club_member_count')return answer(25);
   if(name==='get_club_stats_members')return answer(f.tables.club_members.filter(m=>m.club_id===clubA));
   if(name==='get_club_stats_player_names')return answer(f.tables.player_profiles.map(p=>({id:p.id,display_name:p.display_name})));
   const response=await f.fetch(req.url(),{method:req.method(),headers:req.headers(),body:req.postData()||undefined});
   return route.fulfill({status:response.status,headers:{...headers,...Object.fromEntries(response.headers)},body:await response.text()});
  });
  await p.goto(base+'/groups/'+clubA);
  const tabs=p.getByRole('tablist',{name:'グループ詳細'});
  await tabs.waitFor();assert.equal(gets.length,0);
  await tabs.getByRole('tab',{name:'メンバー',exact:true}).click();
  await p.locator('[data-member-id] img').first().waitFor();assert(maximum<=3);assert(gets.length<24);
  assert(!gets.some(path=>path.includes(id(402))));
  await p.waitForFunction(()=>[...document.querySelectorAll('[data-member-id] img')].some(i=>i.style.width==='400%'&&i.style.transform.replace(/\s/g,'')==='translate(-30%,-70%)'));
  await tabs.getByRole('tab',{name:'概要',exact:true}).click();
  await p.waitForFunction(()=>window.avatarUrls.created.every(u=>window.avatarUrls.revoked.includes(u)));
  const count=gets.length;await tabs.getByRole('tab',{name:'メンバー',exact:true}).click();await p.waitForFunction(n=>document.querySelectorAll('[data-member-id] img').length>0,count);assert(gets.length>count);
  // Background/return revalidates membership, discards all prior image URLs.
  await p.evaluate(()=>{window.testVisibility='hidden';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.testVisibility});document.dispatchEvent(new Event('visibilitychange'))});
  await p.waitForFunction(()=>window.avatarUrls.created.every(u=>window.avatarUrls.revoked.includes(u)));
  await delay(120);member=false;const hiddenCount=gets.length;
  await p.evaluate(()=>{window.testVisibility='visible';document.dispatchEvent(new Event('visibilitychange'))});
  await delay(200);assert.equal(gets.length,hiddenCount);assert.equal(await p.locator('[data-member-id] img').count(),0);
  member=true;await p.evaluate(()=>{window.testVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'));window.testVisibility='visible';document.dispatchEvent(new Event('visibilitychange'))});
  await p.locator('[data-member-id] img').first().waitFor();assert(gets.length>hiddenCount);
  // Switch the actual SDK session via its cross-tab Auth channel.
  member=false;activeUser={...user,id:id(999),email:'other@example.invalid'};
  await p.evaluate(newUser=>{const channel=new BroadcastChannel('sb-127-auth-token');channel.postMessage({event:'SIGNED_IN',session:{access_token:'synthetic-other',refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+7200,user:newUser}});setTimeout(()=>channel.close(),100)},activeUser);
  await p.waitForFunction(()=>document.querySelectorAll('[role=tab]').length===2);await tabs.getByRole('tab',{name:'メンバー',exact:true}).click();await p.getByText('公開名',{exact:true}).waitFor();
  await p.waitForFunction(()=>window.avatarUrls.created.every(u=>window.avatarUrls.revoked.includes(u)));
  const stopped=gets.length;await tabs.getByRole('tab',{name:'メンバー',exact:true}).click();await delay(200);assert.equal(gets.length,stopped);assert.equal(await p.locator('[data-member-id] img').count(),0);
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);
  await c.close();console.log(`375px ${theme}: visible rows/concurrency/crop/tab disposal/revisit/auth switch/nonmember no GET PASS (synthetic API)`);
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
