// Synthetic auth responses only; no real credentials or production requests.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {navigationFixture,user}=require('../fixtures/navigation-app.cjs');
const base=process.env.NAVIGATION_TEST_URL||'http://127.0.0.1:3067',remote='http://127.0.0.1:54321';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Use a local server only');
(async()=>{
 const f=navigationFixture();f.tables.user_preferences[0].tutorial_status='completed';
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 const c=await browser.newContext({viewport:{width:375,height:812}}),errors=[],outside=[];let login=0,logout=0;
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const token={access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.test`,token_type:'bearer',expires_in:7200,refresh_token:'synthetic-refresh',user};
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};
 await c.route('**/*',async r=>{
  const q=r.request(),u=new URL(q.url()),answer=(status,body)=>r.fulfill({status,headers:cors,body:JSON.stringify(body)});
  if(u.origin===base)return r.continue();if(u.origin!==remote){outside.push(u.origin);return r.abort();}
  if(q.method()==='OPTIONS')return answer(200,{});
  if(u.pathname==='/auth/v1/token'){const b=JSON.parse(q.postData());assert.equal(b.email,user.email);assert.equal(b.password,'synthetic-password');login++;return answer(200,token);}
  if(u.pathname==='/auth/v1/logout'){logout++;return answer(200,{});}
  if(u.pathname.startsWith('/auth/'))return answer(200,user);
  const response=await f.fetch(q.url(),{method:q.method(),headers:q.headers(),body:q.postData()||undefined});return r.fulfill({status:response.status,headers:{...cors,...Object.fromEntries(response.headers)},body:await response.text()});
 });
 const p=await c.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(base+'/login');await p.getByLabel('メールアドレス',{exact:true}).fill(user.email);await p.getByLabel('パスワード',{exact:true}).fill('synthetic-password');
  await p.locator('#auth-form').getByRole('button',{name:'ログインする',exact:true}).click();await p.waitForURL(base+'/home');
  await p.getByRole('link',{name:'＋ 新しいイベントを作成',exact:true}).waitFor();assert.equal(login,1);
  await p.reload();await p.getByRole('link',{name:'＋ 新しいイベントを作成',exact:true}).waitFor();assert(await p.evaluate(()=>!!localStorage.getItem('sb-127-auth-token')));
  await p.getByRole('button',{name:'メニュー',exact:true}).click();await p.locator('#global-menu-panel').getByRole('button',{name:'ログアウト',exact:true}).click();await p.locator('#global-menu-panel').getByRole('button',{name:'ログアウトする',exact:true}).click();await p.waitForURL(base+'/');assert.equal(logout,1);assert.equal(await p.evaluate(()=>localStorage.getItem('sb-127-auth-token')),null);
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);console.log('Email login / session after reload / logout at 375px PASS (synthetic API only)');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
