const {test}=require('node:test'),assert=require('node:assert/strict');
require('node:module').registerHooks({resolve(s,c,next){return next(['./player-profiles','./group-read','./permissions'].includes(s)?s+'.ts':s,c)}});
const {approveNamedPlayerProfileLink,hasRecipientLinkName,isValidProfileLinkDisplayName,reviewPlayerProfileLink}=require('../lib/profile-links.ts');
const request={id:'request-A',club_id:'club-A',club_name:'グループA',status:'pending',created_at:'2026-11-20T00:00:00Z',expires_at:'2099-01-01T00:00:00Z',is_recipient:true,detail_scope:'recipient',target_profile_id:'canonical-profile',target_display_name:'本人の正規名',review_token:'preview-token',group_display_name_suggestion:'グループの仮登録名',group_display_name_current:null,group_visibility:'public'};
const input={name:'  本人が選んだ別名  ',inheritanceConsent:true,publicConfirmation:true};
const client=rpc=>({from(){throw Error('直接表は禁止')},rpc});
const success=(args)=>({data:{status:'approved',merge_id:'merge-A',club_display_name:args.p_club_display_name,public_name_confirmed:args.p_public_confirmation}});
test('受信者承認は専用RPCの5引数のみ、現在tokenとraw null CASを送り、提案名・本人名と混同しない',async()=>{
 const calls=[];await approveNamedPlayerProfileLink(client(async(n,a)=>{calls.push([n,a]);return success(a)}),request,input);
 assert.deepEqual(calls,[['review_player_profile_link_named',{p_request_id:'request-A',p_review_token:'preview-token',p_club_display_name:'本人が選んだ別名',p_expected_club_display_name:null,p_public_confirmation:true}]]);
});
test('raw保存値をそのままCASへ渡し、非公開ではpublic trueを送らない',async()=>{
 const raw={...request,group_display_name_current:'  保存済み名  ',group_visibility:'private'};
 let sent;await approveNamedPlayerProfileLink(client(async(_,a)=>{sent=a;return success(a)}),raw,input);
 assert.equal(sent.p_expected_club_display_name,'  保存済み名  ');assert.equal(sent.p_public_confirmation,false);
 await approveNamedPlayerProfileLink(client(async(_,a)=>success(a)),raw,{...input,publicConfirmation:false});
});
test('本人引継ぎ同意と公開選択の型が必須',async()=>{
 let n=0;const db=client(async()=>{n++;});
 for(const delta of [{inheritanceConsent:false},{publicConfirmation:null}])await assert.rejects(approveNamedPlayerProfileLink(db,request,{...input,...delta}));
 assert.equal(n,0);
});
test('管理者・期限切れ・完了・旧DTO・本人未作成・tokenなしではnamed承認しない',async()=>{
 let n=0;const db=client(async()=>{n++;});
 for(const delta of [{is_recipient:false,detail_scope:'manager'},{detail_scope:'manager'},{status:'approved'},{expires_at:'2000-01-01'},
 {expires_at:'invalid'},{target_profile_id:null},{review_token:''},{group_display_name_current:undefined},{group_visibility:undefined},{group_display_name_suggestion:undefined}]){
  await assert.rejects(approveNamedPlayerProfileLink(db,{...request,...delta},input));
 }
 assert.equal(n,0);assert(hasRecipientLinkName(request));assert(!hasRecipientLinkName({...request,is_recipient:false}));
});
test('1～120文字・trim・Unicode文字数・制御文字を検証',async()=>{
 let n=0;const db=client(async(_,a)=>{n++;return success(a)});
 for(const name of ['', ' ', 'x'.repeat(121),'A\nB','A\0B','A\u0085B']){
  assert(!isValidProfileLinkDisplayName(name));await assert.rejects(approveNamedPlayerProfileLink(db,request,{...input,name}),e=>e.code==='22023');
 }
 assert.equal(n,0);await approveNamedPlayerProfileLink(db,request,{...input,name:'🎾'.repeat(120)});assert.equal(n,1);
});
test('PT409・認可・入力・旧token・未適用エラーでも入力/確認を変えず、1回のみ・fallbackなし',async()=>{
 const before=structuredClone({request,input});
 for(const code of ['PT409','42501','22023','P0001','PGRST202']){
  let n=0;await assert.rejects(approveNamedPlayerProfileLink(client(async(name)=>{assert.equal(name,'review_player_profile_link_named');n++;return{error:{code,message:'synthetic'}}}),request,input),e=>e.code===code&&e.message.includes('入力と確認は保持'));
  assert.equal(n,1);assert.deepEqual({request,input},before);
 }
 let n=0;await assert.rejects(approveNamedPlayerProfileLink(client(async()=>{n++;throw Error('network')}),request,input),/再送する前に再読み込み/);assert.equal(n,1);assert.deepEqual({request,input},before);
});
test('結果不明・既に承認済みを推測で成功扱いせず、再送せず再取得を案内',async()=>{
 for(const data of [null,{}, {status:'approved'}, {status:'approved',merge_id:'m',club_display_name:'別名',public_name_confirmed:true}, {status:'approved',merge_id:'m',club_display_name:input.name.trim(),public_name_confirmed:false}]){
  let n=0;await assert.rejects(approveNamedPlayerProfileLink(client(async()=>{n++;return{data}}),request,input),/再送せず再読み込み/);assert.equal(n,1);
 }
});
test('拒否・取消・旧承認ヘルパー互換は旧RPCを使用',async()=>{
 const calls=[],db=client(async(n,a)=>{calls.push([n,a]);return{data:{status:a.p_decision}}});
 for(const decision of ['rejected','cancelled','approved'])await reviewPlayerProfileLink(db,'req',decision,decision==='cancelled'?undefined:'token');
 assert.deepEqual(calls,['rejected','cancelled','approved'].map(d=>['review_player_profile_link',{p_request_id:'req',p_decision:d,p_review_token:d==='cancelled'?null:'token'}]));
});

test('公開OFFの本人承認を許可し、戻り値もfalseと照合する',async()=>{let sent;await approveNamedPlayerProfileLink(client(async(_,a)=>{sent=a;return success(a)}),request,{...input,publicConfirmation:false});assert.equal(sent.p_public_confirmation,false);});
