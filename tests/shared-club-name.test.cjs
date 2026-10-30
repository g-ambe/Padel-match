const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readSharedOfficialClubName}=require('../lib/shared-club-name.ts');
test('共有トークンを渡して名前文字列だけ取得する',async()=>{
 const calls=[];const client={rpc:async(...args)=>{calls.push(args);return {data:'非公開グループ',error:null};}};
 assert.equal(await readSharedOfficialClubName(client,'token','old'),'非公開グループ');
 assert.deepEqual(calls,[['get_shared_official_club_name',{p_share_token:'token'}]]);
});
test('無効・停止トークンのNULLを旧データで上書きしない',async()=>{
 assert.equal(await readSharedOfficialClubName({rpc:async()=>({data:null,error:null})},'invalid','old'),null);
});
test('空トークンでは要求しない',async()=>{
 assert.equal(await readSharedOfficialClubName({rpc:()=>{throw Error('must not call');}},' '),null);
});
test('SQL導入前だけ既存RLSを通過した名前へフォールバック',async()=>{
 for(const code of ['PGRST202','42883'])assert.equal(await readSharedOfficialClubName({rpc:async()=>({data:null,error:{code}})},'token','old'),'old');
});
test('権限・通信エラーを隠さず呼出元へ伝える',async()=>{
 await assert.rejects(readSharedOfficialClubName({rpc:async()=>({data:null,error:{code:'42501'}})},'token','old'),e=>e.code==='42501');
 await assert.rejects(readSharedOfficialClubName({rpc:async()=>{throw Error('offline');}},'token','old'),/offline/);
});
