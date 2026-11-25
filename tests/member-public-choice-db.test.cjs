const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {memberPublicDatabase}=require('./fixtures/member-public-choice-db.cjs');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/maintenance/group-member-public-choice/01_chatgpt_candidate.sql'),'utf8');
test('unchanged candidate: initialization, self-only CAS/OFF, legacy refusal and ACL boundary (synthetic SQL)',async t=>{
 const f=await memberPublicDatabase(false),d=f.db,id=f.id;
 const member=async n=>(await d.query('select * from club_members where club_id=$1 and player_profile_id=$2',[id(600),id(100+n)])).rows[0];
 try{
 await d.exec(`update clubs set visibility='public' where id='${id(600)}';`);
 const original=(await d.query('select to_jsonb(p) row from player_profiles p order by id')).rows;
 const history={};for(const table of ['events','rounds','matches','match_players','match_results','player_stats'])history[table]=(await d.query(`select to_jsonb(t) row from public.${table} t order by id`)).rows;
 const memberIdentityQuery="select to_jsonb(cm)-'club_display_name'-'club_display_name_public_confirmed_at'-'club_name_public_choice' row from club_members cm order by id";
 const memberIdentity=(await d.query(memberIdentityQuery)).rows;
 const boundaryQuery="select c.oid::text,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity from pg_class c where c.oid in ('public.club_members'::regclass,'public.player_profiles'::regclass,'public.join_requests'::regclass,'public.player_profile_link_requests'::regclass) order by c.oid";
 const boundary=(await d.query(boundaryQuery)).rows;
 const policies=(await d.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
 const fnMeta="select p.oid::text,p.proowner::text,p.proacl::text,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','profile_link_private','group_read_private') order by p.oid";
 const meta=(await d.query(fnMeta)).rows;
 const bodies=(await d.query("select p.oid::text,n.nspname||'.'||p.proname name,md5(p.prosrc) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','profile_link_private','group_read_private')")).rows;
 await d.query("update club_members set club_display_name='既存別名',club_display_name_public_confirmed_at=now() where club_id=$1 and player_profile_id=$2",[id(600),id(102)]);
 await d.exec(sql);
 await t.test('existing table ACL/RLS/policies and function owner/search_path/EXECUTE metadata unchanged',async()=>{
  assert.deepEqual((await d.query(boundaryQuery)).rows,boundary);assert.deepEqual((await d.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,policies);
  const after=(await d.query(fnMeta)).rows;for(const old of meta)assert.deepEqual(after.find(r=>r.oid===old.oid),old);
  const afterBodies=(await d.query("select oid::text,md5(prosrc) hash from pg_proc")).rows;
  assert.deepEqual(bodies.filter(old=>afterBodies.find(r=>r.oid===old.oid)?.hash!==old.hash).map(r=>r.name).sort(),['public.get_club_roster','public.get_public_club_directory','public.save_club_member_display_name','public.submit_profile_join_request_named','profile_link_private.apply_named_join_after_approval','public.review_player_profile_link_named'].sort());
 });
 await t.test('migration preserves profile names, existing alias/explicit timestamp and inactive rows',async()=>{
  assert.deepEqual((await d.query('select to_jsonb(p) row from player_profiles p order by id')).rows,original);
  assert.deepEqual((await d.query(memberIdentityQuery)).rows,memberIdentity);
  for(const [table,before]of Object.entries(history))assert.deepEqual((await d.query(`select to_jsonb(t) row from public.${table} t order by id`)).rows,before);
  assert.equal((await member(3)).club_display_name,'選手3');assert.equal((await member(3)).club_name_public_choice,'default_on');assert.equal((await member(3)).club_display_name_public_confirmed_at,null);
  assert.equal((await member(2)).club_display_name,'既存別名');assert.equal((await member(2)).club_name_public_choice,null);assert((await member(2)).club_display_name_public_confirmed_at);
  assert.equal((await member(5)).club_display_name,null);
 });
 const raw=await member(3);
 const args=(row,field,value)=>[id(600),row.id,field,field==='name'?value:null,field==='public'?value:null,row.club_display_name,row.club_name_public_choice,!!row.club_display_name_public_confirmed_at,'public'];
 await t.test('self OFF persists through rename and old client; stale CAS rejected',async()=>{
  await f.as(3);const off=await f.rpc('save_club_member_field_v2',args(raw,'public',false));assert.equal(off.public_name_enabled,false);assert.equal(off.public_name_choice,'off');
  await assert.rejects(()=>f.rpc('save_club_member_field_v2',args(raw,'name','競合')),e=>e.code==='PT409');
  const offRow={...raw,club_name_public_choice:'off',club_display_name_public_confirmed_at:null};
  const renamed=await f.rpc('save_club_member_field_v2',args(offRow,'name','本人の別名'));assert.equal(renamed.public_name_choice,'off');
  await assert.rejects(()=>f.rpc('save_club_member_display_name',[id(600),raw.id,'旧画面','本人の別名',true]),e=>e.code==='PT409');
 });
 await t.test('other account, super and anon cannot change linked member',async()=>{
  for(const n of [1,2,4,6]){await f.as(n);await assert.rejects(()=>f.rpc('save_club_member_field_v2',args(raw,'public',true)),e=>e.code==='42501');}
  await f.as(null,'anon');await assert.rejects(()=>f.rpc('save_club_member_field_v2',args(raw,'public',true)),e=>e.code==='42501');
 });
 await t.test('public DTO omits OFF and internal identity; roster keeps choice',async()=>{
  await f.as(4);const rows=(await d.query('select * from get_public_club_directory($1)',[id(600)])).rows;assert(rows.every(r=>Object.keys(r).sort().join(',')==='display_name,is_unlinked,reference'));assert(!rows.some(r=>r.display_name==='本人の別名'));
  await f.as(3);const roster=(await d.query('select * from get_club_roster($1)',[id(600)])).rows;assert.equal(roster.find(r=>r.id===raw.id).player_profiles.public_name_choice,'off');
 });
 await t.test('direct protected UPDATE refused and anonymous/internal named EXECUTE absent',async()=>{
  await f.as(3);await assert.rejects(()=>d.query('update club_members set club_name_public_choice=$1 where id=$2',['on',raw.id]),e=>e.code==='42501');
  await d.exec('reset role');const privileges=(await d.query("select has_function_privilege('anon','public.save_club_member_field_v2(uuid,uuid,text,text,boolean,text,text,boolean,text)','EXECUTE') anon,has_function_privilege('authenticated','public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)','EXECUTE') internal")).rows[0];assert.deepEqual(privileges,{anon:false,internal:false});
 });
 await t.test('direct INSERT cannot forge consent; old unnamed rejoin cannot overwrite OFF',async()=>{
  await f.as(1);await assert.rejects(()=>d.query("insert into club_members(club_id,player_profile_id,role,club_display_name,club_name_public_choice) values($1,$2,'member','偽装','default_on')",[id(600),id(103)]),/公開設定は本人用/);
  await d.exec('reset role');await d.query("update club_members set is_active=false,status='inactive' where id=$1",[raw.id]);
  await f.as(3);const oldRequest=await f.rpc('submit_public_club_claim',[id(600),null,null,null]);
  await f.as(1);await assert.rejects(()=>f.rpc('review_profile_join_request',[oldRequest,'approved']),/所属行があります/);
  await d.exec('reset role');assert.equal((await member(3)).club_name_public_choice,'off');
 });
 await t.test('second application fails atomically',async()=>{await assert.rejects(()=>d.exec(sql));await d.exec('rollback');assert.equal((await member(3)).club_name_public_choice,'off');});
 }finally{await d.close();}
});
test('named join OFF approval and recipient OFF merge preserve choice and audit snapshot',async t=>{
 const f=await memberPublicDatabase(),d=f.db,id=f.id;
 try{
  await d.exec(`update clubs set visibility='public' where id='${id(600)}'`);
  await f.as(4);const req=await f.rpc('submit_public_club_claim_named',[id(600),null,null,null,'公開しない名前',false]);
  await f.as(1);await f.rpc('review_profile_join_request',[req,'approved']);
  await d.exec('reset role');const joined=(await d.query('select cm.* from club_members cm join player_profiles pp on pp.id=cm.player_profile_id where cm.club_id=$1 and pp.linked_auth_user_id=$2',[id(600),id(4)])).rows[0];assert.equal(joined.club_name_public_choice,'off');assert.equal(joined.club_display_name_public_confirmed_at,null);
  await d.query('insert into player_profiles(id,display_name) values($1,$2)',[id(210),'未連携選手']);
  const m=(await d.query("insert into club_members(club_id,player_profile_id,role) values($1,$2,'member') returning id",[id(600),id(210)])).rows[0].id;
  await f.as(1);const link=await f.rpc('request_player_profile_link',[id(600),m,id(6)]);
  await f.as(6);const preview=await f.rpc('get_player_profile_link_request',[link]);
  const result=await f.rpc('review_player_profile_link_named',[link,preview.review_token,'受取人OFF',null,false]);assert.equal(result.public_name_enabled,false);assert.equal(result.public_name_confirmed,false);
  await d.exec('reset role');const cm=(await d.query('select * from club_members where id=$1',[m])).rows[0];assert.equal(cm.club_name_public_choice,'off');
  const audit=(await d.query("select after_row from profile_link_private.merge_changes where merge_id=$1 and source_table='club_members' and row_id=$2",[result.merge_id,m])).rows[0];assert.equal(audit.after_row.club_name_public_choice,'off');assert.deepEqual(audit.after_row,(await d.query('select to_jsonb(cm) row from club_members cm where id=$1',[m])).rows[0].row);
 }finally{await d.close();}
});
test('restore candidate permits only added NULL key, rejects subsequent OFF/alias changes; default ROLLBACK preserved',async()=>{
 const f=await memberPublicDatabase(false),d=f.db,id=f.id;
 const restoreSource=fs.readFileSync(path.join(__dirname,'../supabase/maintenance/group-member-public-choice/02_restore_compat_candidate.sql'),'utf8');
 try{
  await d.query('insert into player_profiles(id,display_name) values($1,$2)',[id(220),'旧仮名']);
  const m=(await d.query("insert into club_members(club_id,player_profile_id,role) values($1,$2,'member') returning id",[id(600),id(220)])).rows[0].id;
  await f.as(1);const link=await f.rpc('request_player_profile_link',[id(600),m,id(6)]);
  await f.as(6);const preview=await f.rpc('get_player_profile_link_request',[link]);
  const merged=await f.rpc('review_player_profile_link_named',[link,preview.review_token,'旧グループ名',null,false]);
  await d.exec('reset role');await d.exec(sql);
  const restore=restoreSource.replace('-- 復旧対象挿入位置',`insert into reviewed_merge_restore values ('${merged.merge_id}');`);
  await d.exec(restore);
  assert.equal((await d.query('select restored_at from player_profile_merges where id=$1',[merged.merge_id])).rows[0].restored_at,null);
  await d.query("update club_members set club_name_public_choice='off' where id=$1",[m]);
  await assert.rejects(()=>d.exec(restore),/編集・削除/);await d.exec('rollback');
  await d.query("update club_members set club_name_public_choice=null,club_display_name='あとから変更' where id=$1",[m]);
  await assert.rejects(()=>d.exec(restore),/編集・削除/);await d.exec('rollback');
 }finally{await d.close();}
});
