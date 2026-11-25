const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {takeRecoveryToken,recoveryRedirect,recoveryPasswordError}=require('../lib/password-recovery.ts');
test('回復トークンは唯一の16進ハッシュだけ受け付け、異種パラメータは拒否',()=>{
 for(const n of [56,64])assert.equal(takeRecoveryToken('#token_hash='+'a'.repeat(n)),'a'.repeat(n));
 for(const input of ['', '#token_hash=short', '#token_hash='+'a'.repeat(56)+'&token_hash='+'b'.repeat(56),'#access_token=x','#token_hash='+'a'.repeat(56)+'&type=signup'])assert.equal(takeRecoveryToken(input),null);
});
test('リダイレクトは固定された環境origin・回復pathのみ',()=>{
 assert.equal(recoveryRedirect('https://padel-match.ranbo-ga.workers.dev'),'https://padel-match.ranbo-ga.workers.dev/auth/reset-password');
 for(const origin of ['https://evil.example','https://padel-match.ranbo-ga.workers.dev.evil.example','null'])assert.equal(recoveryRedirect(origin),null);
});
test('同じパスワードのAuthエラーを再入力可能な日本語で案内',()=>assert.match(recoveryPasswordError('same_password'),/現在と同じパスワード/));
test('保存された認証メールは正しい変数・日本語ボタンを維持する',()=>{
 const signup=fs.readFileSync('supabase/email-templates/confirm-signup.html','utf8'),reset=fs.readFileSync('supabase/email-templates/reset-password.html','utf8');
 assert.match(signup,/href="{{ \.ConfirmationURL }}"/);assert.match(signup,/メールアドレスを認証する/);assert.match(reset,/href="{{ \.RedirectTo }}#token_hash={{ \.TokenHash }}"/);assert.match(reset,/パスワードを再設定する/);
});
test('更新結果不明・確定拒否・セッション失効を区別',()=>{
 const {classifyRecoveryUpdateError:c}=require('../lib/password-recovery.ts');
 for(const e of [{name:'AuthRetryableFetchError',status:0},{status:500},{status:502},{},{status:429}])assert.equal(c(e),'uncertain');
 for(const code of ['same_password','weak_password','validation_failed'])assert.equal(c({code,status:422}),'retry');
 for(const e of [{name:'AuthSessionMissingError',status:400},{status:401},{code:'session_expired',status:400}])assert.equal(c(e),'expired');
});
test('global logout完了まで待ち、同じアカウントだけlocal logout。失敗は成功扱いしない',async()=>{
 const {finishRecoverySignOut}=require('../lib/password-recovery.ts');let release,done=false,calls=[];
 const recovery={auth:{signOut:async x=>{calls.push(x.scope);await new Promise(r=>release=r);return{error:null}}}};
 const shared={auth:{getSession:async()=>({data:{session:{user:{id:'other'}}},error:null}),signOut:async x=>{calls.push(x.scope);return{error:null}}}};
 const pending=finishRecoverySignOut(recovery,shared,'target').then(v=>{done=true;return v});await new Promise(r=>setImmediate(r));assert.equal(done,false);release();assert.equal(await pending,true);assert.deepEqual(calls,['global']);
 const same={auth:{...shared.auth,getSession:async()=>({data:{session:{user:{id:'target'}}},error:null}),signOut:async x=>{calls.push(x.scope);return{error:{code:'fail'}}}}};
 assert.equal(await finishRecoverySignOut({auth:{signOut:async()=>({error:null})}},same,'target'),false);assert.equal(calls.at(-1),'local');
 assert.equal(await finishRecoverySignOut({auth:{signOut:async()=>{throw Error('network')}}},null,'target'),false);
});
