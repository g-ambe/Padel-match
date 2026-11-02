-- 一部ペア固定。承認前の本番自動実行は禁止。01_preflight・バックアップ・ローカル試験後に手動適用する。
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.events,public.event_participants,public.rounds,public.matches,public.match_players in share row exclusive mode;

-- 既存RLS/ACL/トリガーは置き換えない。適用前後の定義一致も末尾で検査する。
create temporary table fixed_pair_before on commit drop as
select 'policy' kind,p.tablename||'.'||p.policyname key,to_jsonb(p) value from pg_policies p
 where schemaname='public' and tablename in('events','event_participants','rounds','matches','match_players','match_results')
union all select 'acl',c.relname,jsonb_build_object('table',c.relacl,'columns',(select jsonb_agg(jsonb_build_array(a.attname,a.attacl) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped))
 from pg_class c where c.oid in('public.events'::regclass,'public.event_participants'::regclass,'public.rounds'::regclass,'public.matches'::regclass,'public.match_players'::regclass,'public.match_results'::regclass)
union all select 'trigger',c.relname||'.'||t.tgname,jsonb_build_object('definition',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid),'enabled',t.tgenabled)
 from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.oid in('public.events'::regclass,'public.event_participants'::regclass,'public.rounds'::regclass,'public.matches'::regclass,'public.match_players'::regclass,'public.match_results'::regclass);
do $guard$
begin
 if current_user in('anon','authenticated','service_role') or to_regnamespace('fixed_pair_private') is not null then raise exception '適用ロールまたは既存オブジェクトを確認してください'; end if;
 if exists(select 1 from pg_class where oid in('public.events'::regclass,'public.event_participants'::regclass,'public.rounds'::regclass,'public.matches'::regclass,'public.match_players'::regclass,'public.match_results'::regclass) and not relrowsecurity)
 or exists(select 1 from pg_policies where schemaname='public' and tablename in('events','event_participants','rounds','matches','match_players','match_results') and cmd='ALL')
 or not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='rls10_events_update_members')
 or (select count(*) from pg_trigger where tgname in('guard_event_identity','guard_event_member_fields','guard_participant_identity','guard_match_identity') and tgenabled='O' and tgrelid in('public.events'::regclass,'public.event_participants'::regclass,'public.rounds'::regclass,'public.matches'::regclass,'public.match_players'::regclass,'public.match_results'::regclass))<>7
 then raise exception '確認済みのRLS・ID保護と異なります。再調査してください'; end if;
end $guard$;

create schema fixed_pair_private;
revoke all on schema fixed_pair_private from public,anon,authenticated,service_role;
create unique index fixed_pair_participant_event_id on public.event_participants(event_id,id);

create table public.event_fixed_pair_state(
 event_id uuid primary key references public.events(id) on delete cascade,
 revision bigint not null default 0 check(revision>=0),
 used_fixed_pairs boolean not null default false,
 last_request_id uuid,
 last_request_body jsonb
);
create table public.event_fixed_pairs(
 id uuid primary key,
 event_id uuid not null references public.events(id) on delete cascade,
 a uuid not null,b uuid not null,check(a<b),
 foreign key(event_id,a) references public.event_participants(event_id,id),
 foreign key(event_id,b) references public.event_participants(event_id,id)
);
create index event_fixed_pairs_event on public.event_fixed_pairs(event_id);
create table public.event_fixed_pair_rounds(
 event_id uuid not null references public.events(id) on delete cascade,
 request_id uuid not null,
 request_body jsonb not null,
 round_id uuid unique references public.rounds(id) on delete set null,
 round_number integer not null check(round_number>0),
 eligible_ids uuid[] not null,
 played_ids uuid[] not null,
 applied_pairs jsonb not null check(jsonb_typeof(applied_pairs)='array'),
 split_pairs jsonb not null check(jsonb_typeof(split_pairs)='array'),
 created_by uuid not null,
 created_at timestamptz not null default now(),
 primary key(event_id,request_id)
);
alter table public.event_fixed_pair_state enable row level security;
alter table public.event_fixed_pairs enable row level security;
alter table public.event_fixed_pair_rounds enable row level security;
revoke all on public.event_fixed_pair_state,public.event_fixed_pairs,public.event_fixed_pair_rounds from public,anon,authenticated,service_role;

