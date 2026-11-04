const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),maintenance=path.join(root,'supabase/maintenance');
const read=file=>fs.readFileSync(path.join(maintenance,file),'utf8');
const json=file=>JSON.parse(read(file));
const id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
const q=value=>'"'+String(value).replaceAll('"','""')+'"';

async function fixedPairDatabase(apply=true, providedDb){
 const db=providedDb??new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.role() returns text language sql stable as $$select current_user::text$$;
 grant usage on schema auth,public to anon,authenticated,service_role;
 create function public.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;`);
 const dir=path.join(root,'supabase/migrations');
 for(const file of fs.readdirSync(dir).sort())if(file.endsWith('.sql')&&file<'0040')await db.exec(fs.readFileSync(path.join(dir,file),'utf8').replace(/create extension if not exists (?:"uuid-ossp"|pgcrypto);/g,''));
 const core=['events','event_participants','rounds','matches','match_players','match_results'],snapshot=json('rls-select-batch/expected-post.json');
 for(const t of core){
  const existing=(await db.query('select policyname from pg_policies where schemaname=\'public\' and tablename=$1',[t])).rows;
  for(const p of existing)await db.exec(`drop policy ${q(p.policyname)} on public.${q(t)}`);
  await db.exec(`revoke all on public.${q(t)} from public,anon,authenticated,service_role`);
  const cols=(await db.query("select attname from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped",['public.'+t])).rows.map(r=>q(r.attname)).join(',');
  for(const p of ['select','insert','update','references'])await db.exec(`revoke ${p}(${cols}) on public.${q(t)} from public,anon,authenticated,service_role`);
 }
 for(const p of snapshot.policies.filter(p=>core.includes(p.tablename)))await db.exec(`create policy ${q(p.policyname)} on public.${q(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(q).join(',')}${p.qual?' using('+p.qual+')':''}${p.with_check?' with check('+p.with_check+')':''}`);
 for(const a of snapshot.acl.filter(a=>core.includes(a.table)))await db.exec(`grant ${a.privilege} on public.${q(a.table)} to ${q(a.grantee)}${a.grantable?' with grant option':''}`);
 for(const a of snapshot.column_acl.filter(a=>core.includes(a.table)))await db.exec(`grant ${a.privilege}(${q(a.column)}) on public.${q(a.table)} to ${q(a.grantee)}`);
 // 所属・プロフィールは0039、clubsは最新の本番適用記録を使う。古いdev_all_clubsを残さない。
 for(const p of (await db.query("select policyname from pg_policies where schemaname='public' and tablename='clubs'")).rows)await db.exec(`drop policy ${q(p.policyname)} on public.clubs`);
 for(const p of json('rls-clubs-select/production-select-snapshots.json').post)await db.exec(`create policy ${q(p.policyname)} on public.clubs for ${p.cmd} to ${p.roles.slice(1,-1).split(',').map(q).join(',')}${p.qual?' using('+p.qual+')':''}${p.with_check?' with check('+p.with_check+')':''}`);
 await db.exec('revoke all on public.clubs from anon,authenticated;grant select on public.clubs to anon;grant select,insert,update,delete on public.clubs to authenticated;grant maintain,references,trigger on public.clubs to anon,authenticated;grant all on public.app_admins,public.club_members,public.clubs,public.player_profiles,public.profiles to service_role');
 await db.exec(snapshot.helper);
 await db.exec('grant execute on function public.is_super_user(),public.can_manage_friendly_team_event_by_sides(uuid,uuid),public.can_view_friendly_team_event_by_sides(uuid,uuid) to anon,authenticated,service_role');
 await db.exec(read('group-members/03_guard_last_admin.sql').replace(/rollback;/g,'commit;'));
 // 本番適用記録のID保護を再現する。既存の適用用SQLの巨大な事前ガードは再実行しない。
 let sql=read('rls-participants-write/apply.sql');await db.exec(sql.slice(sql.indexOf('CREATE SCHEMA participants_identity_private'),sql.indexOf('CREATE POLICY rls07_participants_select_compat')));
 sql=read('rls-events-identity/apply.sql');await db.exec(sql.slice(sql.indexOf('CREATE SCHEMA events_identity_private')).replace(/COMMIT;/g,''));
 sql=read('rls-events-update/apply.sql');await db.exec(sql.slice(sql.indexOf('CREATE SCHEMA events_operation_private'),sql.indexOf('CREATE POLICY rls10_events_update_members')));
 await db.exec(json('event-member-controls/production-application.json').after.guard);
 sql=read('rls-delete-batch/apply.sql');await db.exec(sql.slice(sql.indexOf('CREATE SCHEMA match_identity_private'),sql.indexOf('CREATE TRIGGER guard_match_identity')));
 for(const t of json('rls-delete-batch/production-application.json').after.triggers)if(t.def.includes('match_identity_private'))await db.exec(t.def);
 for(let n=1;n<=6;n++){
  await db.query('insert into auth.users values($1,$2,now())',[id(n),`user${n}@example.invalid`]);
  await db.query('insert into profiles(id,display_name) values($1,$2)',[id(n),'選手'+n]);
  await db.query('insert into player_profiles(id,linked_auth_user_id,display_name) values($1,$2,$3)',[id(100+n),id(n),'選手'+n]);
 }
 await db.query("insert into clubs(id,name,owner_id) values($1,'グループA',$2),($3,'グループB',$4)",[id(600),id(1),id(601),id(4)]);
 for(const[n,club,role,active,legacy]of[[1,600,'main_admin',true,false],[2,600,'sub_admin',true,true],[3,600,'member',true,false],[4,601,'main_admin',true,false],[5,600,'member',false,false]])await db.query('insert into club_members(club_id,profile_id,player_profile_id,role,is_active) values($1,$2,$3,$4,$5)',[id(club),legacy?id(n):null,id(100+n),role,active]);
 await db.query('insert into app_admins(profile_id) values($1)',[id(6)]);
 async function as(n=3,role='authenticated'){
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[n?id(n):'',JSON.stringify({sub:n?id(n):'',email:n?`user${n}@example.invalid`:''})]);await db.exec('set role '+role);
 }
 async function event(num,count=6,extra={}){
  await db.exec('reset role');const eid=id(num),participants=Array.from({length:count},(_,i)=>id(num*100+i));
  await db.query('insert into events(id,name,court_count,club_id,event_mode,status,is_deleted,created_by_auth_user_id) values($1,$2,$3,$4,$5,$6,$7,$8)',[eid,'合成開催'+num,extra.courts??1,extra.noGroup?null:id(extra.club??600),extra.mode??'auto',extra.status??'active',extra.deleted??false,id(1)]);
  for(const[slot,pid]of participants.entries())await db.query("insert into event_participants(id,event_id,guest_name,status,participant_type) values($1,$2,$3,'active','guest')",[pid,eid,'ゲスト'+slot]);
  return{eid,participants};
 }
 async function rpc(name,args){const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');return(await db.query(`select public.${name}(${placeholders}) result`,args)).rows[0].result;}
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/0040_event_fixed_pairs.sql'),'utf8');
 if(apply)await db.exec(migration);
 return{db,as,event,rpc,id,migration};
}
module.exports={fixedPairDatabase,id};
