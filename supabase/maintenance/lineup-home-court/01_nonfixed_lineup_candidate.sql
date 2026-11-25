-- ChatGPT candidate ONLY; not approved for production.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Unexpected migration role'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('lineup_private.snapshot(uuid, uuid)')) IS DISTINCT FROM '010f705b9679387987c4cf8de06a7074' THEN RAISE EXCEPTION 'Baseline changed: lineup_private.snapshot'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.replace_friendly_round_lineup(uuid, uuid, jsonb, jsonb, uuid)')) IS DISTINCT FROM '08dc4dc64dc91cbc4bd043690bfc603c' THEN RAISE EXCEPTION 'Baseline changed: public.replace_friendly_round_lineup'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION lineup_private.snapshot(p_event uuid, p_round uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare eligible uuid[];known uuid[];a public.event_fixed_pair_rounds;reason text;protected_ids uuid[]:='{}';begin
 if not exists(select 1 from public.rounds where id=p_round and event_id=p_event) then raise exception 'Roundが見つかりません';end if;
 eligible:=lineup_private.eligible(p_event);
 select * into a from public.event_fixed_pair_rounds where round_id=p_round and event_id=p_event;
 if found then
  IF jsonb_typeof(a.effective_pairs) IS DISTINCT FROM 'array' OR jsonb_typeof(a.applied_pairs) IS DISTINCT FROM 'array' OR jsonb_typeof(a.split_pairs) IS DISTINCT FROM 'array' OR a.eligible_ids IS NULL THEN
   reason:='固定ペア履歴を確認できないため、このRoundはメンバー変更できません。';
  ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(a.effective_pairs||a.applied_pairs||a.split_pairs) AS j(v)
    WHERE jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT coalesce((v->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) OR NOT coalesce((v->>'a') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) OR NOT coalesce((v->>'b') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) OR v->>'a'=v->>'b')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.applied_pairs) AS j(v) WHERE NOT coalesce((v->>'match_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)) THEN
   reason:='固定ペア履歴を確認できないため、このRoundはメンバー変更できません。';
  ELSE
   SELECT coalesce(array_agg(DISTINCT pid ORDER BY pid),'{}'::uuid[]) INTO protected_ids
   FROM jsonb_array_elements(a.effective_pairs||a.applied_pairs||a.split_pairs) AS j(v)
   CROSS JOIN LATERAL (VALUES ((v->>'a')::uuid),((v->>'b')::uuid)) AS members(pid);
   IF NOT (protected_ids <@ a.eligible_ids)
      OR EXISTS (SELECT 1 FROM unnest(protected_ids) AS u(pid) WHERE NOT EXISTS (SELECT 1 FROM public.event_participants ep WHERE ep.event_id=p_event AND ep.id=u.pid))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.applied_pairs||a.split_pairs) AS x(v) WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a.effective_pairs) AS y(w) WHERE w->>'id'=v->>'id' AND w->>'a'=v->>'a' AND w->>'b'=v->>'b'))
      OR (SELECT count(*) FROM jsonb_array_elements(a.effective_pairs))*2<>cardinality(protected_ids)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.effective_pairs) AS x(v) GROUP BY v->>'id' HAVING count(*)>1)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.applied_pairs||a.split_pairs) AS x(v) GROUP BY v->>'id' HAVING count(*)>1)
   THEN reason:='固定ペア履歴を確認できないため、このRoundはメンバー変更できません。'; END IF;
  END IF;
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
 'audit',case when a.round_id is not null then to_jsonb(a) else null end,'eligible',eligible,'blocked_reason',reason,'lineup_protection_version',1,'protected_participant_ids',to_jsonb(protected_ids),
 'people',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(pp.display_name,pr.display_name,p.guest_name,'選手名未設定'),'status',p.status) order by p.id)
 from public.event_participants p left join public.player_profiles pp on pp.id=p.player_profile_id left join public.profiles pr on pr.id=p.profile_id where p.event_id=p_event),'[]'::jsonb),
 'cards',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'court_number',m.court_number,'players',lineup_private.players(m.id),'completed',m.completed,'result',lineup_private.score(m.id)->'results') order by m.court_number,m.id) from public.matches m where m.round_id=p_round and m.event_id=p_event),'[]'::jsonb));