create function fixed_pair_private.can_operate(p_event_id uuid) returns boolean
language sql stable security definer set search_path=''
as $$
 select coalesce(auth.uid() is not null and exists(
  select 1 from public.events e where e.id=p_event_id and e.club_id is not null and e.event_mode='auto' and not e.is_deleted
  and (public.is_super_user() or exists(select 1 from public.club_members cm left join public.player_profiles pp on pp.id=cm.player_profile_id
   where cm.club_id=e.club_id and cm.is_active and (cm.profile_id=auth.uid() or pp.linked_auth_user_id=auth.uid())))
 ),false)
$$;
create function fixed_pair_private.eligible(p_event_id uuid) returns uuid[]
language sql stable security definer set search_path=''
as $$
 select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) from public.event_participants p join public.events e on e.id=p.event_id
 where e.id=p_event_id and p.status='active' and (p.participant_type='guest' or exists(
  select 1 from public.club_members cm join public.player_profiles pp on pp.id=coalesce(cm.player_profile_id,cm.profile_id)
  where cm.club_id=e.club_id and cm.is_active and pp.is_active and pp.id=coalesce(p.player_profile_id,p.profile_id)
 ))
$$;
create function fixed_pair_private.lock_event(p_event_id uuid) returns public.events
language plpgsql security definer set search_path=''
as $$
declare e public.events;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception '固定ペアの変更はREAD COMMITTEDで実行してください'; end if;
 select * into e from public.events where id=p_event_id for update;
 if not found or not fixed_pair_private.can_operate(p_event_id) then raise exception 'このイベントを操作する権限がありません' using errcode='42501'; end if;
 return e;
end $$;
create function fixed_pair_private.state(p_event_id uuid,p_history boolean default false) returns jsonb
language sql stable security definer set search_path=''
as $$
 select jsonb_build_object('event_id',p_event_id,'revision',coalesce((select revision from public.event_fixed_pair_state where event_id=p_event_id),0),
 'used_fixed_pairs',coalesce((select used_fixed_pairs from public.event_fixed_pair_state where event_id=p_event_id),false),
 'pairs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'a',a,'b',b) order by id) from public.event_fixed_pairs where event_id=p_event_id),'[]'::jsonb),
 'eligible_rounds',case when coalesce(p_history,false) then coalesce((select jsonb_agg(jsonb_build_object('round',r.round_number,'eligible',a.eligible_ids,'played',a.played_ids) order by r.round_number)
   from public.event_fixed_pair_rounds a join public.rounds r on r.id=a.round_id and r.event_id=a.event_id where a.event_id=p_event_id),'[]'::jsonb) else '[]'::jsonb end)
$$;
create function public.get_event_fixed_pair_state(p_event_id uuid,p_include_history boolean default false) returns jsonb
language plpgsql stable security definer set search_path=''
as $$ begin
 if not fixed_pair_private.can_operate(p_event_id) then raise exception 'このイベントを閲覧する権限がありません' using errcode='42501'; end if;
 return fixed_pair_private.state(p_event_id,p_include_history);
end $$;

-- 2列をまたぐ同一参加者の重複をDB側でも拒否。イベント行ロックで同時変更を直列化する。
create function fixed_pair_private.guard_pair() returns trigger
language plpgsql set search_path=''
as $$ begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception '固定ペアの変更はREAD COMMITTEDで実行してください'; end if;
 perform 1 from public.events where id=new.event_id for update;
 if exists(select 1 from public.event_fixed_pairs p where p.event_id=new.event_id and p.id<>new.id and (p.a in(new.a,new.b) or p.b in(new.a,new.b))) then
  raise exception '同じ参加者を複数の固定ペアに登録できません' using errcode='23505';
 end if;
 return new;
end $$;
create trigger fixed_pair_overlap before insert or update on public.event_fixed_pairs for each row execute function fixed_pair_private.guard_pair();

