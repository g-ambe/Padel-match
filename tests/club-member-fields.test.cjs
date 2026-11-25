const {test}=require('node:test'),assert=require('node:assert/strict');
require('node:module').registerHooks({resolve(s,c,next){return next(['./permissions','./club-display-name'].includes(s)?s+'.ts':s,c)}});
const {saveClubMemberField,validMemberFieldState}=require('../lib/club-member-fields.ts');
const member={id:'m',club_id:'c',player_profile_id:'p',linked_auth_user_id:'u',role:'member',is_active:true,status:'active',player_active:true,profile_display_name:'本人名',club_display_name:null,public_name_confirmed:false};
const context={clubId:'c',userId:'u',visibility:'public',isSuperUser:false,myRole:'member'};
const state={member_id:'m',club_display_name:null,public_name_choice:null,public_name_confirmed:false,public_name_enabled:false,group_visibility:'public'};
const db=rpc=>({rpc,from(){throw Error('base table forbidden')}});
test('field RPC sends raw NULL CAS; OFF first then name uses confirmed OFF snapshot',async()=>{
 const calls=[];const client=db(async(n,a)=>{calls.push([n,a]);return {data:{...state,club_display_name:a.p_name??'本人名',public_name_choice:'off'}}});
 const off=await saveClubMemberField(client,member,context,state,{field:'public',enabled:false});
 await saveClubMemberField(client,member,context,off,{field:'name',name:'  別名  '});
 assert.equal(calls[0][0],'save_club_member_field_v2');assert.equal(calls[0][1].p_expected_name,null);assert.equal(calls[0][1].p_expected_choice,null);assert.equal(calls[0][1].p_public,false);
 assert.equal(calls[1][1].p_expected_choice,'off');assert.equal(calls[1][1].p_expected_name,'本人名');assert.equal(calls[1][1].p_name,'別名');assert.equal(calls[1][1].p_public,null);
});
test('incomplete DTO, other linked member, unlinked public toggle and private toggle fail before RPC',async()=>{
 let n=0;const client=db(async()=>{n++});
 for(const [m,c,s]of[[member,context,{...state,public_name_choice:undefined}],[member,{...context,userId:'other'},state],[{...member,linked_auth_user_id:null},{...context,myRole:'main_admin'},state],[member,{...context,visibility:'private'},{...state,group_visibility:'private'}]])await assert.rejects(()=>saveClubMemberField(client,m,c,s,{field:'public',enabled:true}));
 assert.equal(n,0);assert(!validMemberFieldState({...state,public_name_enabled:true,public_name_choice:'off'}));
});
test('conflict/error/network/unknown response never retries and preserves immutable input',async()=>{
 for(const mode of ['PT409','40001','42501','network','invalid','off-reset']){
  let n=0;const before=structuredClone(state);const client=db(async()=>{n++;if(mode==='network')throw Error();return ['PT409','40001','42501'].includes(mode)?{error:{code:mode}}:{data:mode==='invalid'?{}:{...state,public_name_choice:'on',public_name_confirmed:true,public_name_enabled:true,club_display_name:'別名'}}});
  const snap=mode==='off-reset'?{...state,public_name_choice:'off',club_display_name:'前の名前'}:state;
  await assert.rejects(()=>saveClubMemberField(client,member,context,snap,{field:'name',name:'別名'}));assert.equal(n,1);assert.deepEqual(state,before);
 }
});
test('name validates Unicode length/empty/control input; legacy confirmed null choice remains valid',async()=>{
 let n=0;const client=db(async(_,a)=>{n++;return{data:{...state,club_display_name:a.p_name,public_name_choice:"default_on",public_name_enabled:true}}});
 for(const name of ['',' ','a\nb','x'.repeat(121)])await assert.rejects(()=>saveClubMemberField(client,member,context,state,{field:'name',name}),e=>e.code==='22023');
 assert.equal(n,0);await saveClubMemberField(client,member,context,state,{field:'name',name:'字'.repeat(120)});assert.equal(n,1);assert(validMemberFieldState({...state,club_display_name:'旧名',public_name_confirmed:true,public_name_enabled:true}));
});
