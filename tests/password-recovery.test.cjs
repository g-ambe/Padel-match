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
