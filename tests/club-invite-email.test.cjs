const {test}=require('node:test'),assert=require('node:assert/strict');
const {isSupportedInviteEmail}=require('../lib/club-invite-email.ts');
test('ASCII dot-atom とPunycode、境界および非対応形式',()=>{
 for(const v of ['a@example.com','First.Last+tag@example.co.jp','user@xn--e1afmkfd.xn--p1ai'])assert.equal(isSupportedInviteEmail(v),true,v);
 for(const v of ['利用者@example.com','a@例え.jp','a..b@example.com','.a@example.com','a@example..com','a@-test.com','a@test-.com','a@localhost','a b@example.com','a\r\n@example.com','a'.repeat(65)+'@example.com','a@'+'x'.repeat(64)+'.com'])assert.equal(isSupportedInviteEmail(v),false,v);
});
