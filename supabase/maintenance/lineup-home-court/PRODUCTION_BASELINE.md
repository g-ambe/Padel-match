# Production baseline — limited recovery reference (not executable)

2026-11-25 JST. User explicitly approved omitting a new full database backup for #269 and preserving the four existing function definitions before applying two migrations using Supabase automatic version assignment. Existing encrypted backup release 456446359, captured 2026-11-24 16:42:29 JST, restored successfully (166 tables), predates #266/#268; it is not a current full recovery point. No production data rows or credentials included. Do not run these definitions as a rollback without separately reviewed compensation and approval. Preserve committed operations and history; use the existing lineup stop switch if separately authorized. For home court, retain free-text rejection on recovery; do not restore an insecure write route. No claim of lossless/full recovery. This checkpoint precedes SQL application.

## Catalog

```json
{
  "role": "postgres",
  "history_count": 27,
  "last_version": "20261124230702",
  "conflicts": 0,
  "editing_enabled": true,
  "targets": [
    {
      "sd": true,
      "acl": [
        "postgres=X/postgres"
      ],
      "args": "uuid, uuid",
      "name": "lineup_private.snapshot",
      "owner": "postgres",
      "config": [
        "search_path=\"\""
      ],
      "source": "010f705b9679387987c4cf8de06a7074",
      "volatility": "s",
      "definition_hash": "13a173d70f9611067a49e5a5145f9a61"
    },
    {
      "sd": true,
      "acl": [
        "postgres=X/postgres",
        "authenticated=X/postgres"
      ],
      "args": "uuid, uuid, jsonb, jsonb, uuid",
      "name": "public.replace_friendly_round_lineup",
      "owner": "postgres",
      "config": [
        "search_path=\"\""
      ],
      "source": "08dc4dc64dc91cbc4bd043690bfc603c",
      "volatility": "v",
      "definition_hash": "c2d1eabfda5722d82f4e5eba8df8a102"
    },
    {
      "sd": true,
      "acl": [
        "postgres=X/postgres",
        "service_role=X/postgres",
        "authenticated=X/postgres"
      ],
      "args": "uuid, bigint, text, uuid",
      "name": "public.save_my_home_court",
      "owner": "postgres",
      "config": [
        "search_path=\"\""
      ],
      "source": "616651b00b92b2ec52f0d2f12907c656",
      "volatility": "v",
      "definition_hash": "dd85ef4f420e48ee2c79dbe5c98ef3f8"
    },
    {
      "sd": true,
      "acl": [
        "postgres=X/postgres",
        "service_role=X/postgres",
        "authenticated=X/postgres"
      ],
      "args": "uuid, bigint, uuid, text, uuid",
      "name": "public.save_my_home_court_selection",
      "owner": "postgres",
      "config": [
        "search_path=\"\""
      ],
      "source": "a2ba8834ad9d738b40c8c01cacf03a5a",
      "volatility": "v",
      "definition_hash": "c913e12eebe0949fe9c573d248c0b93e"
    }
  ],
  "table_acl_hash": "c89c9c87d8c40ddc85173a8372d91cd4",
  "policy_hash": "0d84f2b16119e46c33145375e74a234f",
  "trigger_hash": "89b670dba05849d396684dfc808ea57e",
  "other_functions_hash": "f19695a9148695c6b3d7e2b623ade9ce"
}
```

## Exact prior definitions

### lineup_private.snapshot

```sql
CREATE OR REPLACE FUNCTION lineup_private.snapshot(p_event uuid, p_round uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare eligible uuid[];known uuid[];a public.event_fixed_pair_rounds;reason text;begin
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
end$function$;
```

### public.replace_friendly_round_lineup

