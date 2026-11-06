-- 0041を変更せず安全性を補完する。0041の直後、新アプリ反映前に全体を適用する。
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.events,public.rounds,public.matches,public.match_players,public.match_results in share row exclusive mode;
do $$begin
 if current_user in('anon','authenticated','service_role') or to_regprocedure('public.replace_friendly_round_lineup(uuid,uuid,jsonb,jsonb,uuid)') is null
 then raise exception '適用ロールと0041の適用状態を確認してください';end if;
 if (select editing_enabled from lineup_private.release_control) is not false then raise exception '入替を停止してから適用してください';end if;
end$$;
alter table public.friendly_match_operations drop constraint friendly_match_operations_kind_check;
alter table public.friendly_match_operations add constraint friendly_match_operations_kind_check check(kind in('lineup','score','generate','delete'));
create or replace function lineup_private.revision(p_event uuid) returns bigint
language sql stable security definer set search_path='' as $$select count(*) from public.friendly_match_operations where event_id=p_event and kind in('lineup','delete')$$;
create or replace function lineup_private.snapshot(p_event uuid,p_round uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare eligible uuid[];known uuid[];a public.event_fixed_pair_rounds;reason text;begin
 if not exists(select 1 from public.rounds where id=p_round and event_id=p_event) then raise exception 'Roundが見つかりません';end if;
 eligible:=lineup_private.eligible(p_event);
 select * into a from public.event_fixed_pair_rounds where round_id=p_round and event_id=p_event;
 if found then
  if jsonb_array_length(a.effective_pairs)>0 or jsonb_array_length(a.applied_pairs)>0 or jsonb_array_length(a.split_pairs)>0 then reason:='このRoundは固定ペアの使用履歴があるためメンバー変更できません。固定設定・履歴は保持されます。';end if;
  select coalesce(array_agg(x order by x),'{}'::uuid[]) into eligible from unnest(eligible) x where x=any(a.eligible_ids);
 else
  -- グループなしの新生成にも、要求監査に当時の参加可能者がある。
  select array(select x::uuid from jsonb_array_elements_text(o.body->'activeIds') x) into known from public.friendly_match_operations o where o.event_id=p_event and o.round_id=p_round and o.kind='generate' order by o.created_at limit 1;
  if found then select coalesce(array_agg(x order by x),'{}'::uuid[]) into eligible from unnest(eligible) x where x=any(known);
  else eligible:='{}'::uuid[];reason:='生成時の参加可能者の記録がないため、このRoundはメンバー変更できません。過去の参加状態は推測しません。';end if;
 end if;
 return jsonb_build_object('event_id',p_event,'round_id',p_round,'round_number',(select round_number from public.rounds where id=p_round),
 'event_revision',lineup_private.revision(p_event),'revision',coalesce((select revision from public.friendly_round_lineup_state where round_id=p_round),0),
 'last_round',(select max(round_number) from public.rounds where event_id=p_event),'status',(select status from public.events where id=p_event),
 'court_count',(select court_count from public.events where id=p_event),'fixed',fixed_pair_private.state(p_event,true),
 'audit',case when a.round_id is not null then to_jsonb(a) else null end,'eligible',eligible,'blocked_reason',reason,
 'people',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(pp.display_name,pr.display_name,p.guest_name,'選手名未設定'),'status',p.status) order by p.id)
 from public.event_participants p left join public.player_profiles pp on pp.id=p.player_profile_id left join public.profiles pr on pr.id=p.profile_id where p.event_id=p_event),'[]'::jsonb),
 'cards',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'court_number',m.court_number,'players',lineup_private.players(m.id),'completed',m.completed,'result',lineup_private.score(m.id)->'results') order by m.court_number,m.id) from public.matches m where m.round_id=p_round and m.event_id=p_event),'[]'::jsonb));
end$$;
create or replace function lineup_private.check_direct(p_event uuid,p_round uuid,p_kind text,p_match uuid default null) returns void
language plpgsql security definer set search_path='' as $$declare e public.events;begin
 select * into e from public.events where id=p_event for update;
 if not found or e.event_mode<>'auto' then return;end if;
 if not lineup_private.can_operate(p_event) then raise exception '開催の操作権限がありません' using errcode='42501';end if;
 if p_kind='delete' then raise exception '試合の削除は対応済み画面の専用削除を使用してください。再読み込みしてください' using errcode='42501';end if;
 if (p_kind in('score','lineup') and exists(select 1 from public.friendly_round_lineup_state where round_id=p_round))
 or (p_kind='round' and exists(select 1 from public.friendly_match_operations where event_id=p_event and kind in('lineup','delete'))) then
 raise exception '編集済みの開催は対応済み画面の専用保存を使用してください。再読み込みしてください' using errcode='42501';end if;
 if p_kind='new_score' and exists(select 1 from public.match_results where match_id=p_match) then raise exception '結果は既に登録されています。再読み込みしてください' using errcode='23505';end if;