create function public.replace_event_fixed_pairs(p_event_id uuid,p_expected_revision bigint,p_pairs jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare e public.events;s public.event_fixed_pair_state;v jsonb;body jsonb;a_id uuid;b_id uuid;pair_id uuid;active_ids uuid[];new_assignment boolean;
begin
 e:=fixed_pair_private.lock_event(p_event_id);
 if e.status<>'active' then raise exception '終了済みイベントの固定設定は変更できません'; end if;
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_pairs) is distinct from 'array' or jsonb_array_length(p_pairs)>10 then raise exception '固定ペアの指定を確認してください'; end if;
 body:=jsonb_build_object('pairs',p_pairs);
 insert into public.event_fixed_pair_state(event_id) values(p_event_id) on conflict do nothing;
 select * into s from public.event_fixed_pair_state where event_id=p_event_id for update;
 if s.last_request_id=p_request_id then
  if s.last_request_body is distinct from body then raise exception '再試行の内容が変更されています'; end if;
  return fixed_pair_private.state(p_event_id);
 end if;
 if s.revision<>p_expected_revision then raise exception '固定設定が別端末で変更されています。最新情報を確認してください' using errcode='40001'; end if;
 perform 1 from public.event_participants where event_id=p_event_id order by id for update;
 active_ids:=fixed_pair_private.eligible(p_event_id);
 for v in select value from jsonb_array_elements(p_pairs) loop
  pair_id:=(v->>'id')::uuid;a_id:=least((v->>'a')::uuid,(v->>'b')::uuid);b_id:=greatest((v->>'a')::uuid,(v->>'b')::uuid);
  if pair_id is null or a_id is null or b_id is null or a_id=b_id then raise exception '固定する2名を確認してください'; end if;
  new_assignment:=not exists(select 1 from public.event_fixed_pairs p where p.event_id=p_event_id and p.id=pair_id and p.a=a_id and p.b=b_id);
  if new_assignment and (cardinality(active_ids)<5 or cardinality(active_ids)>20 or not(a_id=any(active_ids) and b_id=any(active_ids))) then
   raise exception 'ペア固定は5〜20人の生成対象者から、参加中の2名を選択してください';
  end if;
 end loop;
 delete from public.event_fixed_pairs where event_id=p_event_id;
 for v in select value from jsonb_array_elements(p_pairs) loop
  insert into public.event_fixed_pairs(id,event_id,a,b) values((v->>'id')::uuid,p_event_id,least((v->>'a')::uuid,(v->>'b')::uuid),greatest((v->>'a')::uuid,(v->>'b')::uuid));
 end loop;
 update public.event_fixed_pair_state set revision=revision+1,last_request_id=p_request_id,last_request_body=body where event_id=p_event_id;
 return fixed_pair_private.state(p_event_id);
end $$;