```sql
CREATE OR REPLACE FUNCTION public.replace_friendly_round_lineup(p_event_id uuid, p_round_id uuid, p_expected jsonb, p_cards jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.events;prior public.friendly_match_operations;body jsonb;before_state jsonb;after_state jsonb;c jsonb;original jsonb;
 ids uuid[]:='{}';played uuid[]:='{}';eligible uuid[];row_count integer:=0;n integer;v_revision bigint;
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
 -- 有効固定のない既知の参加履歴だけ、実際の出場者に合わせる。不明な過去の参加機会は作らない。
 update public.event_fixed_pair_rounds set played_ids=(select array_agg(x order by x) from unnest(played) x) where round_id=p_round_id;
 if e.club_id is not null then insert into public.event_fixed_pair_state(event_id,revision) values(p_event_id,1) on conflict(event_id) do update set revision=public.event_fixed_pair_state.revision+1;end if;
 insert into public.friendly_round_lineup_state values(p_round_id,p_event_id,1) on conflict(round_id) do update set revision=public.friendly_round_lineup_state.revision+1 returning revision into v_revision;
 after_state:=lineup_private.snapshot(p_event_id,p_round_id)||jsonb_build_object('event_revision',lineup_private.revision(p_event_id)+1);
 insert into public.friendly_match_operations(request_id,actor_id,event_id,round_id,kind,body,before_state,result,changed_rows)
 values(p_request_id,auth.uid(),p_event_id,p_round_id,'lineup',body,before_state,jsonb_build_object('request_id',p_request_id,'snapshot',after_state),row_count);
 return jsonb_build_object('request_id',p_request_id,'snapshot',after_state);
end$function$;
```

### public.save_my_home_court

```sql
CREATE OR REPLACE FUNCTION public.save_my_home_court(p_profile uuid, p_expected bigint, p_name text, p_ticket uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE uid uuid; m public.player_profile_private; court text:=nullif(btrim(p_name),'');
BEGIN
 uid:=profile_media_private.owner(p_profile);
 PERFORM profile_media_private.consume(p_ticket);
 IF p_expected IS NULL OR p_expected<0 OR (court IS NOT NULL AND (char_length(court)>80 OR court ~ '[[:cntrl:]]')) THEN
  RAISE EXCEPTION 'ホームコートは80文字以内のコート名を入力してください' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.player_profile_private(profile_id,owner_id) VALUES(p_profile,uid) ON CONFLICT(profile_id) DO NOTHING;
 UPDATE public.player_profile_private SET home_facility_id=NULL,home_court_name=court,home_court_version=home_court_version+1,updated_at=clock_timestamp()
 WHERE profile_id=p_profile AND owner_id=uid AND home_court_version=p_expected RETURNING * INTO m;
 IF NOT FOUND THEN RAISE EXCEPTION 'ホームコートが別の画面で変更されています。再読み込みしてください' USING ERRCODE='40001';END IF;
 RETURN to_jsonb(m);
END; $function$;
```

### public.save_my_home_court_selection

```sql
CREATE OR REPLACE FUNCTION public.save_my_home_court_selection(p_profile uuid, p_expected bigint, p_facility uuid, p_name text, p_ticket uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE uid uuid; m public.player_profile_private; court text:=nullif(btrim(p_name),''); selected public.padel_facilities;
BEGIN
 uid:=profile_media_private.owner(p_profile);PERFORM profile_media_private.consume(p_ticket);
 IF p_expected IS NULL OR p_expected<0 THEN RAISE EXCEPTION '変更情報を確認してください' USING ERRCODE='22023';END IF;
 IF p_facility IS NOT NULL THEN
  SELECT * INTO selected FROM public.padel_facilities WHERE id=p_facility FOR SHARE;
  IF NOT FOUND OR selected.availability='closed' THEN RAISE EXCEPTION 'この施設は現在選択できません' USING ERRCODE='22023';END IF;
  court:=selected.name;
 END IF;
 IF court IS NOT NULL AND (char_length(court)>80 OR court ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'ホームコートは80文字以内のコート名を入力してください' USING ERRCODE='22023';END IF;
 INSERT INTO public.player_profile_private(profile_id,owner_id) VALUES(p_profile,uid) ON CONFLICT(profile_id) DO NOTHING;
 UPDATE public.player_profile_private SET home_facility_id=p_facility,home_court_name=court,home_court_version=home_court_version+1,updated_at=clock_timestamp()
 WHERE profile_id=p_profile AND owner_id=uid AND home_court_version=p_expected RETURNING * INTO m;
 IF NOT FOUND THEN RAISE EXCEPTION 'ホームコートが別の画面で変更されています。再読み込みしてください' USING ERRCODE='40001';END IF;
 RETURN to_jsonb(m)||jsonb_build_object('home_facility',CASE WHEN p_facility IS NOT NULL THEN jsonb_build_object('id',selected.id,'name',selected.name,'prefecture',selected.prefecture,'availability',selected.availability,'usage_note',selected.usage_note,'aliases',selected.aliases) ELSE NULL END);
END; $function$;
```
