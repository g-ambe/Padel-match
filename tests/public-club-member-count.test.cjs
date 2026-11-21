const {test}=require('node:test'),assert=require('node:assert/strict');
const {readPublicClubMemberCount}=require('../lib/group-read.ts');
const db=rpc=>({from(){throw Error('基底表へのfallbackは禁止')},rpc});
test('人数は専用スカラーRPCだけを呼び、club ID以外の情報を要求しない',async()=>{
 const calls=[];assert.equal(await readPublicClubMemberCount(db(async(n,a)=>{calls.push([n,a]);return{data:2}}),'club-A'),2);
 assert.deepEqual(calls,[['get_public_club_member_count',{p_club_id:'club-A'}]]);
});
test('0人と安全な非負整数を受け取り、0を未取得と混同しない',async()=>{
 for(const n of [0,1,2,Number.MAX_SAFE_INTEGER])assert.equal(await readPublicClubMemberCount(db(async()=>({data:n})),'club-A'),n);
});
test('文字列・負数・小数・unsafe整数・配列・名簿や内部情報DTOを人数に変換しない',async()=>{
 for(const data of [null,undefined,'2',2n,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,[],[2],{}, {count:2}, {count:2,name:'非公開名',auth_id:'secret'}]){
  let calls=0;await assert.rejects(readPublicClubMemberCount(db(async()=>{calls++;return{data}}),'club-A'),e=>e.message==='所属人数を取得できませんでした');assert.equal(calls,1);
 }
});
test('認可拒否・未適用・通信失敗は汎用エラーにし、再送/名簿/基底表fallbackなし',async()=>{
 for(const code of ['42501','PGRST202','P0001']){
  let calls=0;await assert.rejects(readPublicClubMemberCount(db(async()=>{calls++;return{data:0,error:{code,message:'private details'}}}),'club-A'),e=>e.message==='所属人数を取得できませんでした');assert.equal(calls,1);
 }
 let calls=0;await assert.rejects(readPublicClubMemberCount(db(async()=>{calls++;throw Error('network/private');}),'club-A'),e=>e.message==='所属人数を取得できませんでした');assert.equal(calls,1);
});