create function public.create_fixed_pair_round(p_event_id uuid,p_expected_revision bigint,p_last_round integer,p_court_count integer,p_mode text,p_active_ids uuid[],p_matches jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare e public.events;s public.event_fixed_pair_state;audit public.event_fixed_pair_rounds;body jsonb;eligible uuid[];played uuid[]:='{}';team_ids uuid[];
 v jsonb;pair public.event_fixed_pairs;v_match_id uuid;v_round_id uuid;round_no integer;n integer;courts integer;f integer;singles integer;rest integer;k_min integer;k_max integer;
 applied jsonb:='[]';splits jsonb:='[]';court_ids integer[]:='{}';team text;row_count integer;
begin
 e:=fixed_pair_private.lock_event(p_event_id);
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception '生成リクエストを確認してください'; end if;
 body:=jsonb_build_object('revision',p_expected_revision,'last_round',p_last_round,'courts',p_court_count,'mode',p_mode,'active',p_active_ids,'matches',p_matches);
 select * into audit from public.event_fixed_pair_rounds where event_id=p_event_id and request_id=p_request_id;
 if found then
  if audit.request_body is distinct from body then raise exception '再試行の生成内容が変更されています'; end if;
  if audit.round_id is null then raise exception '生成済みのRoundは削除されています。現在の試合を確認してください'; end if;
  return jsonb_build_object('event_id',p_event_id,'request_id',p_request_id,'round_id',audit.round_id,'round_number',audit.round_number);
 end if;
 if e.status<>'active' or e.court_count is distinct from p_court_count then raise exception '開催状態または面数が変更されています。再読み込みしてください' using errcode='40001'; end if;
 if p_mode is null or p_mode not in('normal','balance','rival') or p_last_round is null or p_last_round<0 then raise exception '生成モード・Roundを確認してください'; end if;
 insert into public.event_fixed_pair_state(event_id) values(p_event_id) on conflict do nothing;
 select * into s from public.event_fixed_pair_state where event_id=p_event_id for update;
 if s.revision<>p_expected_revision then raise exception '固定設定が変更されています。再読み込みしてください' using errcode='40001'; end if;
 select coalesce(max(round_number),0) into round_no from public.rounds where event_id=p_event_id;
 if round_no<>p_last_round then raise exception '別の端末でRoundが生成されています。再読み込みしてください' using errcode='40001'; end if;
 perform 1 from public.event_participants where event_id=p_event_id order by id for update;
 eligible:=fixed_pair_private.eligible(p_event_id);n:=cardinality(eligible);
 if n<4 or n>20 or p_court_count not between 1 and 5 or p_active_ids is null
 or (select array_agg(x order by x) from unnest(p_active_ids) x) is distinct from eligible then raise exception '生成対象者が変更されています。参加状態を確認してください' using errcode='40001'; end if;
 courts:=least(p_court_count,n/4);
 if jsonb_typeof(p_matches) is distinct from 'array' or jsonb_array_length(p_matches)<>courts then raise exception '試合数を確認してください'; end if;
 for v in select value from jsonb_array_elements(p_matches) loop
  if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'teamA') is distinct from 'array' or jsonb_typeof(v->'teamB') is distinct from 'array'
   or jsonb_array_length(v->'teamA')<>2 or jsonb_array_length(v->'teamB')<>2 or exists(select 1 from jsonb_object_keys(v) key where key not in('court','teamA','teamB')) then raise exception '各試合は2名対2名で指定してください'; end if;
  if (v->>'court')::integer not between 1 and courts or (v->>'court')::integer=any(court_ids) then raise exception 'コート番号を確認してください'; end if;
  court_ids:=array_append(court_ids,(v->>'court')::integer);
  select array_agg(x::uuid) into team_ids from jsonb_array_elements_text((v->'teamA')||(v->'teamB')) x;
  played:=played||team_ids;
 end loop;
 if cardinality(played)<>courts*4 or (select count(distinct x) from unnest(played) x)<>courts*4 or not(played<@eligible) then raise exception '同じイベントの参加者を重複なく指定してください'; end if;
 if p_mode<>'normal' then
  select count(*) into row_count from public.matches m where m.event_id=p_event_id and m.completed and
   (select count(*)=4 and count(distinct mp.participant_id)=4 and bool_and(ep.id is not null) and count(*) filter(where mp.team='A')=2 and count(*) filter(where mp.team='B')=2
    from public.match_players mp left join public.event_participants ep on ep.id=mp.participant_id and ep.event_id=m.event_id where mp.match_id=m.id)
   and exists(select 1 from public.match_results mr where mr.match_id=m.id and mr.score_a>=0 and mr.score_b>=0)
   and not exists(select 1 from public.match_results a join public.match_results b on b.match_id=a.match_id where a.match_id=m.id and (a.score_a<0 or a.score_b<0 or a.score_a<>b.score_a or a.score_b<>b.score_b));
  if row_count<10 then raise exception '特別モードは当日のスコア登録済み10試合達成後に利用できます'; end if;
 end if;
 if n>=5 then
  f:=0;
  for pair in select * from public.event_fixed_pairs where event_id=p_event_id loop
   if (pair.a=any(eligible))<>(pair.b=any(eligible)) then raise exception '固定ペアの片方が欠席・休み・生成対象外です'; end if;
   if not(pair.a=any(eligible)) then continue; end if;
   f:=f+1;
   if n<>5 and (pair.a=any(played))<>(pair.b=any(played)) then raise exception '6人以上では固定ペアを2人同時に出場・休憩させてください'; end if;
   if pair.a=any(played) and pair.b=any(played) and not exists(
    select 1 from jsonb_array_elements(p_matches) m where (m->'teamA') @> to_jsonb(array[pair.a,pair.b]) or (m->'teamB') @> to_jsonb(array[pair.a,pair.b])) then raise exception '固定ペアを同じチームにしてください'; end if;
  end loop;
  rest:=n-courts*4;singles:=n-2*f;k_min:=greatest(0,ceil((rest-singles)::numeric/2)::integer);k_max:=least(f,rest/2);
  if n>=6 and rest>0 and (k_min>k_max or f*rest<k_min*n or f*rest>k_max*n) then raise exception 'この固定数・面数ではペア単位の公平な休憩ができません'; end if;
  -- 固定されていないペアに直前ペアの例外を広げない。
  if f>0 then
   for v in select value from jsonb_array_elements(p_matches) loop
    foreach team in array array['teamA','teamB'] loop
     select array_agg(x::uuid order by x::uuid) into team_ids from jsonb_array_elements_text(v->team) x;
     if not exists(select 1 from public.event_fixed_pairs p where p.event_id=p_event_id and p.a=team_ids[1] and p.b=team_ids[2]) and exists(
      select 1 from public.matches m join public.rounds r on r.id=m.round_id join public.match_players a on a.match_id=m.id join public.match_players b on b.match_id=m.id and b.team=a.team
      where m.event_id=p_event_id and r.event_id=p_event_id and r.round_number=p_last_round and a.participant_id=team_ids[1] and b.participant_id=team_ids[2]) then raise exception '未固定選手の連続ペアを避けてください'; end if;
    end loop;
   end loop;
  end if;
 end if;
 insert into public.rounds(event_id,round_number) values(p_event_id,round_no+1) returning id into v_round_id;
 for v in select value from jsonb_array_elements(p_matches) loop
  insert into public.matches(event_id,round_id,court_number,completed) values(p_event_id,v_round_id,(v->>'court')::integer,false) returning id into v_match_id;
  foreach team in array array['teamA','teamB'] loop
   insert into public.match_players(match_id,participant_id,team) select v_match_id,x::uuid,case when team='teamA' then 'A' else 'B' end from jsonb_array_elements_text(v->team) x;
  end loop;
 end loop;
 if n>=5 then
  for pair in select * from public.event_fixed_pairs where event_id=p_event_id and a=any(eligible) and b=any(eligible) loop
   if pair.a=any(played) and pair.b=any(played) then
    select m.id into v_match_id from public.matches m join public.match_players mp on mp.match_id=m.id where m.round_id=v_round_id and mp.participant_id in(pair.a,pair.b) group by m.id,mp.team having count(distinct mp.participant_id)=2;
    applied:=applied||jsonb_build_array(jsonb_build_object('id',pair.id,'a',pair.a,'b',pair.b,'match_id',v_match_id));
   elsif (pair.a=any(played))<>(pair.b=any(played)) then splits:=splits||jsonb_build_array(jsonb_build_object('id',pair.id,'a',pair.a,'b',pair.b));
   end if;
  end loop;
 end if;
 insert into public.event_fixed_pair_rounds(event_id,request_id,request_body,round_id,round_number,eligible_ids,played_ids,applied_pairs,split_pairs,created_by)
 values(p_event_id,p_request_id,body,v_round_id,round_no+1,eligible,played,applied,splits,auth.uid());
 update public.event_fixed_pair_state set revision=revision+1,used_fixed_pairs=used_fixed_pairs or jsonb_array_length(applied)>0 where event_id=p_event_id;
 if not s.used_fixed_pairs and jsonb_array_length(applied)>0 then update public.events set stats_mode='undecided' where id=p_event_id; end if;
 return jsonb_build_object('event_id',p_event_id,'request_id',p_request_id,'round_id',v_round_id,'round_number',round_no+1);
