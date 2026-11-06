begin read only;
do $$begin
 if to_regnamespace('lineup_private') is null or (select count(*) from pg_trigger where tgname in('lineup_legacy_round','lineup_legacy_match','lineup_legacy_players','lineup_legacy_score') and tgenabled='O')<>4 then raise exception '0041の定義を確認してください';end if;
 if exists(select 1 from pg_proc where oid in('public.get_friendly_lineup_versions(uuid)'::regprocedure,'public.get_friendly_round_lineup(uuid,uuid)'::regprocedure,'public.replace_friendly_round_lineup(uuid,uuid,jsonb,jsonb,uuid)'::regprocedure,'public.save_friendly_match_score(uuid,uuid,bigint,jsonb,jsonb,integer,integer,uuid)'::regprocedure,'public.create_friendly_round(jsonb)'::regprocedure,'public.delete_friendly_match(uuid,uuid,jsonb,uuid)'::regprocedure) and (not prosecdef or not('search_path=""'=any(proconfig)) or has_function_privilege('anon',oid,'execute') or has_function_privilege('service_role',oid,'execute') or not has_function_privilege('authenticated',oid,'execute'))) then raise exception 'RPC権限またはsearch_pathを確認してください';end if;
 if exists(select 1 from pg_class where oid in('public.friendly_round_lineup_state'::regclass,'public.friendly_match_operations'::regclass) and (not relrowsecurity or has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE') or has_table_privilege('anon',oid,'SELECT'))) then raise exception '新規表の権限を確認してください';end if;
 if position('p_kind=''delete''' in pg_get_functiondef('lineup_private.check_direct(uuid,uuid,text,uuid)'::regprocedure))=0
 or position('生成時の参加可能者の記録がない' in pg_get_functiondef('lineup_private.snapshot(uuid,uuid)'::regprocedure))=0
 or position('''delete''' in pg_get_functiondef('lineup_private.revision(uuid)'::regprocedure))=0
 then raise exception '0042の直接DELETE・未知の参加資格・版数保護を確認してください';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='lineup_private'
 and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
 or (p.proname not in('can_operate','check_direct') and has_function_privilege('authenticated',p.oid,'execute')))) then raise exception '非公開関数の実行権限を確認してください';end if;
end$$;
select editing_enabled from lineup_private.release_control;
select kind,count(*) from public.friendly_match_operations group by kind;
select s.round_id,s.event_id,s.revision,r.round_number from public.friendly_round_lineup_state s join public.rounds r on r.id=s.round_id where r.event_id is distinct from s.event_id;
-- 直後は0件。バックアップ後に通常操作があれば差分は調査し、自動復元しない。
select 'matches' table_name,count(*) differences from ((select to_jsonb(m) row_data from public.matches m except select to_jsonb(m) from round_lineup_backup_0041.matches m) union all (select to_jsonb(m) from round_lineup_backup_0041.matches m except select to_jsonb(m) from public.matches m)) d;
rollback;
