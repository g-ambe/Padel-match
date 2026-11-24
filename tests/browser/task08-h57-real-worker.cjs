// Actual built Worker + local Supabase Auth/Data API. No fulfillment or fake session.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(path.join(process.env.RUNNER_TEMP,'task08-playwright','node_modules','playwright'));
const {url,base,actors,ids}=JSON.parse(fs.readFileSync(0,'utf8'));
let phase='setup',checks=0,joinStatus=null;
const mark=(name)=>{checks++;};
const tabs=p=>p.getByRole('tablist',{name:'グループ詳細'});
const rows=p=>p.locator('[data-member-id]');
const approve=p=>p.getByRole('button',{name:'承認',exact:true});
const nameField=p=>p.getByLabel('グループ内表示名',{exact:true});
const inherit=p=>p.getByLabel('この仮登録選手が自分であり、表示された所属・戦績を引き継ぐことに同意します',{exact:true});
const publication=p=>p.getByLabel('承認後、この表示名が公開グループのメンバー一覧に表示されます',{exact:true});
const pending=p=>p.getByText('申請中です',{exact:true});
const roleTheme={owner:'light',recipient:'dark',outsider:'light'};
async function openGroup(p,club){
 const r=await p.goto(base+'/groups/'+ids['browser_'+club]);assert.equal(r.status(),200);
 await p.getByRole('heading',{name:'H57 '+club,exact:true}).waitFor();
 await p.getByText('処理中...',{exact:true}).waitFor({state:'hidden'});
 await tabs(p).waitFor();
}
async function viewport(p){
 assert(await p.evaluate(()=>innerWidth===375&&document.documentElement.scrollWidth<=innerWidth));
}
async function openRequest(p,club){
 const r=await p.goto(base+'/profile/links/'+ids['browser_'+club+'_request']);assert.equal(r.status(),200);
 await p.getByText('申請元：H57 '+club,{exact:true}).waitFor();
}
async function rpcClick(p,endpoint,button,inspect){
 const response=p.waitForResponse(r=>r.url()===url+'/rest/v1/rpc/'+endpoint&&r.request().method()==='POST');
 const [r]=await Promise.all([response,button.click()]);
 assert(r.ok());if(inspect)inspect(r.request().postDataJSON());
}
async function main(){
 assert.equal(url,'http://127.0.0.1:54321');assert.equal(base,'http://127.0.0.1:3070');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const contexts=[],pages={},errors=[];
 try{
  for(const role of ['owner','recipient','outsider']){
   phase='login_'+role;
   const actor=actors.find(a=>a.role===role),theme=roleTheme[role];
   assert(actor&&actor.email&&actor.password);
   const ctx=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,colorScheme:theme,serviceWorkers:'block'});
   contexts.push(ctx);
   await ctx.route('**/*',route=>{
    const origin=new URL(route.request().url()).origin;
    // No API response is mocked. Deny all non-local connections.
    return origin===url||origin===base?route.continue():route.abort();
   });
   const page=await ctx.newPage();pages[role]=page;page.setDefaultTimeout(25000);
   page.on('pageerror',e=>errors.push({phase,name:e.name}));
   const r=await page.goto(base+'/login');assert.equal(r.status(),200);
   await page.getByLabel('メールアドレス',{exact:true}).fill(actor.email);
   await page.getByLabel('パスワード',{exact:true}).fill(actor.password);
   const token=page.waitForResponse(r=>r.url().startsWith(url+'/auth/v1/token?')&&r.request().method()==='POST');
   await page.getByRole('button',{name:'ログインする',exact:true}).click();
   assert((await token).ok());
   await page.waitForURL(base+'/home');
   await page.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
   mark(phase);
  }
  const {owner,recipient,outsider}=pages;
  phase='public_boundary';
  await openGroup(outsider,'public');
  assert.deepEqual(await tabs(outsider).getByRole('tab').allTextContents(),['概要','メンバー']);
  await outsider.getByText('2人',{exact:true}).waitFor();
  assert.equal(await outsider.getByRole('button',{name:'グループの操作',exact:true}).count(),0);
  await tabs(outsider).getByRole('tab',{name:'メンバー',exact:true}).click();
  await rows(outsider).filter({hasText:'H57 public current'}).waitFor();
  assert.equal(await rows(outsider).count(),1);
  assert.equal(await rows(outsider).locator('img').count(),0);
  assert.equal(await rows(outsider).getByText('メイン管理者',{exact:true}).count(),0);
  await viewport(outsider);mark(phase);
  phase='private_boundary';
  await recipient.goto(base+'/groups/'+ids.browser_private);
  await recipient.getByText('このグループを表示できません',{exact:true}).waitFor();
  assert.equal(await tabs(recipient).count(),0);mark(phase);
  phase='manager_view';
  await openRequest(owner,'public');
  await owner.getByText('対象選手：H57 public provisional',{exact:true}).waitFor();
  assert.equal(await nameField(owner).count(),0);assert.equal(await inherit(owner).count(),0);
  assert.equal(await publication(owner).count(),0);assert.equal(await approve(owner).count(),0);mark(phase);
  phase='third_party';
  await outsider.goto(base+'/profile/links/'+ids.browser_public_request);
  await outsider.locator('main [role="alert"]').waitFor();
  assert.equal(await nameField(outsider).count(),0);assert.equal(await approve(outsider).count(),0);mark(phase);
  phase='public_approval';
  await openRequest(recipient,'public');
  await recipient.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await nameField(recipient).fill('H57 公開本人名');
  assert(await approve(recipient).isDisabled());
  await inherit(recipient).check();assert(await approve(recipient).isDisabled());
  await publication(recipient).check();assert(await approve(recipient).isEnabled());
  await viewport(recipient);
  assert((await approve(recipient).boundingBox()).height>=44);
  await rpcClick(recipient,'review_player_profile_link_named',approve(recipient),b=>{
   assert.equal(b.p_request_id,ids.browser_public_request);
   assert.equal(b.p_club_display_name,'H57 公開本人名');assert.equal(b.p_public_confirmation,true);
   assert(typeof b.p_review_token==='string'&&b.p_review_token.length>0);
  });
  await recipient.getByText('連携が完了しました',{exact:true}).waitFor();mark(phase);
  phase='private_approval';
  await openRequest(outsider,'private');
  await outsider.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await nameField(outsider).fill('H57 非公開本人名');
  assert.equal(await publication(outsider).count(),0);
  assert(await approve(outsider).isDisabled());
  await inherit(outsider).check();assert(await approve(outsider).isEnabled());
  await viewport(outsider);
  await rpcClick(outsider,'review_player_profile_link_named',approve(outsider),b=>{
   assert.equal(b.p_request_id,ids.browser_private_request);
   assert.equal(b.p_club_display_name,'H57 非公開本人名');assert.equal(b.p_public_confirmation,false);
  });
  await outsider.getByText('連携が完了しました',{exact:true}).waitFor();mark(phase);
  phase='public_readback';
  await openGroup(outsider,'public');
  await tabs(outsider).getByRole('tab',{name:'メンバー',exact:true}).click();
  await rows(outsider).getByText('H57 公開本人名',{exact:true}).waitFor();
  assert.equal(await rows(outsider).count(),1);
  assert.equal(await rows(outsider).getByText('H56 recipient',{exact:false}).count(),0);mark(phase);
  phase='member_readback';
  await openGroup(recipient,'public');
  assert.deepEqual(await tabs(recipient).getByRole('tab').allTextContents(),['概要','メンバー','戦績']);
  await tabs(recipient).getByRole('tab',{name:'メンバー',exact:true}).click();
  await rows(recipient).filter({hasText:'H57 公開本人名'}).waitFor();
  assert((await rows(recipient).filter({hasText:'H57 公開本人名'}).innerText()).includes('H56 recipient'));
  assert.equal(await rows(recipient).count(),2);
  await viewport(recipient);mark(phase);
  phase='join_submit';
  await openGroup(outsider,'join');
  await outsider.getByRole('button',{name:'加入申請を確認',exact:true}).click();
  const dialog=outsider.getByRole('dialog',{name:'加入申請を確認'});
  await dialog.waitFor();
  await dialog.getByLabel('グループ内表示名',{exact:true}).fill('H57 加入本人名');
  const send=dialog.getByRole('button',{name:'申請する',exact:true});
  assert(await send.isDisabled());
  await dialog.getByLabel('承認後この表示名がメンバー一覧に表示されます',{exact:true}).check();
  assert(await send.isEnabled());await viewport(outsider);
  await rpcClick(outsider,'submit_public_club_claim_named',send,b=>{
   assert.equal(b.p_club_id,ids.browser_join);assert.equal(b.p_reference,null);
   assert.equal(b.p_club_display_name,'H57 加入本人名');assert.equal(b.p_public_confirmation,true);
  });
  await dialog.waitFor({state:'hidden'});await pending(outsider).waitFor();
  assert.deepEqual(await tabs(outsider).getByRole('tab').allTextContents(),['概要','メンバー']);mark(phase);
  phase='join_approve';
  await openGroup(owner,'join');
  await owner.getByRole('button',{name:'グループの操作',exact:true}).click();
  await owner.getByRole('dialog',{name:'グループの操作',exact:true}).getByRole('button',{name:'加入申請',exact:true}).click();
  const list=owner.getByRole('dialog',{name:'加入申請',exact:true});
  await list.getByRole('button',{name:'承認',exact:true}).waitFor();
  phase='join_approve_rpc';
  const response=owner.waitForResponse(r=>r.url()===url+'/rest/v1/rpc/review_profile_join_request'&&r.request().method()==='POST');
  const [approvalResponse]=await Promise.all([response,list.getByRole('button',{name:'承認',exact:true}).click()]);
  joinStatus=approvalResponse.status();
  assert(approvalResponse.ok(),'join approval HTTP');
  const approvalBody=await approvalResponse.json();
  assert.equal(approvalBody.status,'approved');
  assert.equal(approvalResponse.request().postDataJSON().p_decision,'approved');
  phase='join_approve_feedback';
  // The actual group page renders the message both behind and inside its
  // modal. A page-wide getByText() is a strict-mode ambiguity.
  await list.getByText('承認しました',{exact:true}).waitFor();
  phase='join_approve_status';
  await list.getByText('承認済み / 希望メンバー：正規プロフィールで加入',{exact:true}).waitFor();
  assert.equal(await list.getByRole('button',{name:'承認',exact:true}).count(),0);
  mark('join_approve');
  phase='join_readback';
  await openGroup(outsider,'join');
  assert.deepEqual(await tabs(outsider).getByRole('tab').allTextContents(),['概要','メンバー','戦績']);
  await tabs(outsider).getByRole('tab',{name:'メンバー',exact:true}).click();
  await rows(outsider).filter({hasText:'H57 加入本人名'}).waitFor();
  assert.equal(await rows(outsider).count(),2);
  await viewport(outsider);mark(phase);
  phase='finish';
  assert.deepEqual(errors,[]);
  for(const context of contexts)await context.close();
  return {ok:true,checks};
 }finally{await browser.close();}
}
main().then(r=>console.log(JSON.stringify(r))).catch(e=>{
 const errorKind=e?.name==='TimeoutError'?'timeout':e?.name==='AssertionError'?'assertion':String(e?.message??'').includes('strict mode violation')?'ambiguous_locator':'other';
 console.log(JSON.stringify({ok:false,phase,checks,errorKind,joinStatus}));
});
