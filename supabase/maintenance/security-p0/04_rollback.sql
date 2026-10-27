-- 同じ適用作業内の切り戻し専用。業務データを更新/削除/復元しない。
-- 事前に旧アプリへ戻す準備を行い、書き込みを止める。末尾ROLLBACKで必ず予行する。
-- レビュー後の実復旧時のみ、末尾をCOMMITへ変更する。
-- 旧RLS（dev_allを含む）へ戻るためP0の読み取り/権限横断リスクが再発する。
-- 既に適用済みの匿名書込撤回と公式無条件policy削除は戻さない。
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$ declare r record; begin
  if to_regclass('security_p0_backup_20261026.manifest') is null then
    raise exception '適用前バックアップがありません。推測した旧ポリシーは作成しません';
  end if;
  if (select database_name from security_p0_backup_20261026.manifest)<>current_database() then
    raise exception 'バックアップ取得元DBと一致しません';
  end if;
  if exists (select 1 from security_p0_backup_20261026.functions
    where signature='get_shared_event(text)' or signature='public.get_shared_event(text)') then
    raise exception 'P0以前から同名RPCが存在します。個別に復旧計画を確認してください';
  end if;
  if to_regclass('security_p0_backup_20261026.stats_identity_constraints') is null then
    raise exception '旧版のバックアップです。戦績IDのFKを確認して復旧計画を更新してください';
  end if;
  if exists (select 1 from security_p0_backup_20261026.stats_identity_constraints)
    and exists (select 1 from public.player_stats s where s.profile_id is not null
      and not exists (select 1 from public.profiles p where p.id=s.profile_id)) then
    raise exception '旧アカウント用FKへ戻せない選手IDの戦績があります。データを変更せず復旧を中止します';
  end if;
  if to_regclass('security_p0_history.operations') is not null and exists (select 1 from security_p0_history.operations where restored_at is null) then
    raise exception '稼働後の操作履歴があります。互換DBを保持し、操作単位の復旧または前進修正を実施してください';
  end if;
  -- 追加/削除された列へ古いACLを適用しない。
  for r in select * from security_p0_backup_20261026.columns loop
    if not exists (select 1 from pg_attribute a where a.attrelid=to_regclass(format('%I.%I',r.nspname,r.relname))
      and a.attname=r.attname and not a.attisdropped and format_type(a.atttypid,a.atttypmod)=r.data_type) then
      raise exception 'バックアップ後に列定義が変わっています: %.%.%',r.nspname,r.relname,r.attname;
    end if;
  end loop;
  if exists (
    select 1 from security_p0_backup_20261026.relations rel_backup
    join pg_namespace n on n.nspname=rel_backup.nspname
    join pg_class c on c.relnamespace=n.oid and c.relname=rel_backup.relname
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where not exists (select 1 from security_p0_backup_20261026.columns b
      where b.nspname=rel_backup.nspname and b.relname=rel_backup.relname and b.attname=a.attname)
  ) then
    raise exception 'バックアップ後に列が追加されています。別作業の変更を巻き戻しません';
  end if;
end $$;

-- まず新policy/triggerへの依存を除く。0039参照保護triggerは維持する。
do $$ declare r record; roles_sql text; policy_sql text; begin
  for r in select tablename,policyname from pg_policies where schemaname='public'
    and tablename in ('clubs','events','event_participants','rounds','matches','match_players','match_results','player_stats','event_team_sides','event_team_matches','official_events') loop
    execute format('drop policy %I on public.%I',r.policyname,r.tablename);
  end loop;
  for r in select c.relname,t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and t.tgname like 'security_p0_%' loop
    execute format('drop trigger %I on public.%I',r.tgname,r.relname);
  end loop;
  for r in select * from security_p0_backup_20261026.policies
    where tablename in ('clubs','events','event_participants','rounds','matches','match_players','match_results','player_stats','event_team_sides','event_team_matches','official_events') loop
    select string_agg(case when role_name='public' then 'PUBLIC' else quote_ident(role_name) end,',')
      into roles_sql from unnest(r.roles) as role_name;
    policy_sql:=format('create policy %I on %I.%I as %s for %s to %s',r.policyname,r.schemaname,r.tablename,r.permissive,r.cmd,roles_sql);
    if r.qual is not null then policy_sql:=policy_sql||format(' using (%s)',r.qual); end if;
    if r.with_check is not null then policy_sql:=policy_sql||format(' with check (%s)',r.with_check); end if;
    execute policy_sql;
  end loop;
end $$;

