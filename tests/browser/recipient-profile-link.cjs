// Local Next UI and synthetic Auth/API only. Never connect to staging or production.
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {navigationFixture,user,clubA,id}=require('../fixtures/navigation-app.cjs');
const base=process.env.RECIPIENT_LINK_TEST_URL||'http://127.0.0.1:3070',remote='http://127.0.0.1:54321';
const inheritance='この仮登録選手が自分であり、表示された所属・戦績を引き継ぐことに同意します';
const publication='承認後、グループ内表示名を未所属者にも公開する（OFFでも連携できます）';
const detail=()=>({id:id(800),club_id:clubA,club_name:'申請元グループA',status:'pending',created_at:'2026-11-20T00:00:00Z',expires_at:'2099-01-01T00:00:00Z',detail_scope:'recipient',is_recipient:true,
 source:{id:id(801),display_name:'仮登録の本人名',bio:null,play_level:null,dominant_hand:null,preferred_position:null,activity_area:null,is_active:true,linked_auth_user_id:null,created_at:'2026-01-01'},
 target_profile_id:id(802),target_display_name:'正規本人名',memberships:[{id:id(803),club_name:'引継ぎ対象グループ',role:'member',status:'active',is_active:true,created_at:'2026-01-01'}],participant_count:3,match_count:4,result_count:4,team_match_count:1,official_match_count:0,review_token:'token-1',group_display_name_suggestion:'グループの仮名',group_display_name_current:null,group_visibility:'public'});
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const theme of ['dark','light']){
  const f=navigationFixture(),before=structuredClone(f.tables);Object.assign(f.tables.user_preferences[0],{theme_mode:theme,tutorial_status:'completed'});before.user_preferences=structuredClone(f.tables.user_preferences);
  let record=detail(),failure=null,readFailure=false,hold=false,release;
  const calls=[],outside=[],errors=[];
  const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,colorScheme:theme});
  await c.addInitScript(({base,user})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{base,user});
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};
  await c.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url()),method=r.method(),body=r.postData()?JSON.parse(r.postData()):null;
   const answer=(status,value)=>route.fulfill({status,headers,body:JSON.stringify(value)});
   if(u.origin===base){if(u.pathname.startsWith('/api/'))return answer(200,{profile:null,imageEnabled:false});return route.continue();}
   if(u.origin!==remote){outside.push(u.origin);return route.abort();}
   if(method==='OPTIONS')return answer(200,{});if(u.pathname.startsWith('/auth/'))return answer(200,user);
   const name=u.pathname.split('/').at(-1);calls.push({name,method,body});
   if(name==='get_player_profile_link_request'){
    assert.equal(body.p_request_id,id(800));
    if(readFailure){readFailure=false;return answer(403,{code:'42501',message:'synthetic read refusal'});}
    return answer(200,record);
   }
   if(name==='review_player_profile_link_named'){
    assert.equal(record.is_recipient,true);assert.equal(body.p_request_id,record.id);assert.equal(body.p_review_token,record.review_token);
    assert.equal(body.p_expected_club_display_name,record.group_display_name_current);assert.equal(body.p_public_confirmation,record.group_visibility==='public');assert(!('p_decision' in body));
    if(hold)await new Promise(resolve=>release=resolve);
    if(failure){const code=failure;failure=null;
     if(code==='network-after-commit'){record={...record,status:'approved'};return route.abort();}
     return answer(code==='PT409'?409:403,{code,message:'synthetic refusal'});
    }
    record={...record,status:'approved'};return answer(200,{status:'approved',merge_id:id(804),club_display_name:body.p_club_display_name,public_name_confirmed:body.p_public_confirmation});
   }
   if(name==='review_player_profile_link'){
    assert(['rejected','cancelled'].includes(body.p_decision));assert.equal(body.p_request_id,record.id);
    assert.equal(body.p_review_token,record.is_recipient?record.review_token:null);
    record={...record,status:body.p_decision};return answer(200,{status:record.status});
   }
   if(name.includes('submit_public_club_claim'))throw Error('H17 gateway must not be used');
   if(['POST','PATCH','DELETE'].includes(method)&&['club_members','player_profiles','profiles','player_profile_link_requests'].includes(name))throw Error('Unexpected direct write');
   const response=await f.fetch(u.href,{method,headers:r.headers(),body:r.postData()||undefined});return route.fulfill({status:response.status,headers:{...headers,...Object.fromEntries(response.headers)},body:await response.text()});
  });
  const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  const name=()=>p.getByLabel('グループ内表示名',{exact:true}),agree=()=>p.getByLabel(inheritance,{exact:true}),publicCheck=()=>p.getByLabel(publication,{exact:true});
  const approve=()=>p.getByRole('button',{name:'承認',exact:true}),reload=()=>p.getByRole('button',{name:'再読み込み',exact:true});
  const count=()=>calls.filter(c=>c.name==='review_player_profile_link_named').length;
  const open=async()=>{await p.goto(base+'/profile/links/'+id(800));await p.getByText('申請元：申請元グループA',{exact:true}).waitFor();await p.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);};
  const ready=async()=>{await name().fill('本人が選んだ別名');await agree().check();await publicCheck().check();};
  const kept=async()=>{assert.equal(await name().inputValue(),'本人が選んだ別名');assert(await agree().isChecked());assert(await publicCheck().isChecked());};
  await open();assert.equal(await name().inputValue(),'グループの仮名');assert(await approve().isDisabled());
  await name().fill('本人が選んだ別名');await publicCheck().check();assert(await approve().isDisabled());await publicCheck().uncheck();await agree().check();assert(await approve().isEnabled());await publicCheck().check();assert(await approve().isEnabled());
  assert((await approve().boundingBox()).height>=44);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const el of [name(),agree(),publicCheck(),approve(),reload()]){
   const b=await el.boundingBox();assert(b.x>=0&&b.x+b.width<=375,'Control stays inside mobile width');
  }
  const contrast=await name().evaluate(el=>{
   const s=getComputedStyle(el),lum=color=>{const [r,g,b]=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b;};
   const a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });assert(contrast>=4.5,'Name input text is readable in both themes');
  // Both acknowledged values survive every refusal, including failed manual reload.
  for(const code of ['42501','22023','P0001','PT409']){
   failure=code;const n=count();await approve().click();await p.locator('main [role="alert"]').waitFor();assert.equal(count(),n+1);await kept();
   await p.waitForTimeout(80);assert.equal(count(),n+1);
  }
  readFailure=true;await reload().click();await p.locator('main [role="alert"]').waitFor();await kept();assert(await approve().isEnabled());
  // Explicit reload with a new CAS/token keeps name but requires consent for new content.
  record={...record,group_display_name_current:'更新後の保存名',review_token:'token-2'};
  await reload().click();await p.getByText('最新の内容を読み込みました。入力名は保持しています。引継ぎ内容と公開設定を再確認してください',{exact:true}).waitFor();
  assert.equal(await name().inputValue(),'本人が選んだ別名');assert(!(await agree().isChecked()));assert(await publicCheck().isChecked());assert(await approve().isDisabled());
  await agree().check();await publicCheck().check();hold=true;const n=count();await approve().click();await p.waitForTimeout(100);assert.equal(count(),n+1);assert(await approve().isDisabled());hold=false;release();await p.getByText('連携が完了しました',{exact:true}).waitFor();assert.equal(await name().count(),0);
  assert.deepEqual(calls.filter(c=>c.name==='review_player_profile_link_named').at(-1).body,{p_request_id:id(800),p_review_token:'token-2',p_club_display_name:'本人が選んだ別名',p_expected_club_display_name:'更新後の保存名',p_public_confirmation:true});
  // Commit may have succeeded even if response is lost: no retry; recover by GET.
  record=detail();await open();await ready();failure='network-after-commit';const old=count();await approve().click();await p.locator('main [role="alert"]').waitFor();await kept();await p.waitForTimeout(80);assert.equal(count(),old+1);await reload().click();await p.getByText('承認済み',{exact:true}).waitFor();assert.equal(await approve().count(),0);assert.equal(count(),old+1);
  // Private approval requires inheritance only, and sends false for publication.
  record={...detail(),group_visibility:'private'};await open();assert.equal(await publicCheck().count(),0);await agree().check();await approve().click();await p.getByText('連携が完了しました',{exact:true}).waitFor();assert.equal(calls.filter(c=>c.name==='review_player_profile_link_named').at(-1).body.p_public_confirmation,false);
  // Missing 0061 fields never fall back to old approval. Rejection still works.
  record=detail();delete record.group_display_name_current;await open();assert(await approve().isDisabled());await p.getByRole('button',{name:'拒否',exact:true}).click();await p.getByText('連携を拒否しました',{exact:true}).waitFor();
  // Manager sees only limited DTO, no recipient input, inherited names or tokens.
  record={id:id(800),club_id:clubA,club_name:'申請元グループA',status:'pending',created_at:'2026-11-20T00:00:00Z',expires_at:'2099-01-01T00:00:00Z',detail_scope:'manager',is_recipient:false,source_display_name:'管理対象の仮名',group_membership:{role:'member',is_active:true,created_at:'2026-01-01'}};
  const namedCount=count();await open();assert.equal(await name().count(),0);assert.equal(await agree().count(),0);assert.equal(await publicCheck().count(),0);assert.equal(await p.getByText('正規本人名',{exact:true}).count(),0);assert.equal(await p.getByText('引継ぎ対象グループ',{exact:true}).count(),0);
  await p.getByRole('button',{name:'申請を取り消す',exact:true}).click();await p.getByText('取消済み',{exact:true}).first().waitFor();assert.equal(count(),namedCount);
  assert.deepEqual(f.tables,before);assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
  await c.close();console.log(`375px ${theme}: named recipient / double consent / error retention / CAS refresh / network recovery / private / reject / manager cancellation PASS (synthetic Auth/API)`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
