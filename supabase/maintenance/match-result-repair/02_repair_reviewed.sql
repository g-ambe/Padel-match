-- 承認前の本番実行禁止。実行器は承認済みの非公開プランを注入する。未設定なら全体停止。
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.events,public.matches,public.match_players,public.event_participants,public.match_results in share row exclusive mode;
create temporary table score_repair_approval(batch_id uuid,plan jsonb,sha256 text,approved boolean) on commit drop;
-- REVIEWED_INPUT
create schema if not exists score_repair_182;
revoke all on schema score_repair_182 from public,anon,authenticated,service_role;
create table if not exists score_repair_182.batches(
 id uuid primary key,plan_sha256 text not null,plan jsonb not null,columns_before jsonb not null,
 before_sha256 text not null,after_sha256 text,removed_rows integer,applied_by text not null,applied_at timestamptz not null default now(),restored_at timestamptz
);
create table if not exists score_repair_182.rows(
 batch_id uuid not null references score_repair_182.batches(id) on delete restrict,id uuid not null,keeper_id uuid not null,row_data jsonb not null,primary key(batch_id,id)
);
revoke all on all tables in schema score_repair_182 from public,anon,authenticated,service_role;
do $repair$
declare a record; actual jsonb;before_digest text;after_digest text;before_logical text;after_logical text;column_schema jsonb;n integer;expected integer;prior score_repair_182.batches;t record;referenced boolean;remove_ids uuid[];
begin
 if current_user in('anon','authenticated','service_role') then raise exception '管理用接続が必要です';end if;
 if (select count(*) from score_repair_approval)<>1 then raise exception '承認済みプランが未設定です';end if;
 select * into a from score_repair_approval;
 if a.approved is not true or a.batch_id is null or jsonb_typeof(a.plan) is distinct from 'array' or jsonb_array_length(a.plan)=0 or a.sha256 is distinct from encode(sha256(convert_to(a.plan::text,'UTF8')),'hex') then raise exception '承認済みプランの識別情報が一致しません';end if;
 if exists(select 1 from pg_constraint where contype='f' and confrelid='public.match_results'::regclass) then raise exception '結果IDへの外部キーを確認してください。参照がある構成では自動削除しません';end if;
 select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),''),'UTF8')),'hex') into before_digest from public.match_results r;
 select * into prior from score_repair_182.batches where id=a.batch_id;
 if found then
  if prior.id<>a.batch_id or prior.plan is distinct from a.plan or prior.restored_at is not null or prior.after_sha256 is distinct from before_digest then raise exception '既存バッチまたは修復後の状態が一致しません。再実行しません';end if;
  return;
 end if;
 if exists(select 1 from public.match_results where match_id is not null group by match_id having count(*)>1 and count(distinct jsonb_build_array(score_a,score_b,winner_team))<>1) then raise exception '結果が食い違う試合があります。自動整理しません';end if;
 with ranked as(select r.id,first_value(r.id) over(partition by r.match_id order by r.created_at asc nulls last,r.id) keeper_id,count(*) over(partition by r.match_id) n from public.match_results r where r.match_id is not null)
 select coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(r),'keeper_id',x.keeper_id,'match',to_jsonb(m),'event',to_jsonb(e)) order by r.id),'[]') into actual
 from ranked x join public.match_results r on r.id=x.id join public.matches m on m.id=r.match_id join public.events e on e.id=m.event_id where x.n>1;
 if actual is distinct from a.plan then raise exception '修復対象・結果・開催状態が事前プランから変化しています。全体を停止します';end if;
 select count(*) into expected from jsonb_array_elements(a.plan) p where p->'row'->>'id'<>p->>'keeper_id';
 if expected<1 then raise exception '削除対象がありません';end if;
 select array_agg((p->'row'->>'id')::uuid) into remove_ids from jsonb_array_elements(a.plan) p where p->'row'->>'id'<>p->>'keeper_id';
 -- FKのないUUID・JSON・文字列参照も確認。公表ログに行データを出さない。
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p') and c.relname<>'match_results' order by c.relname loop
  execute format('lock table %I.%I in share row exclusive mode',t.nspname,t.relname);
  execute format('select exists(select 1 from %I.%I z where exists(select 1 from unnest($1::uuid[]) u where strpos(to_jsonb(z)::text,u::text)>0))',t.nspname,t.relname) into referenced using remove_ids;
  if referenced then raise exception '削除対象IDへのアプリ内参照が残っています。自動変更しません';end if;
 end loop;

 select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum) into column_schema from pg_attribute where attrelid='public.match_results'::regclass and attnum>0 and not attisdropped;
 select encode(sha256(convert_to(coalesce(string_agg(x::text,'' order by x::text),''),'UTF8')),'hex') into before_logical from(select distinct jsonb_build_array(match_id,score_a,score_b,winner_team) x from public.match_results) q;
 insert into score_repair_182.batches(id,plan_sha256,plan,columns_before,before_sha256,applied_by) values(a.batch_id,a.sha256,a.plan,column_schema,before_digest,current_user);
 insert into score_repair_182.rows select a.batch_id,(p->'row'->>'id')::uuid,(p->>'keeper_id')::uuid,p->'row' from jsonb_array_elements(a.plan) p;
 delete from public.match_results r using score_repair_182.rows s where s.batch_id=a.batch_id and s.id<>s.keeper_id and r.id=s.id and to_jsonb(r)=s.row_data;
 get diagnostics n=row_count;if n<>expected then raise exception '削除件数が承認対象と一致しません';end if;
 if exists(select 1 from public.match_results where match_id is not null group by match_id having count(*)>1) then raise exception '重複が残っています';end if;
 if exists(select 1 from score_repair_182.rows s left join public.match_results r on r.id=s.id where s.batch_id=a.batch_id and s.id=s.keeper_id and to_jsonb(r) is distinct from s.row_data) then raise exception '正本の行が変更されています';end if;
 select encode(sha256(convert_to(coalesce(string_agg(x::text,'' order by x::text),''),'UTF8')),'hex') into after_logical from(select distinct jsonb_build_array(match_id,score_a,score_b,winner_team) x from public.match_results) q;
 if after_logical is distinct from before_logical then raise exception '試合ごとの結果が変化しました';end if;
 select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),''),'UTF8')),'hex') into after_digest from public.match_results r;
 update score_repair_182.batches set after_sha256=after_digest,removed_rows=n where id=a.batch_id;
end $repair$;
commit;