end $$;

create function public.finish_fixed_pair_event(p_event_id uuid,p_expected_revision bigint,p_close boolean,p_stats_mode text default null) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare e public.events;s public.event_fixed_pair_state;chosen text;
begin
 e:=fixed_pair_private.lock_event(p_event_id);
 insert into public.event_fixed_pair_state(event_id) values(p_event_id) on conflict do nothing;
 select * into s from public.event_fixed_pair_state where event_id=p_event_id for update;
 if p_close is null then raise exception '終了・再開を指定してください'; end if;
 if p_close then
  if s.used_fixed_pairs and (p_stats_mode is null or p_stats_mode not in('official','record_only')) then raise exception 'イベント内だけに保存するか、通算へ反映するかを選択してください'; end if;
  chosen:=case when s.used_fixed_pairs then p_stats_mode else 'official' end;
  if e.status='closed' then
   if e.stats_mode<>chosen then raise exception '再開してから反映方法を選び直してください'; end if;
   return jsonb_build_object('event_id',p_event_id,'status','closed','stats_mode',chosen);
  end if;
 else
  chosen:=case when s.used_fixed_pairs then 'undecided' else 'official' end;
  if e.status='active' then return jsonb_build_object('event_id',p_event_id,'status','active','stats_mode',e.stats_mode); end if;
 end if;
 if p_expected_revision is null or s.revision<>p_expected_revision then raise exception '固定設定・生成状態が変更されています。再読み込みしてください' using errcode='40001'; end if;
 update public.events set status=case when p_close then 'closed' else 'active' end,stats_mode=chosen,closed_at=case when p_close then now() else closed_at end where id=p_event_id;
 update public.event_fixed_pair_state set revision=revision+1 where event_id=p_event_id;
 return jsonb_build_object('event_id',p_event_id,'status',case when p_close then 'closed' else 'active' end,'stats_mode',chosen);
