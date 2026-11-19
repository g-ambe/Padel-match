const{test}=require('node:test'),assert=require('node:assert/strict');
const{readMyMemberships}=require('../lib/group-read.ts');
test('読取RPCは1201行を欠落なく取得し、途中失敗時に部分成功や旧公開表取得をしない',async()=>{
 const input=Array.from({length:1201},(_,i)=>({id:String(i),club_id:String(i),role:'member',is_active:true,status:'active'}));
 const calls=[];let fail=false;
 const db={rpc(name){assert.equal(name,'get_my_club_memberships');return{range(a,b){calls.push([a,b]);return Promise.resolve(fail&&a===500?{error:{code:'42501'},data:null}:{data:input.slice(a,b+1),error:null});}}},from(){throw new Error('旧表へアクセスしてはいけない')}};
 assert.deepEqual(await readMyMemberships(db),input);assert.deepEqual(calls,[[0,499],[500,999],[1000,1499]]);
 fail=true;await assert.rejects(readMyMemberships(db),/取得できません/);
});
