// Local Next UI + synthetic API only. No staging Auth or production data.
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {navigationFixture,user,clubA,id}=require('../fixtures/navigation-app.cjs');
const base=process.env.NAMED_JOIN_TEST_URL||'http://127.0.0.1:3070',remote='http://127.0.0.1:54321';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const theme of ['dark','light']){
  const f=navigationFixture(),before=structuredClone({profiles:f.tables.player_profiles,scores:f.tables.match_results});
  f.tables.club_members=[];Object.assign(f.tables.user_preferences[0],{theme_mode:theme,tutorial_status:'completed'});
  const refs=[id(610),id(611)],rawIds=[id(510),id(511)];
  const directory=[{reference:refs[0],display_name:'Aグループの仮登録別名',is_unlinked:true},{reference:refs[1],display_name:'もう一人の仮名',is_unlinked:true},{reference:id(612),display_name:'確認済み公開名',is_unlinked:false}];
  let pending=[],failure=null,hold=false,releaseSubmit,holdPreview=false,releasePreview,tokenVersion=1,seq=900;
  const calls=[],errors=[],outside=[];
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
   if(name==='get_my_club_memberships')return answer(200,[]);
   if(name==='get_public_club_member_count')return answer(200,4);
   if(name==='get_public_club_directory')return answer(200,body.p_club_id===clubA?directory:[]);
   if(name==='get_club_join_requests')return answer(200,pending);
   if(name==='get_club_join_request_names')return answer(200,[{id:user.id,display_name:'本人'}]);
   if(name==='preview_public_club_claim'){
    assert(refs.includes(body.p_reference));assert.equal(body.p_club_id,clubA);const token=`${body.p_reference}:${tokenVersion}`;
    if(holdPreview&&body.p_reference===refs[0]){holdPreview=false;await new Promise(resolve=>releasePreview=resolve);}
    return answer(200,{display_name:'本人プロフィール名で上書きしない',target_display_name:'本人',has_target:true,review_token:token,membership_count:1,participant_count:2,match_count:body.p_reference===refs[0]?3:9,result_count:3,team_match_count:0,official_match_count:0});
   }
   if(name==='submit_public_club_claim_named'){
    assert.equal(body.p_club_id,clubA);assert.equal(body.p_public_confirmation,body.p_reference!==null);assert(!rawIds.includes(body.p_reference));
    if(hold)await new Promise(resolve=>releaseSubmit=resolve);
    if(failure){const code=failure;failure=null;tokenVersion++;return answer(code==='PT409'?409:403,{code,message:'synthetic refusal'});}
    assert.equal(body.p_review_token,body.p_reference?`${body.p_reference}:${tokenVersion}`:null);
    const request=id(seq++);pending=[{id:request,club_id:clubA,target_club_member_id:body.p_reference,requester_auth_user_id:user.id,requester_player_profile_id:null,message:body.p_message,status:'pending',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),consent_at:body.p_reference?new Date().toISOString():null,requester_display_name_snapshot:'本人'}];return answer(200,request);
   }
   if(name==='review_profile_join_request'){assert.equal(body.p_decision,'cancelled');pending=[];return answer(200,{status:'cancelled'});}
   if(['submit_public_club_claim','submit_profile_join_request','submit_profile_join_request_named'].includes(name))throw Error('Legacy/internal join gateway used');
   if(['POST','PATCH','DELETE'].includes(method)&&['club_members','player_profiles','profiles','join_requests'].includes(name))throw Error('Unexpected direct write');
   const response=await f.fetch(u.href,{method,headers:r.headers(),body:r.postData()||undefined});return route.fulfill({status:response.status,headers:{...headers,...Object.fromEntries(response.headers)},body:await response.text()});
  });
  const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  const dialog=()=>p.getByRole('dialog',{name:'加入申請を確認'}),send=()=>dialog().getByRole('button',{name:'申請する',exact:true});
  const count=()=>calls.filter(c=>c.name==='submit_public_club_claim_named').length;
  const publicCheck=()=>dialog().getByLabel('承認後、グループ内表示名を未所属者にも公開する（OFFでも申請できます）',{exact:true});
  const agree=()=>dialog().getByLabel('この仮登録選手が自分であり、管理者の承認後に表示された所属・戦績を引き継ぐことに同意します',{exact:true});
  const input=()=>dialog().getByLabel('グループ内表示名',{exact:true});
  const select=()=>dialog().getByLabel('加入時に引き継ぐ仮登録選手');
  const open=async()=>{await p.getByRole('button',{name:'加入申請を確認',exact:true}).click();await dialog().waitFor();};
  const cancelRequest=async()=>{await p.getByRole('button',{name:'申請を取り消す',exact:true}).click();await p.getByRole('button',{name:'加入申請を確認',exact:true}).waitFor();};
  await p.goto(base+'/groups/'+clubA);await open();await p.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
  const box=await dialog().boundingBox();assert(box.x>=0&&box.x+box.width<=375);assert((await send().boundingBox()).height>=44);
  assert.equal(await input().inputValue(),'');await input().fill('取り消す名前');await publicCheck().check();await dialog().getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(count(),0);
  await open();assert.equal(await input().inputValue(),'');await input().fill('新規加入の名前');await dialog().getByLabel('メッセージ（任意）').fill('メモ保持');assert(await send().isEnabled());
  await publicCheck().uncheck();failure='42501';await send().click();await dialog().getByRole('alert').waitFor();assert.equal(count(),1);assert.equal(await input().inputValue(),'新規加入の名前');assert.equal(await dialog().getByLabel('メッセージ（任意）').inputValue(),'メモ保持');
  hold=true;await send().click();await p.waitForTimeout(100);assert.equal(count(),2);assert(await dialog().getByRole('button',{name:'送信中…'}).isDisabled());hold=false;releaseSubmit();await dialog().waitFor({state:'hidden'});await p.getByText('申請中です',{exact:true}).waitFor();
  assert.equal(await p.locator('[data-member-id]').getByText('新規加入の名前',{exact:true}).count(),0);assert.deepEqual(calls.filter(c=>c.name==='submit_public_club_claim_named')[0].body,{p_club_id:clubA,p_reference:null,p_message:'メモ保持',p_review_token:null,p_club_display_name:'新規加入の名前',p_public_confirmation:false});
  await cancelRequest();await open();await select().selectOption(refs[0]);await agree().waitFor();assert.equal(await input().inputValue(),'Aグループの仮登録別名');assert.equal(await dialog().getByRole('option',{name:'確認済み公開名',exact:true}).count(),0);
  await input().fill('本人が決めた別名');await publicCheck().check();assert(await send().isDisabled());await agree().check();failure='P0001';const n=count();await send().click();await dialog().getByRole('alert').waitFor();assert.equal(count(),n+1);assert.equal(await input().inputValue(),'本人が決めた別名');
  await dialog().getByRole('button',{name:'引き継ぐ内容を再確認'}).click();await agree().waitFor();assert.equal(await input().inputValue(),'本人が決めた別名');assert(await publicCheck().isChecked());assert(!(await agree().isChecked()));await publicCheck().check();await agree().check();await send().click();await dialog().waitFor({state:'hidden'});await p.getByText('申請中です',{exact:true}).waitFor();
  assert.equal(await p.locator('[data-member-id]').getByText('本人が決めた別名',{exact:true}).count(),0);await cancelRequest();
  await open();holdPreview=true;await select().selectOption(refs[0]);await p.waitForTimeout(100);assert(releasePreview);
  await select().selectOption(refs[1]);await agree().waitFor();releasePreview();await p.waitForTimeout(100);assert.equal(await input().inputValue(),'もう一人の仮名');
  await agree().check();await publicCheck().check();await send().click();await dialog().waitFor({state:'hidden'});await p.getByText('申請中です',{exact:true}).waitFor();
  const last=calls.filter(c=>c.name==='submit_public_club_claim_named').at(-1).body;assert.equal(last.p_reference,refs[1]);assert.equal(last.p_review_token,`${refs[1]}:${tokenVersion}`);
  assert.deepEqual({profiles:f.tables.player_profiles,scores:f.tables.match_results},before);assert.equal(f.tables.club_members.length,0);assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await c.close();console.log(`375px ${theme}: new join / claim / consent / input retention / refresh / stale preview / pending privacy PASS (synthetic API)`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
