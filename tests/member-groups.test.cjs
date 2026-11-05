const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const {readMemberGroups}=require('../lib/member-groups.ts');
const {navigationFixture,id,user,clubA,clubB}=require('./fixtures/navigation-app.cjs');
function client(f,{uid=user.id,fail}={}){
 const s=createClient('http://127.0.0.1:54321','local-test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input.url);if(fail===url.pathname.split('/').at(-1))return new Response(JSON.stringify({code:'42501',message:'取得失敗'}),{status:403});return f.fetch(input,init);
 }}});
 s.auth.getUser=async()=>({data:{user:uid?{id:uid}:null},error:null});return s;
}
test('本人の在籍グループだけを取得し、同じグループの所属行は重複表示しない',async()=>{
 const f=navigationFixture();f.tables.clubs.push({id:id(99),name:'第三グループ',is_active:true});f.tables.club_members.push({...f.tables.club_members[0],id:id(98)},{...f.tables.club_members[0],id:id(97),club_id:id(99),is_active:false});
 const result=await readMemberGroups(client(f));assert.deepEqual(result.groups.map(g=>g.id).sort(),[clubA,clubB].sort());assert(f.calls.every(c=>c.method==='GET'));assert(f.calls.some(c=>c.table==='club_members'&&c.url.searchParams.get('is_active')==='eq.true'&&c.url.searchParams.get('clubs.is_active')==='eq.true'));
});
test('super_userの全グループ閲覧権限を本人の所属一覧へ混ぜない',async()=>{
 const f=navigationFixture();f.tables.app_admins.push({id:id(90),profile_id:user.id,is_active:true});f.tables.clubs.push({id:id(99),name:'閲覧のみ',is_active:true});
 assert.deepEqual((await readMemberGroups(client(f))).groups.map(g=>g.id).sort(),[clubA,clubB].sort());
});
test('旧profile_id経路と未所属を維持し、表示だけではプロフィールを作らない',async()=>{
 const f=navigationFixture();f.tables.player_profiles=[];assert.equal((await readMemberGroups(client(f))).groups.length,2);assert.deepEqual((await readMemberGroups(client(f,{uid:id(2)}))).groups,[]);assert(f.calls.every(c=>c.method==='GET'));
});
test('未ログインでは所属データへ問い合わせず、取得エラーを未所属と表示しない',async()=>{
 const f=navigationFixture();assert.deepEqual(await readMemberGroups(client(f,{uid:null})),{uid:'',groups:[]});assert.equal(f.calls.length,0);
 for(const fail of ['app_admins','player_profiles','club_members'])await assert.rejects(readMemberGroups(client(navigationFixture(),{fail})),/取得/);
});
