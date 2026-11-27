const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseInviteFragment,saveInviteRecovery,readInviteRecovery,postAuthInviteDestination}=require('../lib/club-invite-link.ts');
const value={invite:'12345678-1234-4234-8234-123456789012',generation:2,secret:'a'.repeat(64)};
test('fragmentは招待1件と世代・秘密値のみを許可',()=>{const q=new URLSearchParams(value);assert.deepEqual(parseInviteFragment('#'+q),value);q.append('secret','b'.repeat(64));assert.equal(parseInviteFragment('#'+q),null);assert.equal(parseInviteFragment('#invite=x&generation=0&secret=x'),null)});
test('復帰参照の破損は読み取らない',()=>{let raw='';const s={setItem:(_k,v)=>raw=v,getItem:()=>raw};saveInviteRecovery(s,value);assert.deepEqual(readInviteRecovery(s),value);raw='{invalid';assert.equal(readInviteRecovery(s),null)});

test("認証後は同じタブの有効な招待だけに復帰し、秘密をURLに含めない",()=>{let raw="";const s={setItem:(_k,v)=>raw=v,getItem:()=>raw};assert.equal(postAuthInviteDestination(s),"/home");saveInviteRecovery(s,value);assert.equal(postAuthInviteDestination(s),"/profile/invitations/redeem");raw="invalid";assert.equal(postAuthInviteDestination(s),"/home");});
