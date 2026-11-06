-- DB設計・バックアップ・復元・03・新アプリの確認と利用者承認後だけ実行。
begin;
grant execute on function public.replace_friendly_round_lineup(uuid,uuid,jsonb,jsonb,uuid) to authenticated;
update lineup_private.release_control set editing_enabled=true where singleton;
commit;
