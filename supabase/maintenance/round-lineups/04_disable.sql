-- 新規入替のみ停止。編集済みRoundのスコア・生成用RPCと旧保存拒否ガードは残す。
begin;
update lineup_private.release_control set editing_enabled=false where singleton;
revoke execute on function public.replace_friendly_round_lineup(uuid,uuid,jsonb,jsonb,uuid) from authenticated;
commit;
