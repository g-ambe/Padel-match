-- 手動適用専用。事前確認・DB外バックアップ・復元確認後に全体を実行する。
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.events,public.rounds,public.matches,public.match_players,public.match_results in share row exclusive mode;
do $$begin
 if current_user in('anon','authenticated','service_role') or to_regnamespace('lineup_private') is not null
 or to_regprocedure('public.create_fixed_pair_round(uuid,bigint,integer,integer,text,uuid[],jsonb,uuid)') is null
 then raise exception '適用ロール・0040適用状態・既存オブジェクトを確認してください'; end if;
end$$;
create schema lineup_private;
revoke all on schema lineup_private from public,anon,authenticated,service_role;
create table lineup_private.release_control(singleton boolean primary key default true check(singleton),editing_enabled boolean not null default false);
insert into lineup_private.release_control values(true,false);
create table public.friendly_round_lineup_state(
 round_id uuid primary key references public.rounds(id) on delete cascade,
 event_id uuid not null references public.events(id) on delete cascade,
 revision bigint not null check(revision>0)
);
create index friendly_round_lineup_event on public.friendly_round_lineup_state(event_id);
-- 監査をCASCADEで消さず、開催IDの再利用も防ぐ。通常画面の論理削除は維持する。
create table public.friendly_match_operations(
 request_id uuid primary key,actor_id uuid not null,event_id uuid not null references public.events(id) on delete restrict,round_id uuid,
 kind text not null check(kind in('lineup','score','generate')),body jsonb not null,
 before_state jsonb,result jsonb not null,changed_rows integer not null default 0,
 created_at timestamptz not null default now()
);
alter table public.friendly_round_lineup_state enable row level security;
alter table public.friendly_match_operations enable row level security;
revoke all on public.friendly_round_lineup_state,public.friendly_match_operations from public,anon,authenticated,service_role;
revoke all on all tables in schema lineup_private from public,anon,authenticated,service_role;

create function lineup_private.can_operate(p_event uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(auth.uid() is not null and exists(select 1 from public.events e where e.id=p_event and e.event_mode='auto' and not e.is_deleted
 and (public.is_super_user() or (e.club_id is null and e.created_by_auth_user_id=auth.uid()) or exists(
 select 1 from public.club_members cm left join public.player_profiles pp on pp.id=cm.player_profile_id
 where cm.club_id=e.club_id and cm.is_active and (cm.profile_id=auth.uid() or pp.linked_auth_user_id=auth.uid())))),false)
$$;
create function lineup_private.lock_event(p_event uuid) returns public.events
language plpgsql security definer set search_path='' as $$declare e public.events;begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'READ COMMITTEDで実行してください'; end if;
 select * into e from public.events where id=p_event for update;
 if not found or not lineup_private.can_operate(p_event) then raise exception 'この開催を操作する権限がありません' using errcode='42501'; end if;
 return e;
end$$;
create function lineup_private.eligible(p_event uuid) returns uuid[]
language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) from public.event_participants p join public.events e on e.id=p.event_id
 where p.event_id=p_event and p.status='active' and (e.club_id is null or p.participant_type='guest' or exists(
 select 1 from public.club_members cm join public.player_profiles pp on pp.id=coalesce(cm.player_profile_id,cm.profile_id)
 where cm.club_id=e.club_id and cm.is_active and pp.is_active and pp.id=coalesce(p.player_profile_id,p.profile_id)))
$$;
create function lineup_private.players(p_match uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('participant_id',participant_id,'team',team) order by team,participant_id),'[]'::jsonb)
 from public.match_players where match_id=p_match
