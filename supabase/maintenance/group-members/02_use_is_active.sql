-- 自動実行禁止。01の定義・ACLをエクスポートしてレビュー後、管理者が手動実行する。
-- 既存0039系の所属判定をis_activeへ統一する案。表・列・所属行は変更しない。
-- 申請・イベントのstatusは維持する。末尾はROLLBACKで試す。
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
declare signature text; function_oid oid; definition text; patched text; p record; expression text; condition text;
begin
  foreach signature in array array[
    'profile_link_private.club_role(uuid,uuid)',
    'profile_link_private.preview(uuid,uuid)',
    'profile_link_private.notify_admins(uuid,text,uuid,uuid,uuid)',
    'public.add_provisional_club_member(uuid,text,uuid)',
    'public.preview_profile_join(uuid,uuid)',
    'public.request_player_profile_link(uuid,uuid,uuid)',
    'public.review_player_profile_link(uuid,text,text)',
    'public.submit_profile_join_request(uuid,uuid,text,text)',
    'public.review_profile_join_request(uuid,text)'
  ] loop
    function_oid:=to_regprocedure(signature);
    if function_oid is null then continue; end if;
    definition:=pg_get_functiondef(function_oid);
    patched:=replace(definition, ' and cm.status = ''active''', '');
    patched:=replace(patched, ' and is_active and status = ''active''', ' and is_active');
    patched:=replace(patched, '''status'', cm.status', '''status'', case when cm.is_active then ''active'' else ''inactive'' end');
    patched:=replace(patched, 'club_members(club_id, player_profile_id, role, is_active, status)', 'club_members(club_id, player_profile_id, role, is_active)');
    patched:=replace(patched, 'club_members(club_id,player_profile_id,role,is_active,status)', 'club_members(club_id,player_profile_id,role,is_active)');
    patched:=replace(patched, 'values (p_club_id, p_operation_id, ''member'', true, ''active'')', 'values (p_club_id, p_operation_id, ''member'', true)');
    patched:=replace(patched, 'values (request.club_id,target,''member'',true,''active'')', 'values (request.club_id,target,''member'',true)');
    if patched<>definition then execute patched; end if;
  end loop;

  -- 対象は既存の公式イベント閲覧・登録ポリシーだけ。権限条件・役職条件は維持する。
  for p in select * from pg_policies where schemaname='public' and tablename='official_events' and policyname in ('official_events_select','official_events_insert') loop
    expression:='';
    if p.qual is not null then
      condition:=regexp_replace(p.qual, ' AND \(cm\.status = ''active''::text\)', '', 'g');
      expression:=expression||' using ('||condition||')';
    end if;
    if p.with_check is not null then
      condition:=regexp_replace(p.with_check, ' AND \(cm\.status = ''active''::text\)', '', 'g');
      expression:=expression||' with check ('||condition||')';
    end if;
    execute format('alter policy %I on public.official_events %s',p.policyname,expression);
  end loop;
  if exists (select 1 from pg_policies where schemaname='public' and (coalesce(qual,'')||coalesce(with_check,'')) like '%cm.status%') then
    raise exception '想定外の所属status参照がポリシーに残っています。01の結果で個別確認してください';
  end if;
end $$;
-- 関数の署名、SECURITY DEFINER、search_path、ACLは元のまま。
select p.oid::regprocedure,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='profile_link_private' and p.proname in ('club_role','preview','notify_admins');
rollback;
