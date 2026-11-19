-- TASK-08 P0: staging-only candidate for the existing scoped_preview integration.
-- DO NOT APPLY TO PRODUCTION. Does not modify old 0039 or 0054/0055 migrations.
-- Default ROLLBACK: not an installable migration. Existing RLS/ACL/consent/review are unchanged.
-- Staging currently calls scoped_preview(source, recipient, club); keep that contract.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
begin
  if current_user <> 'postgres' or not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.get_player_profile_link_request(uuid)')
      and pg_get_userbyid(p.proowner) = 'postgres' and p.prosecdef
      and md5(pg_get_functiondef(p.oid)) = '7a8056ebfc2eddadf1dcff41c42a22cc'
  ) or not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('profile_link_private.scoped_preview(uuid,uuid,uuid)')
      and pg_get_userbyid(p.proowner) = 'postgres' and p.prosecdef
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
  ) then raise exception 'ステージング既存関数/所有者/ハッシュ/非公開helperを再照合してください'; end if;
end $$;

create or replace function public.get_player_profile_link_request(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare request public.player_profile_link_requests; result jsonb; recipient boolean;
begin
  select * into request from public.player_profile_link_requests where id = p_request_id;
  if not found or auth.uid() is null then
    raise exception 'この連携申請を確認する権限がありません';
  end if;
  recipient := request.target_auth_user_id = auth.uid();
  if not recipient and not public.can_manage_player_profile_club(request.club_id) then
    raise exception 'この連携申請を確認する権限がありません';
  end if;
  -- 全申請行をJSON化せず、画面で必要な共通列を列挙する。
  result := jsonb_build_object(
    'id', request.id, 'club_id', request.club_id,
    'club_name', (select name from public.clubs where id = request.club_id),
    'status', case when request.status = 'pending' and request.expires_at <= now() then 'expired' else request.status end,
    'created_at', request.created_at, 'expires_at', request.expires_at,
    'is_recipient', recipient, 'detail_scope', case when recipient then 'recipient' else 'manager' end
  );
  if recipient then
    -- ステージング固有のscoped_previewを維持し、元の同意preview/tokenの契約を変えない。
    -- 管理者を兼ねる場合も本人同意の枝を優先する。
    if request.status = 'pending' and request.expires_at > now() then
      result := result || profile_link_private.scoped_preview(request.source_player_profile_id, request.target_auth_user_id, request.club_id);
    end if;
  else
    -- 他グループを含むpreview/canonical/source_snapshotを管理者のために実行しない。
    result := result || jsonb_build_object(
      'source_display_name', (select pp.display_name from public.player_profiles pp
        join public.club_members cm on cm.id = request.source_club_member_id and cm.club_id = request.club_id
          and cm.player_profile_id = pp.id),
      'group_membership', (select jsonb_build_object(
        'role', cm.role, 'is_active', cm.is_active, 'created_at', cm.created_at
      ) from public.club_members cm
        where cm.id = request.source_club_member_id and cm.club_id = request.club_id)
    );
  end if;
  return result;
end $$;
rollback;
