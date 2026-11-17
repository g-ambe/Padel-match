// 合成API・画像・本人IDのみ。本番通信・実データの変更は禁止。
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {navigationFixture,user,player,ordinary}=require('../fixtures/navigation-app.cjs');
const {validateWebp}=require('../../lib/profile-media/shared.ts');
const base=process.env.PROFILE_MEDIA_TEST_URL||'http://127.0.0.1:3070',remote='http://127.0.0.1:54321';
(async()=>{
 const f=navigationFixture(),pid=f.tables.player_profiles[0].id,errors=[],outside=[],requests=[];
 Object.assign(f.tables.player_profiles[0],{bio:'自己紹介保持',play_level:'中級',dominant_hand:'右',preferred_position:'フォア',activity_area:'東京都',created_at:'2026-11-01T00:00:00Z'});
 f.tables.events.find(e=>e.id===ordinary).status='closed';f.tables.user_preferences[0].tutorial_status='completed';
 let meta={profile_id:pid,owner_id:user.id,instagram_username:null,instagram_version:0,avatar_key:null,avatar_version:0},bytes=null,hold=false,release,fail=false,loseReply=false;
 const ops=new Map(),browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 const c=await browser.newContext({viewport:{width:375,height:812},hasTouch:true});
 await c.addInitScript(({base,user})=>{if(location.origin!==base)return;const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})}.test`,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+7200,user}));},{base,user});
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};
 await c.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),method=req.method(),answer=(status,value)=>route.fulfill({status,headers:cors,body:JSON.stringify(value)});
  if(u.origin===base&&u.pathname.startsWith('/api/profile-media/')){
   assert(req.headers().authorization?.startsWith('Bearer '));requests.push({path:u.pathname,method});
   if(u.pathname.endsWith('/image'))return route.fulfill({status:bytes?200:404,headers:{'content-type':'image/webp','cache-control':'private, max-age=300','vary':'Authorization'},body:bytes||Buffer.alloc(0)});
   if(method==='GET')return answer(200,{profile:meta,operation:ops.get(u.searchParams.get('request'))||null,imageEnabled:true});
   if(method==='PATCH'){const v=JSON.parse(req.postData());assert.equal(v.version,meta.instagram_version);meta={...meta,instagram_username:v.username||null,instagram_version:meta.instagram_version+1};return answer(200,{profile:meta});}
   if(method==='PUT'||method==='DELETE'){
    const request=req.headers()['x-profile-request'];if(hold)await new Promise(r=>release=r);
    if(fail){ops.set(request,{status:'aborted'});return answer(503,{error:'画像を変更できませんでした。以前の画像はそのまま保存されています。'});}
    if(method==='PUT'){const b=req.postDataBuffer();const dim=validateWebp(new Uint8Array(b));assert(dim.width<=512&&dim.height<=512);assert.equal(dim.width,512);assert.equal(dim.height,341);assert(b.length<=200*1024);bytes=b;}
    else bytes=null;
    meta={...meta,avatar_version:meta.avatar_version+1,avatar_key:method==='PUT'?`profiles/${pid}/${request}.webp`:null};ops.set(request,{request_id:request,status:'committed'});
    if(loseReply){loseReply=false;return route.abort('failed');}return answer(200,{profile:meta});
   }
  }
  if(u.origin===base)return route.continue();if(u.origin!==remote){outside.push(u.origin);return route.abort();}
  if(method==='OPTIONS')return answer(200,{});if(u.pathname.startsWith('/auth/'))return answer(200,user);
  const r=await f.fetch(u.href,{method,headers:req.headers(),body:req.postData()||undefined});return route.fulfill({status:r.status,headers:{...cors,...Object.fromEntries(r.headers)},body:await r.text()});
 });
 const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(base+'/profile');await p.getByRole('button',{name:'Instagramを編集',exact:true}).waitFor();
  assert(await p.locator('[aria-label="既定のプロフィール画像"]').isVisible());assert.equal(requests.filter(r=>r.path.endsWith('/image')).length,0);
  await p.getByRole('heading',{name:'総合戦績',exact:true}).waitFor();await p.getByRole('link',{name:/グループA/}).first().waitFor();
  const stats=p.locator('section').filter({has:p.getByRole('heading',{name:'総合戦績',exact:true})});await stats.locator('summary').click();await stats.getByText('試合数: 1',{exact:true}).waitFor();await stats.getByText('勝率: 100.0%',{exact:true}).waitFor();await stats.getByText('平均得点: 4.0',{exact:true}).waitFor();
  await p.getByRole('button',{name:'Instagramを編集',exact:true}).click();await p.getByLabel('Instagram ID',{exact:true}).fill(' @player.name_01 ');await p.getByRole('button',{name:'Instagramを保存',exact:true}).click();await p.getByRole('link',{name:'@player.name_01',exact:true}).waitFor();assert.equal(await p.getByRole('link',{name:'@player.name_01',exact:true}).getAttribute('href'),'https://www.instagram.com/player.name_01/');
  const patches=requests.filter(r=>r.method==='PATCH').length;await p.getByRole('button',{name:'Instagramを編集',exact:true}).click();await p.getByLabel('Instagram ID',{exact:true}).fill('javascript:alert(1)');await p.getByRole('button',{name:'Instagramを保存',exact:true}).click();await p.getByRole('alert').filter({hasText:'URLは登録できません'}).waitFor();assert.equal(requests.filter(r=>r.method==='PATCH').length,patches);await p.getByRole('button',{name:'IDを削除',exact:true}).click();await p.getByText('Instagram未登録',{exact:true}).waitFor();
  const png=await p.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const ctx=canvas.getContext('2d');ctx.fillStyle='#123456';ctx.fillRect(0,0,1200,800);const b=await new Promise(r=>canvas.toBlob(r,'image/png'));return Array.from(new Uint8Array(await b.arrayBuffer()));});
  hold=true;await p.getByLabel('プロフィール画像を選択',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png)});
  await p.getByRole('status').filter({hasText:'プロフィール画像をアップロード中'}).waitFor().catch(async e=>{console.error('画像UI',await p.locator('[aria-label="プロフィール概要"]').innerText());throw e;});await p.getByRole('button',{name:'Instagramを編集',exact:true}).click();await p.getByLabel('Instagram ID',{exact:true}).fill('during_upload');await p.getByRole('button',{name:'Instagramを保存',exact:true}).click();await p.getByRole('link',{name:'@during_upload',exact:true}).waitFor();await p.getByRole('link',{name:'試合',exact:true}).click();await p.waitForURL(base+'/home');await p.getByRole('status').filter({hasText:/プロフィール画像/}).waitFor();
  hold=false;release();await p.getByRole('status').filter({hasText:'プロフィール画像を変更しました'}).waitFor();await p.getByRole('link',{name:'マイページ',exact:true}).click();await p.waitForURL(base+'/profile');await p.getByRole('img',{name:'プロフィール画像',exact:true}).waitFor();assert.equal(requests.filter(r=>r.method==='PUT').length,1);
  const imageGets=requests.filter(r=>r.path.endsWith('/image')).length;
  await p.getByRole('link',{name:'ランキング',exact:true}).click();await p.waitForURL(base+'/ranking');await p.goto(base+'/groups');await p.getByRole('heading',{name:'所属グループ',exact:true}).waitFor();assert.equal(requests.filter(r=>r.path.endsWith('/image')).length,imageGets,'一覧では画像を取得しない');
  await p.goto(base+'/profile');await p.getByRole('img',{name:'プロフィール画像',exact:true}).waitFor();
  fail=true;const old=meta.avatar_key;await p.getByLabel('プロフィール画像を選択',{exact:true}).setInputFiles({name:'again.png',mimeType:'image/png',buffer:Buffer.from(png)});await p.getByRole('alert').filter({hasText:'以前の画像'}).waitFor();assert.equal(meta.avatar_key,old);
  fail=false;loseReply=true;await p.getByRole('button',{name:'再確認・再試行',exact:true}).click();await p.getByRole('status').filter({hasText:'画像の変更を確認しました'}).first().waitFor();assert.notEqual(meta.avatar_key,old);
  p.once('dialog',d=>d.accept());await p.getByRole('button',{name:'画像を削除',exact:true}).click();await p.getByRole('status').filter({hasText:'画像を削除しました'}).first().waitFor();assert.equal(meta.avatar_key,null);
  f.tables.player_profiles.push({...f.tables.player_profiles[0],id:'00000000-0000-4000-8000-000000000099'});await p.reload();await p.getByRole('alert').filter({hasText:'複数の連携'}).waitFor();assert.equal(await p.getByLabel('プロフィール画像を選択',{exact:true}).isEnabled(),false);assert.equal(await p.getByRole('button',{name:'Instagramを編集',exact:true}).count(),0);
  for(const width of [320,375,390])for(const theme of ['light','dark']){await p.setViewportSize({width,height:812});await p.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t;},theme);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);console.log('プロフィール/旧戦績・グループ/Instagram検証と削除/WebP再圧縮・寸法/画面移動中アップロード/応答喪失/旧画像維持/一覧GET抑制/複数連携/320・375・390px両テーマ PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