-- 本人承認の関数を取得時へ戻す。監査行・操作履歴は削除しない。
do $$ declare f record; begin
  for f in select definition from security_p0_backup_20261026.functions
    where (nspname='profile_link_private' and split_part(signature,'(',1) in
      ('profile_link_private.merge_profiles','profile_link_private.source_snapshot','profile_link_private.preview','profile_link_private.lock_references','profile_link_private.club_role','profile_link_private.notify_admins'))
      or (nspname='public' and regexp_replace(split_part(signature,'(',1),'^public\.','') in
      ('add_provisional_club_member','preview_profile_join','request_player_profile_link','review_player_profile_link','submit_profile_join_request','review_profile_join_request')) loop
    execute replace(f.definition,'CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
  end loop;
end $$;
drop function if exists public.save_friendly_result(uuid,uuid,int,int,uuid);
drop function if exists public.create_friendly_round(uuid,int,jsonb,uuid);
drop function if exists public.delete_friendly_match(uuid,uuid,uuid);
drop function if exists public.set_friendly_lineup(uuid,uuid,jsonb,uuid);
drop index if exists public.security_p0_one_result_per_match;
drop function if exists public.create_friendly_group(uuid,text,text,text);
drop function if exists public.create_friendly_team(uuid,text,text,text,jsonb);
drop function if exists public.change_friendly_event(uuid,text,text,uuid);
drop function if exists public.get_shared_event(text);
-- CASCADEは禁止。想定外の依存があれば中止する。
do $$ declare r record; begin
  for r in select p.oid::regprocedure::text as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='security_private' order by p.proname loop
    execute format('drop function %s',r.signature);
  end loop;
end $$;
drop schema if exists security_private;

do $$ declare constraint_row record; begin
  for constraint_row in select * from security_p0_backup_20261026.stats_identity_constraints loop
    execute format('alter table public.player_stats add constraint %I %s',constraint_row.conname,constraint_row.definition);
  end loop;
end $$;

-- anon/authenticated/PUBLICのACLを取得時へ戻す。service_roleや所有者は変更しない。
-- PUBLIC/anonへの書込GRANTは復活させず、緊急修正を維持する。
do $$ declare r record; grant_row record; grantee_sql text; columns_sql text; begin
  for r in select * from security_p0_backup_20261026.relations loop
    execute format('revoke all on table %I.%I from public,anon,authenticated',r.nspname,r.relname);
    select string_agg(quote_ident(attname),',') into columns_sql
      from security_p0_backup_20261026.columns where nspname=r.nspname and relname=r.relname;
    execute format('revoke select(%1$s),insert(%1$s),update(%1$s),references(%1$s) on %2$I.%3$I from public,anon,authenticated',columns_sql,r.nspname,r.relname);
    for grant_row in select a.* from aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) a
      where a.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated')) loop
      if grant_row.grantee in (0,(select oid from pg_roles where rolname='anon')) and grant_row.privilege_type<>'SELECT' then continue; end if;
      grantee_sql:=case when grant_row.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(grant_row.grantee)) end;
      execute format('grant %s on table %I.%I to %s%s',grant_row.privilege_type,r.nspname,r.relname,grantee_sql,case when grant_row.is_grantable then ' with grant option' else '' end);
    end loop;
    -- RLSの有効/強制状態も取得時へ戻す。
    execute format('alter table %I.%I %s row level security',r.nspname,r.relname,case when r.relrowsecurity then 'enable' else 'disable' end);
    execute format('alter table %I.%I %s force row level security',r.nspname,r.relname,case when r.relforcerowsecurity then '' else 'no' end);
  end loop;
  for r in select * from security_p0_backup_20261026.columns where attacl is not null loop
    for grant_row in select a.* from aclexplode(r.attacl) a
      where a.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated')) loop
      if grant_row.grantee in (0,(select oid from pg_roles where rolname='anon')) and grant_row.privilege_type<>'SELECT' then continue; end if;
      grantee_sql:=case when grant_row.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(grant_row.grantee)) end;
      execute format('grant %s(%I) on table %I.%I to %s%s',grant_row.privilege_type,r.attname,r.nspname,r.relname,grantee_sql,case when grant_row.is_grantable then ' with grant option' else '' end);
    end loop;
  end loop;
end $$;
drop policy if exists official_events_access on public.official_events;
drop policy if exists official_matches_access on public.official_matches;
drop policy if exists official_opponents_access on public.official_opponents;

select * from security_p0_backup_20261026.manifest;
select tablename,policyname,cmd from pg_policies where schemaname='public'
  and tablename in ('clubs','events','event_participants','rounds','matches','match_players','match_results','player_stats','event_team_sides','event_team_matches','official_events')
order by tablename,policyname;
rollback;