end$function$;

CREATE OR REPLACE FUNCTION public.replace_friendly_round_lineup(p_event_id uuid, p_round_id uuid, p_expected jsonb, p_cards jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.events;prior public.friendly_match_operations;body jsonb;before_state jsonb;after_state jsonb;c jsonb;original jsonb;
 ids uuid[]:='{}';played uuid[]:='{}';eligible uuid[];protected_ids uuid[];row_count integer:=0;n integer;v_revision bigint;
begin
 e:=lineup_private.lock_event(p_event_id);
 body:=jsonb_build_object('round',p_round_id,'expected',p_expected,'cards',p_cards);
 if p_request_id is null then raise exception '操作IDが必要です';end if;
 select * into prior from public.friendly_match_operations where request_id=p_request_id;
 if found then
  if prior.actor_id<>auth.uid() or prior.kind<>'lineup' or prior.event_id<>p_event_id or prior.body is distinct from body then raise exception '操作IDの再利用内容が一致しません';end if;
  return prior.result;
 end if;
 if (select editing_enabled from lineup_private.release_control) is not true then raise exception 'メンバー変更は現在停止中です';end if;
 if e.status<>'active' then raise exception '終了済みの開催は変更できません';end if;
 -- 参加状態変更とは行ロックで直列化。既存のstatus更新経路へイベントロックを追加しない。
 perform 1 from public.event_participants where event_id=p_event_id order by id for share;
 before_state:=lineup_private.snapshot(p_event_id,p_round_id);
 if before_state is distinct from p_expected then raise exception '構成・スコア・参加状態・Roundが変更されています。最新データを確認してください' using errcode='40001';end if;
 if before_state->>'blocked_reason' is not null then raise exception '%',before_state->>'blocked_reason';end if;
 IF before_state->'lineup_protection_version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(before_state->'protected_participant_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '固定ペア履歴を確認できません。再読み込みしてください'; END IF;
 SELECT coalesce(array_agg(x::uuid),'{}'::uuid[]) INTO protected_ids FROM jsonb_array_elements_text(before_state->'protected_participant_ids') x;
 if exists(select 1 from public.matches where round_id=p_round_id group by court_number having count(*)>1 or court_number not between 1 and 5) then raise exception 'コート構成が不正です。管理者が確認してください';end if;
 select coalesce(array_agg(x::uuid),'{}'::uuid[]) into eligible from jsonb_array_elements_text(before_state->'eligible') x;
 if jsonb_typeof(p_cards) is distinct from 'array' or jsonb_array_length(p_cards)<>jsonb_array_length(before_state->'cards') or jsonb_array_length(p_cards)=0 then raise exception 'Round全体のカードが一致しません';end if;
 for c in select value from jsonb_array_elements(p_cards) loop
  if jsonb_typeof(c) is distinct from 'object' or exists(select 1 from jsonb_object_keys(c) k where k not in('id','players')) then raise exception 'カードの形式を確認してください';end if;
  select value into original from jsonb_array_elements(before_state->'cards') where value->>'id'=c->>'id';
  if original is null or jsonb_array_length(original->'players')<>4 or (select count(*) from jsonb_array_elements(original->'players') p where p->>'team'='A')<>2 or (select count(*) from jsonb_array_elements(original->'players') p where p->>'team'='B')<>2 or (c->>'id')::uuid=any(ids) then raise exception '対象カードが一致しません';end if;
  ids:=array_append(ids,(c->>'id')::uuid);
  if jsonb_typeof(c->'players') is distinct from 'array' or jsonb_array_length(c->'players')<>4
   or (select count(*) from jsonb_array_elements(c->'players') p where p->>'team'='A')<>2
   or (select count(*) from jsonb_array_elements(c->'players') p where p->>'team'='B')<>2 then raise exception '各ペア2名、1試合4名を指定してください';end if;
  if exists(select 1 from jsonb_array_elements(c->'players') p where jsonb_typeof(p) is distinct from 'object' or p->>'participant_id' is null or exists(select 1 from jsonb_object_keys(p) k where k not in('participant_id','team'))) then raise exception '選手の形式が不正です';end if;
  select array_agg((p->>'participant_id')::uuid) into played from jsonb_array_elements(c->'players') p;
  if (select count(*) from public.event_participants where event_id=p_event_id and id=any(played))<>4 then raise exception '別開催の選手が含まれています';end if;
  if (select count(distinct x) from unnest(played) x)<>4 then raise exception '選手が重複しています';end if;
  -- Protected participants must stay on the same match/team or remain resting.
  IF (SELECT jsonb_agg(p ORDER BY p->>'team',p->>'participant_id') FROM jsonb_array_elements(c->'players') p WHERE (p->>'participant_id')::uuid=ANY(protected_ids))
     IS DISTINCT FROM
     (SELECT jsonb_agg(p ORDER BY p->>'team',p->>'participant_id') FROM jsonb_array_elements(original->'players') p WHERE (p->>'participant_id')::uuid=ANY(protected_ids))
  THEN RAISE EXCEPTION '固定ペアの選手は変更できません' USING ERRCODE='22023'; END IF;
  if (select jsonb_agg(p order by p->>'team',p->>'participant_id') from jsonb_array_elements(c->'players') p) is distinct from original->'players' then
   if (original->>'completed')::boolean or jsonb_array_length(original->'result')>0 then raise exception 'スコア入力済みのカードは変更できません';end if;
   if not(played<@eligible) then raise exception '変更するカードには当該Roundの参加可能な選手を指定してください';end if;
   -- 行ID・team・match_idを維持してスロットの選手参照だけを更新する。
   with slots as(select id,row_number() over(order by team,id) pos from public.match_players where match_id=(c->>'id')::uuid),
   desired as(select (p->>'participant_id')::uuid pid,row_number() over(order by p->>'team',p->>'participant_id') pos from jsonb_array_elements(c->'players') p)
   update public.match_players mp set participant_id=d.pid from slots s join desired d using(pos) where mp.id=s.id;
   get diagnostics n=row_count;if n<>4 then raise exception '出場者行数が一致しません';end if;row_count:=row_count+n;
   if lineup_private.players((c->>'id')::uuid) is distinct from (select jsonb_agg(p order by p->>'team',p->>'participant_id') from jsonb_array_elements(c->'players') p) then raise exception '保存後の構成が一致しません';end if;
  end if;
 end loop;
 select array_agg((p->>'participant_id')::uuid) into played from jsonb_array_elements(p_cards) z cross join lateral jsonb_array_elements(z->'players') p;
 if (select count(distinct x) from unnest(played) x)<>cardinality(played) then raise exception '同じRoundに選手が重複しています';end if;
 if row_count=0 then raise exception '変更がありません';end if;
 -- 既知の参加履歴のplayed_idsだけを実際の出場者に合わせる。固定履歴・参加機会は不変。
 update public.event_fixed_pair_rounds set played_ids=(select array_agg(x order by x) from unnest(played) x) where round_id=p_round_id;
 if e.club_id is not null then insert into public.event_fixed_pair_state(event_id,revision) values(p_event_id,1) on conflict(event_id) do update set revision=public.event_fixed_pair_state.revision+1;end if;
 insert into public.friendly_round_lineup_state values(p_round_id,p_event_id,1) on conflict(round_id) do update set revision=public.friendly_round_lineup_state.revision+1 returning revision into v_revision;
 after_state:=lineup_private.snapshot(p_event_id,p_round_id)||jsonb_build_object('event_revision',lineup_private.revision(p_event_id)+1);
 insert into public.friendly_match_operations(request_id,actor_id,event_id,round_id,kind,body,before_state,result,changed_rows)
 values(p_request_id,auth.uid(),p_event_id,p_round_id,'lineup',body,before_state,jsonb_build_object('request_id',p_request_id,'snapshot',after_state),row_count);
 return jsonb_build_object('request_id',p_request_id,'snapshot',after_state);
end$function$;
NOTIFY pgrst,'reload schema';
COMMIT;