end $$;

-- 旧クライアントや直接DMLで固定条件・利用履歴を迂回しない。スコア・動画・既存の削除は対象外。
create function fixed_pair_private.guard_legacy_write() returns trigger
language plpgsql set search_path=''
as $$
declare v_event_id uuid;protected boolean;
begin
 if current_user not in('anon','authenticated') then return new; end if;
 if TG_TABLE_NAME='events' then
  if new.is_deleted then return new; end if;
  if (new.status is distinct from old.status or new.stats_mode is distinct from old.stats_mode) and exists(select 1 from public.event_fixed_pair_state where event_fixed_pair_state.event_id=old.id and used_fixed_pairs) then
   raise exception '固定ペア利用済みイベントは専用の終了・再開操作を使用してください' using errcode='42501';
  end if;
  return new;
 end if;
 if TG_TABLE_NAME='match_players' then select m.event_id into v_event_id from public.matches m where m.id=new.match_id;
 else v_event_id:=new.event_id; end if;
 perform 1 from public.events where id=v_event_id for update;
 select exists(select 1 from public.event_fixed_pairs p where p.event_id=v_event_id) or exists(select 1 from public.event_fixed_pair_state s where s.event_id=v_event_id and s.used_fixed_pairs) into protected;
 if protected then raise exception '固定ペアのあるRoundは専用の生成処理を使用してください' using errcode='42501'; end if;
 return new;
end $$;
create trigger fixed_pair_event_finish before update of status,stats_mode on public.events for each row execute function fixed_pair_private.guard_legacy_write();
create trigger fixed_pair_round_create before insert on public.rounds for each row execute function fixed_pair_private.guard_legacy_write();
create trigger fixed_pair_match_create before insert on public.matches for each row execute function fixed_pair_private.guard_legacy_write();
create trigger fixed_pair_lineup before insert or update of team on public.match_players for each row execute function fixed_pair_private.guard_legacy_write();

revoke all on all functions in schema fixed_pair_private from public,anon,authenticated,service_role;
grant usage on schema fixed_pair_private to authenticated;
grant execute on function fixed_pair_private.can_operate(uuid) to authenticated;
revoke all on function public.get_event_fixed_pair_state(uuid,boolean),public.replace_event_fixed_pairs(uuid,bigint,jsonb,uuid),public.create_fixed_pair_round(uuid,bigint,integer,integer,text,uuid[],jsonb,uuid),public.finish_fixed_pair_event(uuid,bigint,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.get_event_fixed_pair_state(uuid,boolean),public.replace_event_fixed_pairs(uuid,bigint,jsonb,uuid),public.create_fixed_pair_round(uuid,bigint,integer,integer,text,uuid[],jsonb,uuid),public.finish_fixed_pair_event(uuid,bigint,boolean,text) to authenticated;
grant select on public.event_fixed_pair_state,public.event_fixed_pairs,public.event_fixed_pair_rounds to authenticated;
create policy fixed_pair_state_read on public.event_fixed_pair_state for select to authenticated using(fixed_pair_private.can_operate(event_id));
create policy fixed_pair_read on public.event_fixed_pairs for select to authenticated using(fixed_pair_private.can_operate(event_id));
create policy fixed_pair_round_read on public.event_fixed_pair_rounds for select to authenticated using(fixed_pair_private.can_operate(event_id));

do $guard$
declare r record;current_value jsonb;
begin
 for r in select * from fixed_pair_before loop
  if r.kind='policy' then select to_jsonb(p) into current_value from pg_policies p where schemaname='public' and p.tablename||'.'||p.policyname=r.key;
  elsif r.kind='acl' then select jsonb_build_object('table',c.relacl,'columns',(select jsonb_agg(jsonb_build_array(a.attname,a.attacl) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) into current_value from pg_class c where c.oid=to_regclass('public.'||r.key);
  else select jsonb_build_object('definition',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid),'enabled',t.tgenabled) into current_value from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relname||'.'||t.tgname=r.key;
  end if;
  if current_value is distinct from r.value then raise exception '既存のRLS・権限・保護トリガーが変化しました。全体を中止します'; end if;
 end loop;
end $guard$;
commit;
