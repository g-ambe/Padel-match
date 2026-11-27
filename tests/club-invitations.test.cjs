const {test}=require('node:test');
const assert=require('node:assert/strict');
require('node:module').registerHooks({resolve(s,c,next){return next(['./profile-links','./player-profiles','./group-read','./friendly-round-history','./permissions'].includes(s)?s+'.ts':s,c)}});
const {listClubInvitations,previewClubInvitation,acceptClubInvitation,rejectClubInvitation}=require('../lib/club-invitations.ts');
const invite={invite_id:'a',generation:1,club_id:'c',club_name:'グループ',member_name:'仮',expires_at:'2099-01-01T00:00:00Z',group_visibility:'public',inflight:false};
const preview={...invite,status:'ok',review_token:'proof',group_display_name_suggestion:'仮',group_display_name_current:null,target_display_name:'本人',participant_count:1,match_count:2,result_count:1,team_match_count:0,official_match_count:0};
test('本人一覧・previewは対象generationと本人同意情報を要求',async()=>{
 const db={rpc:async(name)=>({data:name==='list_my_club_invites'?{status:'ok',invitations:[invite]}:preview,error:null})};
 assert.deepEqual(await listClubInvitations(db),[invite]);assert.equal((await previewClubInvitation(db,invite)).review_token,'proof');
 await assert.rejects(previewClubInvitation({rpc:async()=>({data:{...preview,generation:2}})},invite));
 await assert.rejects(previewClubInvitation({rpc:async()=>({data:{...preview,result_count:'1'}})},invite));
 await assert.rejects(listClubInvitations({rpc:async()=>({error:{code:'PGRST202'}})}));
});
test('期限後も同じ操作IDで確定済み結果を照合できる',async()=>{let calls=0;const db={rpc:async()=>{calls++;return {data:{status:'approved',invite_id:'a',club_id:'c'}}}};await acceptClubInvitation(db,{...preview,expires_at:'2000-01-01T00:00:00Z'},{name:'名前',publicChoice:false,consent:true,operationId:'same-op'});assert.equal(calls,1)});
test('同意必須、公開選択と期待値・operation IDを送信し、本人名を変更しない',async()=>{
 const calls=[];const db={rpc:async(name,args)=>{calls.push([name,args]);return {data:{status:'approved',invite_id:'a',club_id:'c'}}}};
 await assert.rejects(acceptClubInvitation(db,preview,{name:'自分',publicChoice:false,consent:false,operationId:'op'}));assert.equal(calls.length,0);
 await acceptClubInvitation(db,preview,{name:' 自分 ',publicChoice:false,consent:true,operationId:'op'});
 assert.deepEqual(calls[0],['accept_my_club_invite',{p_invite:'a',p_generation:1,p_operation_id:'op',p_review_token:'proof',p_expected_club_display_name:null,p_expected_visibility:'public',p_club_display_name:'自分',p_public_confirmation:false,p_inheritance_consent:true}]);
});
test('非公開では公開しない。失敗・不正応答は成功扱いせず旧表へfallbackしない',async()=>{
 const db={from(){throw Error('unexpected table')},rpc:async(_name,args)=>{assert.equal(args.p_public_confirmation,false);return {data:{status:'conflict'}}}};
 await assert.rejects(acceptClubInvitation(db,{...preview,group_visibility:'private'},{name:'名前',publicChoice:true,consent:true,operationId:'op'}));
 await assert.rejects(rejectClubInvitation({rpc:async()=>({data:{status:'not_found'}})},invite,'op'));
});
test('通信結果不明の再試行は同じ操作IDと同意内容で呼べる',async()=>{
 const calls=[];const db={rpc:async(name,args)=>{calls.push([name,args]);if(calls.length===1)throw Error('network');return {data:{status:'approved',invite_id:'a',club_id:'c'}}}};
 const input={name:'入力名',publicChoice:true,consent:true,operationId:'same-op'};
 await assert.rejects(acceptClubInvitation(db,preview,input));await acceptClubInvitation(db,preview,input);
 assert.deepEqual(calls[0],calls[1]);assert.equal(input.name,'入力名');
});