end$$;
create or replace function lineup_private.guard_direct() returns trigger language plpgsql set search_path='' as $$
declare v_event uuid;v_round uuid;v_match uuid;kind text:='other';begin
 if current_user not in('anon','authenticated') then if TG_OP='DELETE' then return old;else return new;end if;end if;
 if TG_TABLE_NAME='rounds' then v_event:=coalesce(new.event_id,old.event_id);v_round:=coalesce(new.id,old.id);if TG_OP='INSERT' then kind:='round';end if;
 elsif TG_TABLE_NAME='matches' then v_event:=coalesce(new.event_id,old.event_id);v_round:=coalesce(new.round_id,old.round_id);v_match:=coalesce(new.id,old.id);
  if TG_OP='INSERT' then kind:='lineup';elsif TG_OP='UPDATE' and new.completed is distinct from old.completed then kind:='score';end if;
 else
  v_match:=coalesce(new.match_id,old.match_id);select event_id,round_id into v_event,v_round from public.matches where id=v_match;
  if TG_OP<>'DELETE' then if TG_TABLE_NAME='match_results' then kind:='score';else kind:='lineup';end if;end if;
 end if;
 if TG_OP='DELETE' then kind:='delete';end if;
 perform lineup_private.check_direct(v_event,v_round,kind,v_match);
 if TG_TABLE_NAME='match_results' and TG_OP='INSERT' then perform lineup_private.check_direct(v_event,v_round,'new_score',v_match);end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end$$;
create or replace function public.create_fixed_pair_round(p_event_id uuid,p_expected_revision bigint,p_last_round integer,p_court_count integer,p_mode text,p_active_ids uuid[],p_matches jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform lineup_private.lock_event(p_event_id);
 if exists(select 1 from public.friendly_match_operations where event_id=p_event_id and kind in('lineup','delete')) then raise exception '入替済みの開催は対応済み画面から生成してください' using errcode='42501';end if;
 return lineup_private.create_fixed_pair_round_v40(p_event_id,p_expected_revision,p_last_round,p_court_count,p_mode,p_active_ids,p_matches,p_request_id);
end$$;


-- 表示時のRound全体と照合し、子行・空Round・番号詰め・監査を一度で確定する。
-- 削除済み要求の再送は、同じ本人・同じ期待値に限り成功結果を返す。
create function public.delete_friendly_match(p_event_id uuid,p_match_id uuid,p_expected jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.events;m public.matches;prior public.friendly_match_operations;body jsonb;before_state jsonb;outcome jsonb;r record;n integer;changes integer:=0;removed_round boolean:=false;
begin
 e:=lineup_private.lock_event(p_event_id);
 body:=jsonb_build_object('match',p_match_id,'expected',p_expected);
 if p_request_id is null then raise exception '操作IDが必要です';end if;
 select * into prior from public.friendly_match_operations where request_id=p_request_id;
 if found then
  if prior.actor_id<>auth.uid() or prior.kind<>'delete' or prior.event_id<>p_event_id or prior.body is distinct from body then raise exception '操作IDの再利用内容が一致しません';end if;
  return prior.result;
 end if;
 select * into m from public.matches where id=p_match_id and event_id=p_event_id;
 if not found or e.status<>'active' then raise exception '開催中の試合のみ削除できます';end if;
 before_state:=lineup_private.snapshot(p_event_id,m.round_id);
 if before_state is distinct from p_expected then raise exception '構成・スコア・参加状態・Roundが変更されています。確認し直してください' using errcode='40001';end if;
 delete from public.match_results where match_id=m.id;get diagnostics n=row_count;changes:=changes+n;
 delete from public.match_players where match_id=m.id;get diagnostics n=row_count;changes:=changes+n;
 delete from public.matches where id=m.id;get diagnostics n=row_count;if n<>1 then raise exception '削除対象の件数が一致しません';end if;changes:=changes+n;
 if not exists(select 1 from public.matches where round_id=m.round_id) then
  delete from public.rounds where id=m.round_id;get diagnostics n=row_count;if n<>1 then raise exception 'Roundの件数が一致しません';end if;changes:=changes+n;removed_round:=true;
  -- 小さい番号から更新し、既存の(event_id,round_number)一意制約を維持する。
  for r in select id,round_number from public.rounds where event_id=e.id and round_number>(before_state->>'round_number')::integer order by round_number,id for update loop
   update public.rounds set round_number=r.round_number-1 where id=r.id;changes:=changes+1;
  end loop;
 else
  insert into public.friendly_round_lineup_state values(m.round_id,e.id,1) on conflict(round_id) do update set revision=public.friendly_round_lineup_state.revision+1;
 end if;
 -- 固定使用履歴と過去の参加機会は書き換えない。空Roundの監査は既存FKのSET NULLで保持。
 if e.club_id is not null then insert into public.event_fixed_pair_state(event_id,revision) values(e.id,1) on conflict(event_id) do update set revision=public.event_fixed_pair_state.revision+1;end if;
 outcome:=jsonb_build_object('request_id',p_request_id,'match_id',m.id,'deleted',true,'removed_round',removed_round,'event_revision',lineup_private.revision(e.id)+1);
 insert into public.friendly_match_operations(request_id,actor_id,event_id,round_id,kind,body,before_state,result,changed_rows)
 values(p_request_id,auth.uid(),e.id,m.round_id,'delete',body,before_state,outcome,changes);
 return outcome;
end$$;
revoke all on function public.delete_friendly_match(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_friendly_match(uuid,uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
