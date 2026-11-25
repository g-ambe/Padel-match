const assert=require('node:assert/strict');
// Synthetic test only; never target production or Stage.
const origin='http://127.0.0.1:59999', mail='http://127.0.0.1:58025';
async function call(path,body,token){const r=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,data:r.status===204?{}:await r.json()};}
(async()=>{
 const suffix=Date.now(),emailA='player-a-'+suffix+'@example.invalid',emailB='player-b-'+suffix+'@example.invalid';
 let a=await call('/signup',{email:emailA,password:'Original123!'});assert.equal(a.status,200);
 let b=await call('/signup',{email:emailB,password:'Original123!'});assert.equal(b.status,200);
 let first=await call('/token?grant_type=password',{email:emailA,password:'Original123!'});let second=await call('/token?grant_type=password',{email:emailA,password:'Original123!'});assert.equal(first.status,200);assert.equal(second.status,200);
 let recovery=await call('/recover?redirect_to='+encodeURIComponent('http://127.0.0.1:3070/auth/reset-password'),{email:emailA});assert.equal(recovery.status,200);
 let messages;for(let i=0;i<30;i++){messages=await (await fetch(mail+'/api/v1/messages')).json();if(messages.total)break;await new Promise(r=>setTimeout(r,100));}assert(messages.total>0);
 const msg=await (await fetch(mail+'/api/v1/message/'+messages.messages[0].ID)).json();const content=msg.HTML||msg.Text;const match=content.match(/href="([^"]*#token_hash=[a-f0-9]+)"/i);assert(match,'Rendered recovery URL not found');const link=new URL(match[1].replaceAll('&amp;','&'));assert.equal(link.origin,'http://127.0.0.1:3070');assert.equal(link.pathname,'/auth/reset-password');const hash=new URLSearchParams(link.hash.slice(1)).get('token_hash');assert.match(hash,/^(?:[a-f0-9]{56}|[a-f0-9]{64})$/i);assert.match(content,/パスワードを再設定する/);
 let v=await call('/verify',{type:'recovery',token_hash:hash});assert.equal(v.status,200);assert.equal(v.data.user.id,a.data.user.id);
 let reused=await call('/verify',{type:'recovery',token_hash:hash});assert.notEqual(reused.status,200);
 let same=await fetch(origin+'/user',{method:'PUT',headers:{'content-type':'application/json',authorization:'Bearer '+v.data.access_token},body:JSON.stringify({password:'Original123!'})});let sameData=await same.json();console.log('same-password response:',same.status,sameData.error_code);
 if(same.status===200){console.log('UNSAFE: isolated GoTrue accepted same password; subsequent checks omitted');process.exitCode=1;return;}
 assert.equal(sameData.error_code||sameData.code,'same_password');
 let upd=await fetch(origin+'/user',{method:'PUT',headers:{'content-type':'application/json',authorization:'Bearer '+v.data.access_token},body:JSON.stringify({password:'Updated123!'})});assert.equal(upd.status,200);
 let logout=await call('/logout?scope=global',{},v.data.access_token);assert.equal(logout.status,204);
 for(const session of [first,second]){let refresh=await call('/token?grant_type=refresh_token',{refresh_token:session.data.refresh_token});assert.notEqual(refresh.status,200);}
 assert.notEqual((await call('/token?grant_type=password',{email:emailA,password:'Original123!'})).status,200);
 assert.equal((await call('/token?grant_type=password',{email:emailA,password:'Updated123!'})).status,200);
 assert.equal((await call('/token?grant_type=password',{email:emailB,password:'Original123!'})).status,200);
 console.log('Isolated actual GoTrue: one-time recovery, same-password, retry, global refresh revocation, old/new login and unrelated account PASS');
})().catch(e=>{console.error(e.message);process.exitCode=1});
