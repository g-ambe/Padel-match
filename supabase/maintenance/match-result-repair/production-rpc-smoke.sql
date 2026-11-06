-- 新規の専用データだけを使用。成功・失敗とも全体をROLLBACKし、実試合は参照しない。
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
set local role postgres;
do $test$
declare uid uuid:=gen_random_uuid(); gid uuid:=gen_random_uuid(); eid uuid; club uuid; rid uuid; mid uuid;
 people uuid[]; a uuid; z uuid; req uuid; result_id uuid; s jsonb; old_s jsonb; c jsonb; body jsonb; v jsonb; fixed jsonb;
 outcome jsonb; repeated jsonb; cards jsonb; enabled boolean; blocked boolean; n integer; j integer; k integer; round_no integer;
begin
 select editing_enabled into enabled from lineup_private.release_control;
 insert into public.profiles(id,display_name) values(uid,'リリース検証専用');
 insert into public.clubs(id,name,owner_id,visibility) values(gid,'リリース検証専用',uid,'private');
 insert into public.club_members(club_id,profile_id,role,is_active,status) values(gid,uid,'main_admin',true,'active');
 foreach club in array array[gid,null::uuid] loop
  eid:=gen_random_uuid();people:='{}';
  insert into public.events(id,club_id,name,category,court_count,event_mode,stats_mode,status,created_by_auth_user_id)
   values(eid,club,'リリース検証専用','club',2,'auto','record_only','active',uid);
  for j in 1..9 loop a:=gen_random_uuid();people:=array_append(people,a);
   insert into public.event_participants(id,event_id,guest_name,status,participant_type) values(a,eid,'検証選手'||j,'active','guest');
  end loop;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  execute 'SET LOCAL ROLE authenticated';
  v:=public.get_friendly_lineup_versions(eid);
  if club is not null then fixed:=public.get_event_fixed_pair_state(eid,true);else fixed:='{"revision":0}'::jsonb;end if;
  body:=jsonb_build_object('eventId',eid,'lineupRevision',v->'event_revision','revision',fixed->'revision','lastRound',0,'courtCount',2,'mode','normal','activeIds',to_jsonb(people),'requestId',gen_random_uuid(),
   'matches',jsonb_build_array(jsonb_build_object('court',1,'teamA',to_jsonb(people[1:2]),'teamB',to_jsonb(people[3:4])),jsonb_build_object('court',2,'teamA',to_jsonb(people[5:6]),'teamB',to_jsonb(people[7:8]))));
  outcome:=public.create_friendly_round(body);rid:=(outcome->>'round_id')::uuid;
  assert public.create_friendly_round(body)=outcome,'生成再送が非冪等';
  s:=public.get_friendly_round_lineup(eid,rid);assert jsonb_array_length(s->'cards')=2,'生成カード不足';
  if enabled then
   -- 同コート、別コート、休憩選手の3種類を、期待値付きで確定する。
   for k in 1..3 loop
    s:=public.get_friendly_round_lineup(eid,rid);old_s:=s;
    a:=(s#>>'{cards,0,players,0,participant_id}')::uuid;
    z:=case k when 1 then (s#>>'{cards,0,players,2,participant_id}')::uuid when 2 then (s#>>'{cards,1,players,0,participant_id}')::uuid else people[9] end;
    select jsonb_agg(jsonb_build_object('id',card->'id','players',(select jsonb_agg(jsonb_build_object('participant_id',case (p->>'participant_id')::uuid when a then z when z then a else (p->>'participant_id')::uuid end,'team',p->'team')) from jsonb_array_elements(card->'players')p))) into cards from jsonb_array_elements(s->'cards')card;
    req:=gen_random_uuid();outcome:=public.replace_friendly_round_lineup(eid,rid,s,cards,req);
    assert public.replace_friendly_round_lineup(eid,rid,s,cards,req)=outcome,'入替再送が非冪等';
    blocked:=false;
    begin
     c:=old_s#>'{cards,0}';perform public.save_friendly_match_score(eid,(c->>'id')::uuid,(old_s->>'revision')::bigint,c->'players',jsonb_build_object('completed',c->'completed','results',c->'result'),0,0,gen_random_uuid());
    exception when serialization_failure then blocked:=true;end;
    assert blocked,'旧構成スコアを拒否できない';
   end loop;
  else
   blocked:=false;
   begin perform public.replace_friendly_round_lineup(eid,rid,s,'[]'::jsonb,gen_random_uuid());exception when raise_exception or insufficient_privilege then blocked:=true;end;
   assert blocked,'停止中に入替を許可';
  end if;
  s:=public.get_friendly_round_lineup(eid,rid);c:=s#>'{cards,0}';mid:=(c->>'id')::uuid;req:=gen_random_uuid();
  outcome:=public.save_friendly_match_score(eid,mid,(s->>'revision')::bigint,c->'players',jsonb_build_object('completed',c->'completed','results',c->'result'),0,0,req);
  assert public.save_friendly_match_score(eid,mid,(s->>'revision')::bigint,c->'players',jsonb_build_object('completed',c->'completed','results',c->'result'),0,0,req)=outcome,'スコア再送が非冪等';
  assert outcome#>>'{result,winner_team}'='draw','0対0引分が不正';result_id:=(outcome#>>'{result,id}')::uuid;
  s:=public.get_friendly_round_lineup(eid,rid);c:=s#>'{cards,0}';
  outcome:=public.save_friendly_match_score(eid,mid,(s->>'revision')::bigint,c->'players',jsonb_build_object('completed',c->'completed','results',c->'result'),4,0,gen_random_uuid());
  assert outcome#>>'{result,winner_team}'='A' and (outcome#>>'{result,id}')::uuid=result_id,'修正で正本IDまたは勝敗が不正';
  select count(*) into n from public.match_results where match_id=mid;assert n=1,'スコア重複';
  v:=public.get_friendly_lineup_versions(eid);
  if club is not null then fixed:=public.get_event_fixed_pair_state(eid,true);else fixed:='{"revision":0}'::jsonb;end if;
  body:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(body,'{lastRound}','1'),'{requestId}',to_jsonb(gen_random_uuid())),'{lineupRevision}',v->'event_revision'),'{revision}',fixed->'revision');
  outcome:=public.create_friendly_round(body);assert (outcome->>'round_number')::int=2,'次Round生成不正';
  if club is not null then
   fixed:=public.get_event_fixed_pair_state(eid,true);outcome:=public.finish_fixed_pair_event(eid,(fixed->>'revision')::bigint,true,null);assert outcome->>'status'='closed','終了不正';
   fixed:=public.get_event_fixed_pair_state(eid,true);outcome:=public.finish_fixed_pair_event(eid,(fixed->>'revision')::bigint,false,null);assert outcome->>'status'='active','再開不正';
  else
   update public.events set status='closed' where id=eid;update public.events set status='active' where id=eid;
  end if;
  execute 'SET LOCAL ROLE postgres';
 end loop;
end $test$;
rollback;
select jsonb_build_object('dedicated_events_rolled_back',true,'group_and_solo',true,'score_create_edit_retry_draw',true,'round_create_retry_next',true,'finish_reopen',true,'editing_enabled',(select editing_enabled from lineup_private.release_control));
