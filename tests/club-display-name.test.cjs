const {test}=require('node:test'),assert=require('node:assert/strict');
require('node:module').registerHooks({resolve(s,c,next){return next(s==='./permissions'?s+'.ts':s,c)}});
const {canEditClubDisplayName,groupMemberLabel,saveClubDisplayName,requiresPublicNameConfirmation}=require('../lib/club-display-name.ts');
const {readPublicDirectory,readClubRoster}=require('../lib/group-read.ts');
const member={id:'member-A',club_id:'club-A',player_profile_id:'player-independent',profile_display_name:'本人名',linked_auth_user_id:'auth-self',role:'member',is_active:true,status:'active',player_active:true,club_display_name:null,public_name_confirmed:false};
const context={clubId:'club-A',userId:'auth-self',visibility:'public',isSuperUser:false,myRole:'member'};
const client=(handler)=>({from(){throw Error('直接表を読書きしてはいけません')},rpc:handler});
test('linked本人だけ編集でき、他人・メイン/サブ/superも他人のlinkedは不可',()=>{
 assert(canEditClubDisplayName(member,context));
 for(const role of ['main_admin','sub_admin','member'])for(const isSuperUser of [false,true])assert(!canEditClubDisplayName(member,{...context,userId:'other',myRole:role,isSuperUser}));
 for(const change of [{userId:null},{clubId:'club-B'}])assert(!canEditClubDisplayName(member,{...context,...change}));
 for(const change of [{is_active:false},{status:'inactive'},{player_active:false},{player_profile_id:null}])assert(!canEditClubDisplayName({...member,...change},context));
});
test('未連携は既存の対象役職制限で編集し、一般・サブ→メインは拒否',()=>{
 const unlinked={...member,linked_auth_user_id:null};
 assert(!canEditClubDisplayName(unlinked,context));
 for(const role of ['main_admin','sub_admin'])assert(canEditClubDisplayName(unlinked,{...context,myRole:role}));
 assert(!canEditClubDisplayName({...unlinked,role:'main_admin'},{...context,myRole:'sub_admin'}));
 assert(canEditClubDisplayName({...unlinked,role:'main_admin'},{...context,isSuperUser:true}));
});
test('本人名とaliasを別表示し、NULLを勝手に本人名のaliasへ変換しない',()=>{
 assert.equal(groupMemberLabel(member),'グループ内表示名 未設定（本人名）');
 assert.equal(groupMemberLabel({...member,club_display_name:'Aでの名前'}),'Aでの名前（本人名）');
 assert.equal(groupMemberLabel({...member,club_display_name:null,linked_auth_user_id:null}),'本人名');
 assert.equal(groupMemberLabel({...member,club_display_name:'仮名',linked_auth_user_id:null}),'仮名');
});
test('保存は新RPCだけ・raw NULL CAS・明示public確認、本人プロフィールを変更しない',async()=>{
 const before=structuredClone(member),calls=[];
 const db=client(async(name,args)=>{calls.push({name,args});return{data:{member_id:member.id,club_display_name:args.p_display_name,public_name_confirmed:args.p_public_confirmation},error:null}});
 await assert.rejects(saveClubDisplayName(db,member,context,'自分の別名',false),/公開/);assert.equal(calls.length,0);
 const result=await saveClubDisplayName(db,member,context,'  自分の別名  ',true);
 assert.deepEqual(calls,[{name:'save_club_member_display_name',args:{p_club_id:'club-A',p_member_id:'member-A',p_display_name:'自分の別名',p_expected_club_display_name:null,p_public_confirmation:true}}]);
 assert.equal(result.public_name_confirmed,true);assert.deepEqual(member,before);
});
test('privateと未連携はpublic確認を送らず、別グループ/aliasのCASを混在させない',async()=>{
 const calls=[],db=client(async(_,a)=>{calls.push(a);return{data:{member_id:a.p_member_id,club_display_name:a.p_display_name,public_name_confirmed:a.p_public_confirmation}}});
 await saveClubDisplayName(db,{...member,club_display_name:'Aの旧名'},{...context,visibility:'private'},'Aの新名',true);
 const b={...member,id:'member-B',club_id:'club-B',club_display_name:'Bの旧名'};
 await saveClubDisplayName(db,b,{...context,clubId:'club-B',visibility:'private'},'Bの新名',false);
 await saveClubDisplayName(db,{...member,linked_auth_user_id:null},{...context,myRole:'sub_admin'},'仮メンバーの別名',false);
 assert.deepEqual(calls.map(c=>[c.p_club_id,c.p_expected_club_display_name,c.p_public_confirmation]),[['club-A','Aの旧名',false],['club-B','Bの旧名',false],['club-A',null,false]]);
 assert(!requiresPublicNameConfirmation(member,{...context,visibility:'private'}));
});
test('40001・403・RPC未適用・不正応答・通信断を成功扱いせず、旧表fallbackなし',async()=>{
 for(const code of ['40001','42501','PGRST202'])await assert.rejects(saveClubDisplayName(client(async()=>({error:{code}})),member,context,'入力を保持',true),e=>e.code===code);
 for(const data of [null,[],{member_id:'other',club_display_name:'入力を保持',public_name_confirmed:true},{member_id:member.id,club_display_name:'入力を保持',public_name_confirmed:false}])await assert.rejects(saveClubDisplayName(client(async()=>({data})),member,context,'入力を保持',true),/保存結果/);
 await assert.rejects(saveClubDisplayName(client(async()=>{throw Error('network')}),member,context,'入力を保持',true),/network/);
});
test('空・制御文字・120文字超・不正な対象はRPC前に拒否、Unicodeの120文字を許可',async()=>{
 const calls=[],db=client(async(_,a)=>{calls.push(a);return{data:{member_id:a.p_member_id,club_display_name:a.p_display_name,public_name_confirmed:true}}});
 for(const name of ['  ','a\nb','x'.repeat(121)])await assert.rejects(saveClubDisplayName(db,member,context,name,true));
 await assert.rejects(saveClubDisplayName(db,member,{...context,userId:'other'},'不正',true));assert.equal(calls.length,0);
 await saveClubDisplayName(db,member,context,'🎾'.repeat(120),true);assert.equal(calls.length,1);
});
test('公開名簿はDBの3列だけをそのまま取得し、旧linked未確認の省略や空一覧を補完しない',async()=>{
 let data=[{reference:'opaque',display_name:'公開確認した名前',is_unlinked:false}];const calls=[];
 const db=client((rpc,args)=>({range(){calls.push([rpc,args]);return Promise.resolve({data,error:null})}}));
 assert.deepEqual(await readPublicDirectory(db,'club-A'),data);
 data=[];assert.deepEqual(await readPublicDirectory(db,'club-A'),[]);assert(calls.every(([n])=>n==='get_public_club_directory'));
 const row={...member,player_profiles:{id:member.player_profile_id,display_name:'本人名',club_display_name:'別名',public_name_confirmed:true}};
 const roster=await readClubRoster(client(()=>({range:async()=>({data:[row]})})),'club-A');assert.deepEqual(roster,[row]);
});
