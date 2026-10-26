-- 同時操作でも最後のメイン管理者を失わないための手動SQL案。
-- ブラウザの件数確認だけでは別行への同時更新を排他できないため、必要時は管理者が適用する。
-- 表・列・所属データは変更しない。01で既存トリガーを確認し、既定ROLLBACKで試す。
begin;
create function public.guard_group_last_main_admin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.is_active and old.role='main_admin' and (TG_OP='DELETE' or not new.is_active or new.role<>'main_admin' or new.club_id is distinct from old.club_id) then
    if current_setting('transaction_isolation')<>'read committed' then raise exception '管理者の在籍変更はREAD COMMITTEDで実行してください'; end if;
    perform 1 from public.clubs where id=old.club_id for update;
    if (select count(*) from public.club_members where club_id=old.club_id and is_active and role='main_admin')<=1 then
      raise exception 'メイン管理者は最低1人必要です';
    end if;
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_group_last_main_admin() from public,anon,authenticated;
create trigger guard_group_last_main_admin before update of is_active,role,club_id or delete on public.club_members
  for each row execute function public.guard_group_last_main_admin();
rollback;
