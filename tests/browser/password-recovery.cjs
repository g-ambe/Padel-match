// Local mocked HTTP only. Does not prove hosted Auth, actual device or real email delivery.
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const base='http://127.0.0.1:3070',remote='http://127.0.0.1:59999';
const user={id:'00000000-0000-4000-8000-000000000001',email:'test@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url'),jwt=b64({alg:'HS256'})+'.'+b64({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})+'.synthetic';
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});try{for(const theme of ['dark','light']){
 const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,colorScheme:theme});let verify=0,updates=0,logout=0,recover=0;
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin===base)return route.continue();if(u.origin!==remote)return route.abort();const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};const reply=(status,data)=>route.fulfill({status,headers,body:JSON.stringify(data)});if(req.method()==='OPTIONS')return reply(200,{});
 if(u.pathname.endsWith('/recover')){recover++;return reply(200,{});}if(u.pathname.endsWith('/verify')){verify++;return reply(200,{access_token:jwt,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,user});}
 if(u.pathname.endsWith('/user')&&req.method()==='GET')return reply(200,user);
 if(u.pathname.endsWith('/user')&&req.method()==='PUT'){updates++;return updates===1?reply(422,{code:422,error_code:'same_password',msg:'same'}):reply(200,user);}
 if(u.pathname.endsWith('/logout')){logout++;return reply(200,{});}return reply(200,{});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);
 await page.goto(base+'/auth/reset-password');await page.getByRole('alert').waitFor();assert.equal(verify,0);
 await page.goto(base+'/auth/reset-password#token_hash='+'a'.repeat(56));await page.getByRole('button',{name:'再設定を始める'}).waitFor();assert.equal(verify,0);assert.equal(await page.evaluate(()=>location.hash),'');assert.equal(await page.getByRole('button',{name:'メニューを開く'}).count(),0);
 await page.getByRole('button',{name:'再設定を始める'}).click();await page.getByLabel('新しいパスワード').fill('password123');await page.getByLabel('パスワード確認').fill('password123');await page.getByRole('button',{name:'パスワードを変更'}).click();await page.getByText('現在と同じパスワードは設定できません。別のパスワードを入力してください。').waitFor();
 await page.getByLabel('新しいパスワード').fill('otherpass123');await page.getByLabel('パスワード確認').fill('otherpass123');await page.getByRole('button',{name:'パスワードを変更'}).click();await page.getByText('パスワードを変更しました。再ログインしてください。').waitFor();assert.equal(verify,1);assert.equal(updates,2);await page.waitForTimeout(100);assert.equal(logout,1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.goto(base+'/auth/forgot-password');await page.getByLabel('メールアドレス').fill('test@example.invalid');await page.getByRole('button',{name:'再設定メールを送信'}).click();await page.getByRole('status').waitFor();await page.getByRole('button',{name:/再送まで/}).waitFor();assert.equal(recover,1);await page.reload();await page.getByRole('button',{name:/再送まで/}).waitFor();assert.equal(recover,1);
 await context.close();console.log(`375px ${theme}: recovery explicit action/same password/retry/signout/send throttle PASS (mock HTTP)`);
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
