-- 復旧専用・既定ROLLBACK。本番は別途承認・停止時間帯が必要。修復後に更新があれば停止する。
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.events,public.matches,public.match_players,public.event_participants,public.match_results in share row exclusive mode;
create temporary table score_repair_approval(batch_id uuid,plan jsonb,sha256 text,approved boolean) on commit drop;
-- REVIEWED_INPUT
do $recover$
declare a record;b score_repair_182.batches;current_digest text;columns_now jsonb;n integer;
begin
 if current_user in('anon','authenticated','service_role') then raise exception '管理用接続が必要です';end if;
 if (select count(*) from score_repair_approval)<>1 then raise exception '承認済み復旧対象が未設定です';end if;
 select * into a from score_repair_approval;
 select * into b from score_repair_182.batches where id=a.batch_id for update;
 if not found or a.approved is not true or b.plan_sha256 is distinct from a.sha256 or b.plan is distinct from a.plan then raise exception '承認対象が一致しません';end if;
 select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),''),'UTF8')),'hex') into current_digest from public.match_results r;
 if b.restored_at is not null then
  if current_digest is distinct from b.before_sha256 then raise exception '復旧後のデータが変更されています';end if;return;
 end if;
 if current_digest is distinct from b.after_sha256 then raise exception '修復後に結果が変更されています。一括復旧しません';end if;
 select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum) into columns_now from pg_attribute where attrelid='public.match_results'::regclass and attnum>0 and not attisdropped;
 if columns_now is distinct from b.columns_before then raise exception '結果表の構造が変更されています';end if;
 if to_regnamespace('lineup_private') is not null then
  if (select editing_enabled from lineup_private.release_control) is not false then raise exception 'メンバー入替を停止してから復旧してください';end if;
 end if;
 if exists(select 1 from pg_constraint where conrelid='public.match_results'::regclass and conname='match_results_one_per_match') then
  if not exists(select 1 from pg_constraint where conrelid='public.match_results'::regclass and conname='match_results_one_per_match' and contype='u' and pg_get_constraintdef(oid)='UNIQUE (match_id)') then raise exception '追加制約の定義が異なります';end if;
  -- 重複を元どおりにするため、この追加制約だけを戻す。CASCADE・RLS解除は使わない。
  alter table public.match_results drop constraint match_results_one_per_match;
 end if;
 insert into public.match_results select (jsonb_populate_record(null::public.match_results,s.row_data)).* from score_repair_182.rows s where s.batch_id=b.id and s.id<>s.keeper_id;
 get diagnostics n=row_count;if n<>b.removed_rows then raise exception '復旧件数が一致しません';end if;
 select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),''),'UTF8')),'hex') into current_digest from public.match_results r;
 if current_digest is distinct from b.before_sha256 then raise exception '復旧後の全結果行が修復前と一致しません';end if;
 update score_repair_182.batches set restored_at=now() where id=b.id;
end $recover$;
rollback;
