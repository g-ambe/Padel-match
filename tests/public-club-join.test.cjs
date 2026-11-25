const {test}=require('node:test'),assert=require('node:assert/strict');
const {submitNamedPublicJoin,previewPublicJoin}=require('../lib/public-club-join.ts');
const context={clubId:'club-A',userId:'auth-user',visibility:'public',isMember:false,hasPendingRequest:false};
const candidates=[{reference:'opaque-A',display_name:'グループでの仮名',is_unlinked:true},{reference:'opaque-linked',display_name:'公開確認済み',is_unlinked:false}];
const value={display_name:'登録名',target_display_name:'本人名',has_target:true,review_token:'token-A',membership_count:1,participant_count:2,match_count:3,result_count:3,team_match_count:1,official_match_count:0};
const bound={clubId:'club-A',reference:'opaque-A',value};
const draft={reference:null,name:'  希望の表示名  ',message:'',publicConfirmation:true,inheritanceConsent:false,preview:null};
const requestId='00000000-0000-4000-8000-000000000900';
const client=handler=>({from(){throw Error('直接表の取得/更新は禁止')},rpc:handler});
test('通常新規加入は確認した名前と公開同意をnamed公開gatewayの6パラメータだけで送る',async()=>{
 const calls=[],db=client(async(name,args)=>{calls.push([name,args]);return{data:requestId}});
 assert.equal(await submitNamedPublicJoin(db,context,candidates,draft),requestId);
 assert.deepEqual(calls,[['submit_public_club_claim_named',{p_club_id:'club-A',p_reference:null,p_message:null,p_review_token:null,p_club_display_name:'希望の表示名',p_public_confirmation:true}]]);
});
test('本人申請は公開referenceと対応するpreview tokenを使用し、本人名で希望別名を上書きしない',async()=>{
 let sent;const db=client(async(name,args)=>{assert.equal(name,'submit_public_club_claim_named');sent=args;return{data:requestId}});
 await submitNamedPublicJoin(db,context,candidates,{...draft,reference:'opaque-A',name:'編集した仮名',message:'  本人申請  ',inheritanceConsent:true,preview:bound});
 assert.deepEqual(sent,{p_club_id:'club-A',p_reference:'opaque-A',p_message:'本人申請',p_review_token:'token-A',p_club_display_name:'編集した仮名',p_public_confirmation:true});
 assert.equal(value.target_display_name,'本人名');
});
test('公開確認・有効な名前・ログイン・公開グループ・未所属・未申請をRPC前に検証',async()=>{
 let n=0;const db=client(async()=>{n++;return{data:requestId}});
 for(const delta of [{publicConfirmation:null},{name:''},{name:' '},{name:'x'.repeat(121)},{name:'a\nb'}])await assert.rejects(submitNamedPublicJoin(db,context,candidates,{...draft,...delta}));
 for(const delta of [{userId:null},{visibility:'private'},{isMember:true},{hasPendingRequest:true},{clubId:''}])await assert.rejects(submitNamedPublicJoin(db,{...context,...delta},candidates,draft));
 assert.equal(n,0);
 await submitNamedPublicJoin(db,context,candidates,{...draft,name:'🎾'.repeat(120)});assert.equal(n,1);
});
test('内部ID・linked参照・異なるグループ/token・未同意・本人profile未作成では本人申請を送らない',async()=>{
 let n=0;const db=client(async()=>{n++;return{data:requestId}});
 const selected={...draft,reference:'opaque-A',inheritanceConsent:true,preview:bound};
 for(const delta of [{reference:'internal-member-uuid'},{reference:'opaque-linked'},{inheritanceConsent:false},{preview:null},
  {preview:{...bound,clubId:'club-B'}},{preview:{...bound,reference:'opaque-other'}},
  {preview:{...bound,value:{...value,has_target:false}}},{preview:{...bound,value:{...value,review_token:''}}}])await assert.rejects(submitNamedPublicJoin(db,context,candidates,{...selected,...delta}));
 assert.equal(n,0);
});
test('通常加入には残った別参照previewのtokenを誤送信しない',async()=>{
 let args;await submitNamedPublicJoin(client(async(_,a)=>{args=a;return{data:requestId}}),context,candidates,{...draft,preview:bound,inheritanceConsent:true});
 assert.equal(args.p_reference,null);assert.equal(args.p_review_token,null);
});
test('公開previewは限定RPCで取得し、参照/グループをtokenと結び付ける',async()=>{
 const calls=[];const preview=await previewPublicJoin(client(async(name,args)=>{calls.push([name,args]);return{data:value}}),'club-A','opaque-A');
 assert.deepEqual(preview,bound);assert.deepEqual(calls,[['preview_public_club_claim',{p_club_id:'club-A',p_reference:'opaque-A'}]]);
 for(const data of [null,{}, {...value,review_token:''},{...value,match_count:-1}])await assert.rejects(previewPublicJoin(client(async()=>({data})),'club-A','opaque-A'));
 await assert.rejects(previewPublicJoin(client(async()=>({error:{code:'42501'}})),'club-A','opaque-A'),e=>e.code==='42501');
});
test('42501・旧token/期限切れ・参照競合・RPC未適用・通信断で自動再送/旧API fallbackなし',async()=>{
 const selected={...draft,reference:'opaque-A',inheritanceConsent:true,preview:bound},before=structuredClone(selected);
 for(const code of ['42501','P0001','PT409','PGRST202']){
  let n=0;await assert.rejects(submitNamedPublicJoin(client(async(name)=>{assert.equal(name,'submit_public_club_claim_named');n++;return{error:{code}}}),context,candidates,selected),e=>e.code===code&&e.message.includes('入力は保持'));
  assert.equal(n,1);assert.deepEqual(selected,before);
 }
 let n=0;await assert.rejects(submitNamedPublicJoin(client(async()=>{n++;throw Error('network')}),context,candidates,selected),/network/);assert.equal(n,1);
});
test('不明な結果を送信成功扱いしない',async()=>{
 for(const data of [null,{},[],true,'not-a-request-id'])await assert.rejects(submitNamedPublicJoin(client(async()=>({data})),context,candidates,draft),/送信結果/);
});

test('公開OFFでもnamed gatewayへfalseを送り、本人引継ぎ同意は省略しない',async()=>{
 let sent;await submitNamedPublicJoin(client(async(_,a)=>{sent=a;return{data:requestId}}),context,candidates,{...draft,publicConfirmation:false});assert.equal(sent.p_public_confirmation,false);
});
