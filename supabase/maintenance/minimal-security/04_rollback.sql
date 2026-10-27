-- 適用作業中・業務再開前だけのメタデータ切り戻し。旧RLSへ戻るため公開停止を維持する。
-- 業務行の差分がある場合は中止し、前進修正または別途承認したDB復元を選ぶ。
-- 既定ROLLBACKで予行し、実行承認後だけ末尾をCOMMITにする。データ行の補正・削除はしない。
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $$ declare r record; fingerprint text; begin
  if to_regclass('security_minimal_backup.manifest') is null then raise exception '適用直前のバックアップがありません'; end if;
  if (select database_name from security_minimal_backup.manifest)<>current_database() then raise exception 'バックアップ取得元と一致しません'; end if;
  for r in select * from security_minimal_backup.row_fingerprints loop
    execute format('select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',r.table_name) into fingerprint;
    if fingerprint is distinct from r.content_hash then raise exception '業務再開後の変更があります。上書きせず中止します: %',r.table_name; end if;
  end loop;
end $$;
do $$ declare p record; role_list text; definition text; begin
  for p in select c.tablename,c.policyname from pg_policies c join security_minimal_backup.relations b on b.relname=c.tablename where c.schemaname='public' loop
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);
  end loop;
  for p in select t.tgname,c.relname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and t.tgname like 'security_minimal_%' loop
    execute format('drop trigger %I on public.%I',p.tgname,p.relname);
  end loop;
  for p in select c.* from security_minimal_backup.policies c join security_minimal_backup.relations b on b.relname=c.tablename loop
    select string_agg(case when x='public' then 'PUBLIC' else quote_ident(x) end,',') into role_list from unnest(p.roles) x;
    definition:=format('create policy %I on public.%I as %s for %s to %s',p.policyname,p.tablename,p.permissive,p.cmd,role_list);
    if p.qual is not null then definition:=definition||' using ('||p.qual||')'; end if;
    if p.with_check is not null then definition:=definition||' with check ('||p.with_check||')'; end if;
    execute definition;
  end loop;
  for p in select b.definition from security_minimal_backup.functions b loop execute p.definition; end loop;
end $$;
drop view public.public_player_profiles;
drop function public.get_shared_event(text,text);
drop function public.get_club_players(uuid);
drop function public.get_player_names(uuid[]);
drop function public.get_public_join_candidates(uuid);
drop function public.get_my_player_profiles();
drop function public.save_my_player_profile(uuid,jsonb,jsonb);
drop function public.create_friendly_round(uuid,int,jsonb,uuid);
drop function public.delete_friendly_match(uuid,uuid,uuid);
drop function public.set_friendly_lineup(uuid,uuid,jsonb,uuid);
drop function public.create_friendly_group(uuid,text,text,text);
drop function public.create_friendly_team(uuid,text,text,text,jsonb);
drop function profile_link_private.scoped_preview(uuid,uuid,uuid);
drop index public.security_minimal_one_result;
-- CASCADEは使わない。予期しない依存があれば中止する。
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='security_private' loop execute format('drop function %s',f.signature); end loop;
end $$;
drop schema security_private;
do $$ declare r record; a record; columns_sql text; grantee_sql text; begin
  for r in select * from security_minimal_backup.relations loop
    execute format('revoke all on public.%I from public,anon,authenticated',r.relname);
    select string_agg(quote_ident(attname),',') into columns_sql from security_minimal_backup.columns where relname=r.relname;
    execute format('revoke select(%1$s),insert(%1$s),update(%1$s),references(%1$s) on public.%2$I from public,anon,authenticated',columns_sql,r.relname);
    for a in select * from aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) where grantee in(0,'anon'::regrole,'authenticated'::regrole) loop
      if a.grantee in(0,'anon'::regrole) and a.privilege_type<>'SELECT' then continue; end if;
      grantee_sql:=case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end;
      execute format('grant %s on public.%I to %s%s',a.privilege_type,r.relname,grantee_sql,case when a.is_grantable then ' with grant option' else '' end);
    end loop;
    for a in select c.attname,g.* from security_minimal_backup.columns c cross join lateral aclexplode(c.attacl) g where c.relname=r.relname and g.grantee in(0,'anon'::regrole,'authenticated'::regrole) loop
      if a.grantee in(0,'anon'::regrole) and a.privilege_type<>'SELECT' then continue; end if;
      grantee_sql:=case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end;
      execute format('grant %s(%I) on public.%I to %s%s',a.privilege_type,a.attname,r.relname,grantee_sql,case when a.is_grantable then ' with grant option' else '' end);
    end loop;
    execute format('alter table public.%I %s row level security',r.relname,case when r.relrowsecurity then 'enable' else 'disable' end);
  end loop;
end $$;
-- 適用済みの緊急対策は復活させない。
drop policy if exists official_events_access on public.official_events;
drop policy if exists official_opponents_access on public.official_opponents;
drop policy if exists official_matches_access on public.official_matches;
notify pgrst,'reload schema';
rollback;