$$;
create function lineup_private.score(p_match uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('completed',m.completed,'results',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'score_a',r.score_a,'score_b',r.score_b,'winner_team',r.winner_team) order by r.id) from public.match_results r where r.match_id=m.id),'[]'::jsonb)) from public.matches m where m.id=p_match
$$;
create function lineup_private.revision(p_event uuid) returns bigint
language sql stable security definer set search_path='' as $$select count(*) from public.friendly_match_operations where event_id=p_event and kind='lineup'$$;
create function public.get_friendly_lineup_versions(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not lineup_private.can_operate(p_event_id) then raise exception 'この開催を操作する権限がありません' using errcode='42501';end if;
 return jsonb_build_object('version',1,'editing_enabled',(select editing_enabled from lineup_private.release_control),'event_revision',lineup_private.revision(p_event_id),
 'rounds',coalesce((select jsonb_agg(jsonb_build_object('round_id',round_id,'revision',revision) order by round_id) from public.friendly_round_lineup_state where event_id=p_event_id),'[]'::jsonb));
end$$;
create function lineup_private.snapshot(p_event uuid,p_round uuid) returns jsonb
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
  if found then select coalesce(array_agg(x order by x),'{}'::uuid[]) into eligible from unnest(eligible) x where x=any(known);end if;
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
create function public.get_friendly_round_lineup(p_event_id uuid,p_round_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare e public.events;begin
 e:=lineup_private.lock_event(p_event_id);
 return lineup_private.snapshot(p_event_id,p_round_id);
end$$;

create function public.replace_friendly_round_lineup(p_event_id uuid,p_round_id uuid,p_expected jsonb,p_cards jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
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
end$$;

create function public.save_friendly_match_score(p_event_id uuid,p_match_id uuid,p_revision bigint,p_players jsonb,p_expected_score jsonb,p_a integer,p_b integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.events;m public.matches;prior public.friendly_match_operations;body jsonb;result_id uuid;outcome jsonb;win text;before_score jsonb;
begin
 e:=lineup_private.lock_event(p_event_id);
 body:=jsonb_build_object('match',p_match_id,'revision',p_revision,'players',p_players,'expected_score',p_expected_score,'a',p_a,'b',p_b);
 if p_request_id is null then raise exception '操作IDが必要です';end if;
 select * into prior from public.friendly_match_operations where request_id=p_request_id;
 if found then
  if prior.actor_id<>auth.uid() or prior.kind<>'score' or prior.event_id<>p_event_id or prior.body is distinct from body then raise exception '操作IDの再利用内容が一致しません';end if;
  return prior.result;
 end if;
 select * into m from public.matches where id=p_match_id and event_id=p_event_id;
 if not found or e.status<>'active' then raise exception '開催中の試合のみ保存できます';end if;
 if p_a is null or p_b is null then raise exception '両チームのスコアが必要です';end if;
 before_score:=lineup_private.score(p_match_id);
 if jsonb_array_length(before_score->'results')>1 then raise exception '結果が複数あります。管理者の確認が必要です';end if;
 if (select count(*)<>4 or count(distinct mp.participant_id)<>4 or count(*) filter(where mp.team='A')<>2 or count(*) filter(where mp.team='B')<>2 or count(ep.id)<>4
 from public.match_players mp left join public.event_participants ep on ep.id=mp.participant_id and ep.event_id=p_event_id where mp.match_id=p_match_id) then raise exception '試合の構成が不正です。管理者が確認してください';end if;
 if p_revision is distinct from coalesce((select revision from public.friendly_round_lineup_state where round_id=m.round_id),0)
 or p_players is distinct from lineup_private.players(p_match_id) or p_expected_score is distinct from before_score then
 raise exception '構成または結果が変更されています。最新の選手を確認し、スコアを再入力してください（再試行では構成を置き換えません）' using errcode='40001';end if;
 win:=case when p_a=p_b then 'draw' when p_a>p_b then 'A' else 'B' end;
 select id into result_id from public.match_results where match_id=p_match_id;
 if result_id is null then insert into public.match_results(match_id,score_a,score_b,winner_team) values(p_match_id,p_a,p_b,win) returning id into result_id;
 else update public.match_results set score_a=p_a,score_b=p_b,winner_team=win where id=result_id;end if;
 update public.matches set completed=true where id=p_match_id;
 outcome:=jsonb_build_object('request_id',p_request_id,'match_id',p_match_id,'result',jsonb_build_object('id',result_id,'score_a',p_a,'score_b',p_b,'winner_team',win));
 insert into public.friendly_match_operations(request_id,actor_id,event_id,round_id,kind,body,before_state,result,changed_rows) values(p_request_id,auth.uid(),p_event_id,m.round_id,'score',body,before_score,outcome,2);
 return outcome;
end$$;

-- 新旧クライアントの書込みを開催行で直列化。編集済みRoundの旧スコア・旧構成変更は拒否する。
-- INVOKERでRPCの所有者DMLと区別し、参照・ロックだけを限定DEFINERへ委譲する。
create function lineup_private.check_direct(p_event uuid,p_round uuid,p_kind text,p_match uuid default null) returns void
language plpgsql security definer set search_path='' as $$declare e public.events;begin
 select * into e from public.events where id=p_event for update;
 if not found or e.event_mode<>'auto' then return;end if;
 if not lineup_private.can_operate(p_event) then raise exception '開催の操作権限がありません' using errcode='42501';end if;
 if (p_kind in('score','lineup') and exists(select 1 from public.friendly_round_lineup_state where round_id=p_round))
 or (p_kind='round' and exists(select 1 from public.friendly_match_operations where event_id=p_event and kind='lineup')) then
 raise exception '編集済みの開催は対応済み画面の専用保存を使用してください。再読み込みしてください' using errcode='42501';end if;
 if p_kind='new_score' and exists(select 1 from public.match_results where match_id=p_match) then raise exception '結果は既に登録されています。再読み込みしてください' using errcode='23505';end if;
end$$;
create function lineup_private.guard_direct() returns trigger language plpgsql set search_path='' as $$
declare v_event uuid;v_round uuid;v_match uuid;kind text:='other';begin
 if current_user not in('anon','authenticated') then if TG_OP='DELETE' then return old;else return new;end if;end if;
 if TG_TABLE_NAME='rounds' then v_event:=coalesce(new.event_id,old.event_id);v_round:=coalesce(new.id,old.id);if TG_OP='INSERT' then kind:='round';end if;
 elsif TG_TABLE_NAME='matches' then v_event:=coalesce(new.event_id,old.event_id);v_round:=coalesce(new.round_id,old.round_id);v_match:=coalesce(new.id,old.id);
  if TG_OP='INSERT' then kind:='lineup';elsif TG_OP='UPDATE' and new.completed is distinct from old.completed then kind:='score';end if;
 else
  v_match:=coalesce(new.match_id,old.match_id);select event_id,round_id into v_event,v_round from public.matches where id=v_match;
  if TG_OP<>'DELETE' then if TG_TABLE_NAME='match_results' then kind:='score';else kind:='lineup';end if;end if;
 end if;
 perform lineup_private.check_direct(v_event,v_round,kind,v_match);
 if TG_TABLE_NAME='match_results' and TG_OP='INSERT' then perform lineup_private.check_direct(v_event,v_round,'new_score',v_match);end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end$$;
create trigger lineup_legacy_round before insert or update or delete on public.rounds for each row execute function lineup_private.guard_direct();
create trigger lineup_legacy_match before insert or update or delete on public.matches for each row execute function lineup_private.guard_direct();
create trigger lineup_legacy_players before insert or update or delete on public.match_players for each row execute function lineup_private.guard_direct();
create trigger lineup_legacy_score before insert or update or delete on public.match_results for each row execute function lineup_private.guard_direct();

-- 旧RPCは未編集の開催だけに限定する。実装本体は変更せず非公開へ移動する。
-- GUCの自己申告によるバイパスを設けず、新RPCだけが非公開の元実装を呼ぶ。
alter function public.create_fixed_pair_round(uuid,bigint,integer,integer,text,uuid[],jsonb,uuid) rename to create_fixed_pair_round_v40;
alter function public.create_fixed_pair_round_v40(uuid,bigint,integer,integer,text,uuid[],jsonb,uuid) set schema lineup_private;
create function public.create_fixed_pair_round(p_event_id uuid,p_expected_revision bigint,p_last_round integer,p_court_count integer,p_mode text,p_active_ids uuid[],p_matches jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform lineup_private.lock_event(p_event_id);
 if exists(select 1 from public.friendly_match_operations where event_id=p_event_id and kind='lineup') then raise exception '入替済みの開催は対応済み画面から生成してください' using errcode='42501';end if;
 return lineup_private.create_fixed_pair_round_v40(p_event_id,p_expected_revision,p_last_round,p_court_count,p_mode,p_active_ids,p_matches,p_request_id);
end$$;

-- 生成器は変更せず保存だけを原子化。履歴を読む前の入替版数を要求する。
create function public.create_friendly_round(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.events;prior public.friendly_match_operations;event_id uuid;req uuid;v_round uuid;v_match uuid;outcome jsonb;c jsonb;
 active uuid[];played uuid[]:='{}';part uuid[];courts integer;court_ids integer[]:='{}';last_round integer;team text;
begin
 event_id:=(p_request->>'eventId')::uuid;req:=(p_request->>'requestId')::uuid;
 e:=lineup_private.lock_event(event_id);
 if req is null then raise exception '操作IDが必要です';end if;
 select * into prior from public.friendly_match_operations where request_id=req;
 if found then
  if prior.actor_id<>auth.uid() or prior.kind<>'generate' or prior.event_id<>event_id or prior.body is distinct from p_request then raise exception '操作IDの再利用内容が一致しません';end if;
  return prior.result;
 end if;
 if (p_request->>'lineupRevision')::bigint is distinct from lineup_private.revision(event_id) then raise exception 'メンバー構成が変更されています。履歴を再取得して生成してください' using errcode='40001';end if;
 if e.club_id is not null then
  outcome:=lineup_private.create_fixed_pair_round_v40(event_id,(p_request->>'revision')::bigint,(p_request->>'lastRound')::integer,(p_request->>'courtCount')::integer,p_request->>'mode',
  array(select x::uuid from jsonb_array_elements_text(p_request->'activeIds') x),p_request->'matches',req);
  v_round:=(outcome->>'round_id')::uuid;
 else
  if e.status<>'active' or e.court_count is distinct from (p_request->>'courtCount')::integer then raise exception '開催状態・コート数が変更されています' using errcode='40001';end if;
  select coalesce(max(round_number),0) into last_round from public.rounds where rounds.event_id=e.id;
  if last_round is distinct from (p_request->>'lastRound')::integer then raise exception 'Roundが変更されています' using errcode='40001';end if;
  perform 1 from public.event_participants where event_participants.event_id=e.id order by id for share;
  active:=lineup_private.eligible(e.id);
  if cardinality(active) not between 4 and 20 or (select array_agg(x::uuid order by x::uuid) from jsonb_array_elements_text(p_request->'activeIds') x) is distinct from active then raise exception '参加状態が変更されています' using errcode='40001';end if;
  if p_request->>'mode' is null or p_request->>'mode' not in('normal','balance','rival') then raise exception '生成モードが不正です';end if;
  if p_request->>'mode'<>'normal' and (select count(*) from public.matches m where m.event_id=e.id and m.completed
   and (select count(*)=4 and count(distinct mp.participant_id)=4 and count(*) filter(where mp.team='A')=2 and count(*) filter(where mp.team='B')=2 from public.match_players mp where mp.match_id=m.id)
   and (select count(*)=1 and bool_and(score_a>=0 and score_b>=0) from public.match_results where match_id=m.id))<10 then raise exception '特別モードにはスコア登録済み10試合が必要です';end if;
  courts:=least(e.court_count,cardinality(active)/4);
  if jsonb_typeof(p_request->'matches') is distinct from 'array' or jsonb_array_length(p_request->'matches')<>courts then raise exception '試合数が不正です';end if;
  for c in select value from jsonb_array_elements(p_request->'matches') loop
   if jsonb_typeof(c->'teamA') is distinct from 'array' or jsonb_typeof(c->'teamB') is distinct from 'array' or jsonb_array_length(c->'teamA')<>2 or jsonb_array_length(c->'teamB')<>2
   or (c->>'court')::integer not between 1 and courts or (c->>'court')::integer=any(court_ids) then raise exception 'コート・2対2の構成を確認してください';end if;
   court_ids:=array_append(court_ids,(c->>'court')::integer);
   select array_agg(x::uuid) into part from jsonb_array_elements_text((c->'teamA')||(c->'teamB')) x;played:=played||part;
  end loop;
  if cardinality(played)<>courts*4 or (select count(distinct x) from unnest(played) x)<>courts*4 or not(played<@active) then raise exception '選手重複または参加状態を確認してください';end if;
  insert into public.rounds(event_id,round_number) values(e.id,last_round+1) returning id into v_round;
  for c in select value from jsonb_array_elements(p_request->'matches') loop
   insert into public.matches(event_id,round_id,court_number,completed) values(e.id,v_round,(c->>'court')::integer,false) returning id into v_match;
   foreach team in array array['teamA','teamB'] loop
    insert into public.match_players(match_id,participant_id,team) select v_match,x::uuid,case when team='teamA' then 'A' else 'B' end from jsonb_array_elements_text(c->team) x;
   end loop;
  end loop;
  outcome:=jsonb_build_object('event_id',e.id,'request_id',req,'round_id',v_round,'round_number',last_round+1);
 end if;
 insert into public.friendly_match_operations(request_id,actor_id,event_id,round_id,kind,body,result,changed_rows) values(req,auth.uid(),e.id,v_round,'generate',p_request,outcome,1+5*jsonb_array_length(p_request->'matches'));
 return outcome;
end$$;

revoke all on all functions in schema lineup_private from public,anon,authenticated,service_role;
grant usage on schema lineup_private to authenticated;
grant execute on function lineup_private.can_operate(uuid),lineup_private.check_direct(uuid,uuid,text,uuid) to authenticated;
revoke all on function public.create_fixed_pair_round(uuid,bigint,integer,integer,text,uuid[],jsonb,uuid),public.get_friendly_lineup_versions(uuid),public.get_friendly_round_lineup(uuid,uuid),public.replace_friendly_round_lineup(uuid,uuid,jsonb,jsonb,uuid),public.save_friendly_match_score(uuid,uuid,bigint,jsonb,jsonb,integer,integer,uuid),public.create_friendly_round(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_fixed_pair_round(uuid,bigint,integer,integer,text,uuid[],jsonb,uuid),public.get_friendly_lineup_versions(uuid),public.get_friendly_round_lineup(uuid,uuid),public.replace_friendly_round_lineup(uuid,uuid,jsonb,jsonb,uuid),public.save_friendly_match_score(uuid,uuid,bigint,jsonb,jsonb,integer,integer,uuid),public.create_friendly_round(jsonb) to authenticated;
grant select on public.friendly_round_lineup_state,public.friendly_match_operations to authenticated;
create policy friendly_lineup_state_read on public.friendly_round_lineup_state for select to authenticated using(lineup_private.can_operate(event_id));
create policy friendly_match_operations_read on public.friendly_match_operations for select to authenticated using(lineup_private.can_operate(event_id));
notify pgrst,'reload schema';
commit;
