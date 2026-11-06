-- 自動実行禁止。対象・本人/管理者承認を確認。スコアや後続履歴があれば復旧を停止する。
-- 元要求は残し、新しい入替要求として復旧を監査する。末尾はROLLBACKのまま。
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare approved_request_id uuid:=null; -- 承認した元の入替要求ID
 approved_operator_auth_id uuid:=null; -- 実際の承認担当アカウント（開催操作権限が必要）
 a public.friendly_match_operations;current_state jsonb;cards jsonb;recovered jsonb;was_enabled boolean;
begin
 if approved_request_id is null or approved_operator_auth_id is null then raise exception '承認した操作ID・担当者IDが未設定です';end if;
 select * into a from public.friendly_match_operations where request_id=approved_request_id and kind='lineup';
 if not found then raise exception '元の入替監査が見つかりません';end if;
 perform 1 from public.events where id=a.event_id for update;
 current_state:=lineup_private.snapshot(a.event_id,a.round_id);
 if current_state is distinct from a.result->'snapshot' then raise exception '以後の構成・スコア・参加状態・履歴が変わっています。復旧を停止します';end if;
 select jsonb_agg(jsonb_build_object('id',c->>'id','players',c->'players') order by c->>'id') into cards from jsonb_array_elements(a.before_state->'cards') c;
 perform set_config('request.jwt.claim.sub',approved_operator_auth_id::text,true);
 select editing_enabled into was_enabled from lineup_private.release_control;
 -- このトランザクション内だけ有効化。他接続には公開されない。既存の全検証を通して戻す。
 update lineup_private.release_control set editing_enabled=true where singleton;
 recovered:=public.replace_friendly_round_lineup(a.event_id,a.round_id,current_state,cards,gen_random_uuid());
 update lineup_private.release_control set editing_enabled=was_enabled where singleton;
 raise notice '元要求: %, 復旧要求: %。内容を確認し、別途COMMITを承認してください。',a.request_id,recovered->>'request_id';
end$$;
rollback;
