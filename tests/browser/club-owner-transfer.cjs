// Local UI with synthetic Auth/RPC only; no real Supabase or production data.
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {navigationFixture,user,player,clubA,id}=require('../fixtures/navigation-app.cjs');
const base=process.env.OWNER_TRANSFER_TEST_URL||'http://127.0.0.1:3070',remote='http://127.0.0.1:54321';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const theme of ['dark','light']){
  const f=navigationFixture(),recipient={...user,id:id(92),email:'recipient@example.invalid'},outsider={...user,id:id(99),email:'outside@example.invalid'};
  const own=f.tables.club_members.find(m=>m.club_id===clubA);own.role='main_admin';
  f.tables.player_profiles.push({id:id(91),linked_auth_user_id:recipient.id,display_name:'引継ぎ候補',is_active:true},{id:id(93),linked_auth_user_id:null,display_name:'未連携の仮メイン',is_active:true},{id:id(96),linked_auth_user_id:id(97),display_name:'サブ管理者',is_active:true});
  const target={id:id(94),club_id:clubA,player_profile_id:id(91),profile_id:recipient.id,role:'main_admin',is_active:true,status:'active'};
  f.tables.club_members.push(target,{id:id(95),club_id:clubA,player_profile_id:id(93),profile_id:null,role:'main_admin',is_active:true,status:'active'},{id:id(98),club_id:clubA,player_profile_id:id(96),profile_id:id(97),role:'sub_admin',is_active:true,status:'active'});
  Object.assign(f.tables.user_preferences[0],{theme_mode:theme,tutorial_status:'completed'});
  const scores=structuredClone(f.tables.match_results),profiles=structuredClone(f.tables.player_profiles);
  let owner=user.id,requests=[],notifications=[],failure=null,readFailure=false,hold=false,release,seq=810;
  const calls=[],outside=[],errors=[],contexts=[];
  const memberUser=m=>f.tables.player_profiles.find(p=>p.id===m.player_profile_id)?.linked_auth_user_id;
  const candidateRows=()=>f.tables.club_members.filter(m=>m.club_id===clubA&&m.role==='main_admin'&&m.is_active&&m.status==='active'&&memberUser(m)&&memberUser(m)!==owner).map(m=>({member_id:m.id,display_name:f.tables.player_profiles.find(p=>p.id===m.player_profile_id).display_name}));
  const row=(r,actor)=>({id:r.id,club_id:clubA,club_name:'グループA',status:r.status,created_at:'2000-01-01T00:00:00Z',responded_at:r.status==='pending'?null:'2026-11-20T00:00:00Z',is_sender:r.from===actor.id,is_recipient:r.to===actor.id,target_display_name:'引継ぎ候補'});
  const openActor=async actor=>{
   const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,colorScheme:theme});contexts.push(c);
   await c.addInitScript(({base,user})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{base,user:actor});
   const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};
   await c.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),method=req.method(),b=req.postData()?JSON.parse(req.postData()):null;
    const answer=(status,value)=>route.fulfill({status,headers,body:JSON.stringify(value)});
    if(u.origin===base){if(u.pathname.startsWith('/api/'))return answer(200,{profile:null,imageEnabled:false});return route.continue();}
    if(u.origin!==remote){outside.push(u.origin);return route.abort();}
    if(method==='OPTIONS')return answer(200,{});if(u.pathname.startsWith('/auth/'))return answer(200,actor);
    const name=u.pathname.split('/').at(-1);calls.push({name,method,b,actor:actor.id,select:u.searchParams.get('select')});
    if(name==='get_my_club_memberships')return answer(200,f.tables.club_members.filter(m=>memberUser(m)===actor.id));
    if(name==='get_club_roster')return answer(200,f.tables.club_members.filter(m=>m.club_id===b.p_club_id).map(m=>({...m,player_profiles:f.tables.player_profiles.find(p=>p.id===m.player_profile_id)})));
    if(name==='get_club_owner_transfer_candidates')return actor.id===owner&&b.p_club_id===clubA?answer(200,candidateRows()):answer(403,{code:'42501'});
    if(name==='list_my_club_owner_transfers'){
     if(readFailure){readFailure=false;return answer(403,{code:'42501'});}
     return answer(200,requests.filter(r=>r.from===actor.id||r.to===actor.id).map(r=>row(r,actor)).reverse());
    }
    if(name==='request_club_owner_transfer'){
     assert.equal(actor.id,owner);assert.equal(b.p_club_id,clubA);assert(candidateRows().some(c=>c.member_id===b.p_to_member_id));
     if(hold)await new Promise(r=>release=r);
     if(failure&&failure!=='network-after-commit'){const code=failure;failure=null;return answer(code==='PT409'?409:403,{code});}
     assert(!requests.some(r=>r.status==='pending'));
     const r={id:id(seq++),from:actor.id,to:recipient.id,status:'pending'};requests.push(r);
     notifications.push({id:id(seq++),target:recipient.id,title:'オーナー引継ぎの依頼',body:'本人が確認してください',is_read:false,created_at:'2026-11-20',related_club_id:clubA,related_owner_transfer_request_id:r.id});
     if(failure==='network-after-commit'){failure=null;return route.abort();}
     return answer(200,r.id);
    }
    if(name==='cancel_club_owner_transfer'||name==='respond_club_owner_transfer'){
     const r=requests.find(r=>r.id===b.p_request_id);assert(r);assert.equal(r.status,'pending');
     const decision=name==='cancel_club_owner_transfer'?'cancelled':b.p_decision;
     if(decision==='cancelled'){assert.equal(actor.id,r.from);assert.equal(owner,actor.id);}
     else{assert.equal(actor.id,r.to);if(decision==='accepted'&&(target.role!=='main_admin'||!target.is_active||owner!==r.from))return answer(403,{code:'42501'});}
     r.status=decision;if(decision==='accepted')owner=actor.id;return answer(200,decision);
    }
    if(name==='leave_my_club'){
     assert.notEqual(actor.id,owner);assert.equal(b.p_member_id,own.id);assert.equal(b.p_club_id,clubA);own.is_active=false;own.status='inactive';return answer(200,own.id);
    }
    if(name==='notifications'){
     assert.equal(method==='GET'||method==='HEAD'||method==='PATCH',true);
     let list=notifications.filter(n=>n.target===actor.id).slice().reverse();
     if(method==='PATCH')for(const n of list)if(!n.is_read&&(!u.searchParams.get('id')||u.searchParams.get('id')==='eq.'+n.id))n.is_read=true;
     return answer(200,list.map(({target,...n})=>n));
    }
    if(['club_owner_transfer_requests','club_members','clubs','player_profiles','profiles'].includes(name)&&['POST','PATCH','DELETE'].includes(method))throw Error('Unexpected direct write: '+name);
    const response=await f.fetch(u.href,{method,headers:req.headers(),body:req.postData()||undefined});return route.fulfill({status:response.status,headers:{...headers,...Object.fromEntries(response.headers)},body:await response.text()});
   });
   const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));return p;
  };
  const p=await openActor(user),dialog=p=>p.getByRole('dialog',{name:'オーナー引継ぎを確認',exact:true});
  const send=p=>dialog(p).getByRole('button',{name:'引継ぎを依頼する',exact:true}),count=name=>calls.filter(c=>c.name===name).length;
  const openCenter=async page=>{await page.getByRole('button',{name:'グループの操作',exact:true}).waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent==='処理中...'));if(await page.getByRole('dialog',{name:'オーナー引継ぎ',exact:true}).isVisible())return;if(!await page.getByRole('dialog',{name:'グループの操作',exact:true}).isVisible())await page.getByRole('button',{name:'グループの操作',exact:true}).click();await page.getByRole('dialog',{name:'グループの操作',exact:true}).getByRole('button',{name:'オーナー引継ぎ',exact:true}).click();await page.getByRole('dialog',{name:'オーナー引継ぎ',exact:true}).waitFor();};
  const openRequest=async()=>{await p.getByRole('button',{name:'オーナーを引き継ぐ',exact:true}).click();await dialog(p).waitFor();};
  const select=()=>dialog(p).getByLabel('引継ぎ先',{exact:true}),confirm=p=>dialog(p).getByRole('checkbox');
  const refresh=async p=>{await dialog(p).getByRole('button',{name:'再読み込み',exact:true}).click();await p.waitForFunction(()=>Array.from(document.querySelectorAll('dialog[open] button')).some(b=>b.textContent==='再読み込み'&&!b.disabled));};
  const close=async p=>{await dialog(p).getByRole('button',{name:'閉じる',exact:true}).last().click();await dialog(p).waitFor({state:'hidden'});await p.waitForTimeout(120);};
  await p.goto(base+'/groups/'+clubA);await p.getByRole('button',{name:'グループの操作',exact:true}).waitFor();await p.getByRole('button',{name:'グループの操作',exact:true}).click();await p.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
  assert(await p.getByRole('button',{name:'このグループを退会する',exact:true}).isDisabled());
  await p.getByRole('dialog',{name:'グループの操作',exact:true}).getByRole('button',{name:'閉じる',exact:true}).first().click();await p.getByRole('tab',{name:'メンバー',exact:true}).click();const ownRow=p.locator(`[data-member-id="${own.id}"]`);await ownRow.click();const ownDetail=p.getByRole('dialog',{name:'メンバー詳細',exact:true});await ownDetail.getByRole('button',{name:'編集',exact:true}).click();assert(await ownDetail.getByRole('combobox').isDisabled());await ownDetail.getByRole('button',{name:'閉じる',exact:true}).first().click();assert.equal(count('set_club_member_role'),0);
  await p.getByRole('tab',{name:'概要',exact:true}).click();await openCenter(p);await openRequest();
  assert.equal(await select().getByRole('option').count(),2);assert.equal(await select().getByRole('option',{name:'未連携の仮メイン',exact:true}).count(),0);assert.equal(await select().getByRole('option',{name:'サブ管理者',exact:true}).count(),0);
  const box=await dialog(p).boundingBox();assert(box.x>=0&&box.x+box.width<=375);assert((await send(p).boundingBox()).height>=44);await p.goBack();await p.getByRole('dialog',{name:'オーナー引継ぎ',exact:true}).waitFor();assert.equal(count('request_club_owner_transfer'),0);await openRequest();
  const contrast=await select().evaluate(el=>{const s=getComputedStyle(el),lum=color=>{const [r,g,b]=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b;};const a=lum(s.color),b=lum(s.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});assert(contrast>=4.5);
  await select().selectOption(target.id);assert(await send(p).isDisabled());await confirm(p).check();await close(p);assert.equal(count('request_club_owner_transfer'),0);
  await openRequest();assert.equal(await select().inputValue(),target.id);await confirm(p).check();failure='PT409';await send(p).click();await dialog(p).getByRole('alert').waitFor();assert.equal(await select().inputValue(),target.id);assert(await confirm(p).isChecked());assert(await send(p).isDisabled());assert.equal(count('request_club_owner_transfer'),1);
  readFailure=true;await refresh(p);await dialog(p).getByRole('alert').waitFor();assert.equal(await select().inputValue(),target.id);assert(await confirm(p).isChecked());
  await refresh(p);assert.equal(await select().inputValue(),target.id);assert(!(await confirm(p).isChecked()));target.role='sub_admin';await refresh(p);assert.equal(await select().inputValue(),target.id);assert(await send(p).isDisabled());await dialog(p).getByText('選択した候補は現在引き継げません。候補を選び直してください。',{exact:true}).waitFor();target.role='main_admin';await refresh(p);await confirm(p).check();hold=true;await send(p).click();await p.waitForTimeout(100);assert.equal(count('request_club_owner_transfer'),2);assert(await dialog(p).getByRole('button',{name:'処理中…',exact:true}).isDisabled());hold=false;release();await dialog(p).getByRole('status').waitFor();assert.equal(owner,user.id);assert.equal(own.is_active,true);assert.equal(count('leave_my_club'),0);await close(p);
  // Sender cannot approve; cancellation keeps owner unchanged.
  await p.getByRole('button',{name:/グループA：返答待ち/}).click();assert.equal(await dialog(p).getByRole('button',{name:'引き受ける',exact:true}).count(),0);await dialog(p).getByRole('button',{name:'申請を取り消す',exact:true}).click();await confirm(p).check();await dialog(p).getByRole('button',{name:'取消を確定する',exact:true}).click();await dialog(p).getByRole('status').waitFor();assert.equal(owner,user.id);await close(p);
  // Unknown request outcome: do not retry; manual read discovers committed pending.
  await openRequest();await confirm(p).check();failure='network-after-commit';const n=count('request_club_owner_transfer');await send(p).click();await dialog(p).getByRole('alert').waitFor();assert.equal(count('request_club_owner_transfer'),n+1);assert.equal(await select().inputValue(),target.id);await refresh(p);assert(await send(p).isDisabled());await close(p);
  // Recipient follows actual notification link, sees only their own DTO and can decline after demotion.
  const q=await openActor(recipient);await q.goto(base+'/notifications');const notice=q.getByRole('link',{name:'オーナー引継ぎを確認する',exact:true});await notice.first().waitFor();await notice.first().click();await dialog(q).waitFor();await dialog(q).getByRole('button',{name:'引き受ける',exact:true}).waitFor();
  assert.equal(await dialog(q).getByRole('button',{name:'申請を取り消す',exact:true}).count(),0);
  await dialog(q).getByRole('button',{name:'引き受ける',exact:true}).click();await confirm(q).check();target.role='sub_admin';await dialog(q).getByRole('button',{name:'引受を確定する',exact:true}).click();await dialog(q).getByRole('alert').waitFor();assert(await confirm(q).isChecked());assert.equal(owner,user.id);await refresh(q);assert(await dialog(q).getByRole('button',{name:'引き受ける',exact:true}).isDisabled());await dialog(q).getByRole('button',{name:'辞退する',exact:true}).click();await confirm(q).check();await dialog(q).getByRole('button',{name:'辞退を確定する',exact:true}).click();await dialog(q).getByRole('status').waitFor();assert.equal(owner,user.id);await close(q);
  target.role='main_admin';await p.getByRole('button',{name:'引継ぎ状況を再読み込み',exact:true}).click();await openRequest();await confirm(p).check();await send(p).click();await dialog(p).getByRole('status').waitFor();await close(p);
  const pending=requests.find(r=>r.status==='pending');await q.goto(base+'/groups/owner-transfers/'+pending.id);await dialog(q).getByRole('button',{name:'引き受ける',exact:true}).click();await confirm(q).check();await dialog(q).getByRole('button',{name:'引受を確定する',exact:true}).click();await dialog(q).getByRole('status').waitFor();assert.equal(owner,recipient.id);assert.equal(own.is_active,true);assert.equal(own.role,'main_admin');assert.equal(target.role,'main_admin');assert.equal(count('leave_my_club'),0);
  await p.getByRole('button',{name:'引継ぎ状況を再読み込み',exact:true}).click();await p.getByRole('dialog',{name:'オーナー引継ぎ',exact:true}).getByRole('button',{name:'閉じる',exact:true}).first().click();const leave=p.getByRole('button',{name:'このグループを退会する',exact:true});await leave.waitFor();await p.waitForTimeout(150);assert(await leave.isEnabled());assert.equal(await p.getByRole('button',{name:'オーナーを引き継ぐ',exact:true}).count(),0);
  await leave.click();const exit=p.getByRole('dialog',{name:'グループを退会しますか？'});await exit.getByRole('checkbox').check();await exit.getByRole('button',{name:'退会する',exact:true}).click();await p.waitForURL('**/profile#profile-groups');assert.equal(count('leave_my_club'),1);assert.equal(own.is_active,false);
  // Another account cannot inspect/answer the request, even with a copied notification URL.
  const z=await openActor(outsider);await z.goto(base+'/groups/owner-transfers/'+pending.id);await dialog(z).getByText('本人の確認可能な申請がありません。再読み込みしてください。',{exact:true}).waitFor();assert.equal(await dialog(z).getByRole('button',{name:'引き受ける',exact:true}).count(),0);assert.equal(await dialog(z).getByText('引継ぎ候補',{exact:true}).count(),0);await close(z);
  // New owner has no eligible linked peer after former owner leaves; legacy NULL never creates an owner.
  await close(q);await q.goto(base+'/groups/'+clubA);await openCenter(q);await q.getByRole('button',{name:'オーナーを引き継ぐ',exact:true}).click();await dialog(q).getByText('候補者には、メイン管理者への昇格と本人アカウント連携が必要です。自動では変更しません。',{exact:true}).waitFor();assert(await send(q).isDisabled());await close(q);
  owner=null;await q.reload();await openCenter(q);await q.getByRole('button',{name:'引継ぎ状況を再読み込み',exact:true}).waitFor();assert.equal(await q.getByRole('button',{name:'オーナーを引き継ぐ',exact:true}).count(),0);assert.equal(owner,null);
  assert(calls.some(c=>c.name==='notifications'&&c.select?.includes('related_owner_transfer_request_id')));assert.deepEqual(f.tables.match_results,scores);assert.deepEqual(f.tables.player_profiles,profiles);assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);assert(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const c of contexts)await c.close();console.log(`375px ${theme}: owner-only candidates / request-cancel / PT409-network retention / notification / demotion-decline / acceptance / separate former-owner exit / unauthorized and legacy PASS (synthetic API)`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
