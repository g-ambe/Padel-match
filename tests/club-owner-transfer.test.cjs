const {test}=require('node:test'),assert=require('node:assert/strict');
const {readOwnerCandidates,readMyOwnerTransfers,requestOwnerTransfer,decideOwnerTransfer,canAcceptOwnerTransfer}=require('../lib/club-owner-transfer.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const req={id:id(1),club_id:id(2),club_name:'A',status:'pending',created_at:'2026-01-01',responded_at:null,is_sender:false,is_recipient:true,target_display_name:'本人'};
const candidates=[{member_id:id(3),display_name:'本人連携済みのメイン管理者'}];
const memberships=[{club_id:id(2),role:'main_admin',status:'active',is_active:true}];
const db=rpc=>({from(){throw Error('raw表アクセス禁止')},rpc});
test('現ownerだけの候補RPCを使用し、最小DTOを返す。42501は非owner・空候補はowner',async()=>{
 let sent;const result=await readOwnerCandidates(db(async(n,a)=>{sent=[n,a];return{data:[{...candidates[0],auth_user_id:'must-not-pass'}]}}),req.club_id);
 assert.deepEqual(sent,['get_club_owner_transfer_candidates',{p_club_id:req.club_id}]);assert.deepEqual(result,candidates);
 assert.deepEqual(await readOwnerCandidates(db(async()=>({data:[]})),req.club_id),[]);
 assert.equal(await readOwnerCandidates(db(async()=>({error:{code:'42501'}})),req.club_id),null);
 await assert.rejects(readOwnerCandidates(db(async()=>({error:{code:'PGRST202'}})),req.club_id));
});
test('本人限定一覧RPCだけを使用。raw情報を捨て、権限不明・不正DTOを成功扱いしない',async()=>{
 const list=await readMyOwnerTransfers(db(async(n,a)=>{assert.equal(n,'list_my_club_owner_transfers');assert.equal(a,undefined);return{data:[{...req,auth_user_id:'secret',email:'secret'}]}}));
 assert.deepEqual(list,[req]);
 for(const data of [null,{},[{}],[{...req,is_sender:false,is_recipient:false}]])await assert.rejects(readMyOwnerTransfers(db(async()=>({data}))));
});
test('申請は候補RPCのmember IDのみを送信。owner変更や所属/role更新をしない',async()=>{
 const calls=[];assert.equal(await requestOwnerTransfer(db(async(n,a)=>{calls.push([n,a]);return{data:id(9)}}),req.club_id,id(3),candidates,[],true),id(9));
 assert.deepEqual(calls,[['request_club_owner_transfer',{p_club_id:req.club_id,p_to_member_id:id(3)}]]);
});
test('非owner・候補なし・非候補/仮member・未確認・pending重複で送信しない',async()=>{
 let n=0;const s=db(async()=>{n++;return{data:id(9)}});
 for(const [selected,options,rows,confirmed] of [[id(3),null,[],true],[id(3),[],[],true],['arbitrary-auth',candidates,[],true],[id(3),candidates,[],false],[id(3),candidates,[req],true]])await assert.rejects(requestOwnerTransfer(s,req.club_id,selected,options,rows,confirmed));
 assert.equal(n,0);
});
test('受取人は明示同意後に引受。RPC以外のowner直接書換・退会を起動しない',async()=>{
 const calls=[];assert.equal(await decideOwnerTransfer(db(async(n,a)=>{calls.push([n,a]);return{data:'accepted'}}),req,'accepted',memberships,false,true),'accepted');
 assert.deepEqual(calls,[['respond_club_owner_transfer',{p_request_id:req.id,p_decision:'accepted'}]]);
});
test('受取人でない送信者・非main・退会・別group・処理済・未確認では引受不可',async()=>{
 let n=0;const s=db(async()=>{n++;});
 const variations=[[],[{...memberships[0],role:'sub_admin'}],[{...memberships[0],is_active:false}],[{...memberships[0],status:'inactive'}],[{...memberships[0],club_id:id(77)}]];
 for(const m of variations){assert(!canAcceptOwnerTransfer(req,m));await assert.rejects(decideOwnerTransfer(s,req,'accepted',m,false,true));}
 for(const r of [{...req,is_sender:true,is_recipient:false},{...req,status:'accepted'},{...req,status:'cancelled'},{...req,status:'declined'}])await assert.rejects(decideOwnerTransfer(s,r,'accepted',memberships,true,true));
 await assert.rejects(decideOwnerTransfer(s,req,'accepted',memberships,false,false));assert.equal(n,0);
});
test('降格/退会後も受取人は辞退可能、他人の代行は不可',async()=>{
 const calls=[];await decideOwnerTransfer(db(async(n,a)=>{calls.push([n,a]);return{data:'declined'}}),req,'declined',[],false,true);
 assert.deepEqual(calls,[['respond_club_owner_transfer',{p_request_id:req.id,p_decision:'declined'}]]);
 await assert.rejects(decideOwnerTransfer(db(async()=>{throw Error('called')}),{...req,is_recipient:false},'declined',[],false,true));
});
test('取消は現ownerで依頼送信者だけ。受取人/旧owner/完了済は不可',async()=>{
 const sender={...req,is_sender:true,is_recipient:false},calls=[];
 await decideOwnerTransfer(db(async(n,a)=>{calls.push([n,a]);return{data:'cancelled'}}),sender,'cancelled',memberships,true,true);
 assert.deepEqual(calls,[['cancel_club_owner_transfer',{p_request_id:req.id}]]);
 for(const [r,owner] of [[req,true],[sender,false],[{...sender,status:'accepted'},true]])await assert.rejects(decideOwnerTransfer(db(async()=>{throw Error('called')}),r,'cancelled',memberships,owner,true));
});
test('409・認可失効・未適用・通信断で自動再送なし。選択/申請オブジェクトを変更しない',async()=>{
 const before=structuredClone({req,candidates});
 for(const code of ['PT409','42501','PGRST202']){
  let n=0;const s=db(async()=>{n++;return{error:{code}}});
  await assert.rejects(requestOwnerTransfer(s,req.club_id,id(3),candidates,[],true),e=>e.code===code&&e.message.includes('保持'));assert.equal(n,1);
  await assert.rejects(decideOwnerTransfer(s,req,'accepted',memberships,false,true),e=>e.code===code);assert.equal(n,2);
 }
 let n=0;await assert.rejects(requestOwnerTransfer(db(async()=>{n++;throw Error('network')}),req.club_id,id(3),candidates,[],true),/再送せず/);assert.equal(n,1);assert.deepEqual({req,candidates},before);
});
test('結果不明を推測で成功扱いしない。期限を捏造せず古いpendingも表示可能',async()=>{
 for(const data of [null,{},'wrong']){
  await assert.rejects(requestOwnerTransfer(db(async()=>({data})),req.club_id,id(3),candidates,[],true));
  await assert.rejects(decideOwnerTransfer(db(async()=>({data})),req,'accepted',memberships,false,true));
 }
 assert(canAcceptOwnerTransfer({...req,created_at:'2000-01-01'},memberships));
});
