"""隔離したPostgreSQL 17の複数接続試験。ネットワーク・本番DB接続を使用しない。"""
import subprocess as sp
import time
import uuid
from pathlib import Path

name='team-attendance-test-'+uuid.uuid4().hex[:10]
u=lambda n: '90000000-0000-4000-8000-'+str(n).zfill(12)
cmd=['docker','exec','-i',name,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-At']
def sql(text,ok=True):
 r=sp.run(cmd,input=text,text=True,capture_output=True,timeout=20)
 if ok and r.returncode:raise RuntimeError(r.stderr)
 return r
actor=f"SET request.jwt.claim.sub='{u(1)}';SET ROLE authenticated;"
try:
 sp.run(['docker','run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'],check=True,capture_output=True)
 for _ in range(100):
  logs=sp.run(['docker','logs',name],capture_output=True,text=True)
  initialized='PostgreSQL init process complete' in logs.stdout+logs.stderr
  if initialized and sp.run(['docker','exec',name,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('隔離PostgreSQLが起動しませんでした')
 sql("""
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
 CREATE TABLE events(id uuid primary key,event_mode text,status text,is_deleted boolean,created_by_auth_user_id uuid);
 CREATE TABLE player_profiles(id uuid primary key,is_active boolean);
 CREATE TABLE club_members(id uuid primary key,club_id uuid,player_profile_id uuid,profile_id uuid,is_active boolean);
 CREATE TABLE event_team_sides(id uuid primary key,event_id uuid,side text,club_id uuid,team_name text);
 CREATE TABLE event_team_guests(id uuid primary key,event_id uuid,side text,guest_name text);
 CREATE TABLE event_team_matches(id uuid primary key,event_id uuid,
 team_a_player1_profile_id uuid,team_a_player2_profile_id uuid,team_b_player1_profile_id uuid,team_b_player2_profile_id uuid,
 team_a_player1_guest_name text,team_a_player2_guest_name text,team_b_player1_guest_name text,team_b_player2_guest_name text,
 team_a_score int,team_b_score int,result text,score_detail text,memo text,youtube_url text,updated_at timestamptz);
 CREATE FUNCTION can_manage_friendly_team_event_by_sides(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT auth.uid()=$2$$;
 CREATE FUNCTION can_view_friendly_team_event_by_sides(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT auth.uid()=$2$$;
 GRANT SELECT,UPDATE ON events TO authenticated;
 GRANT SELECT ON club_members,player_profiles,event_team_sides,event_team_guests TO authenticated;
 GRANT SELECT,INSERT,UPDATE ON event_team_matches TO authenticated;
 """)
 sql(Path('supabase/migrations/0044_friendly_team_attendance.sql').read_text())
 sql(f"INSERT INTO events VALUES('{u(10)}','team','active',false,'{u(1)}');INSERT INTO player_profiles VALUES('{u(20)}',true);INSERT INTO club_members VALUES('{u(30)}','{u(40)}','{u(20)}',null,true);INSERT INTO event_team_sides VALUES('{u(50)}','{u(10)}','team_a','{u(40)}','A');")
 absent=f"SELECT set_friendly_team_attendance('{u(10)}','team_a','{u(30)}',null,'absent');"
 insert=f"INSERT INTO event_team_matches(id,event_id,team_a_player1_profile_id,result) VALUES('{u(60)}','{u(10)}','{u(20)}','undecided');"
 def race(first,second,expected):
  process=sp.Popen(cmd,stdin=sp.PIPE,stdout=sp.PIPE,stderr=sp.PIPE,text=True)
  process.stdin.write(actor+'BEGIN;'+first+'SELECT pg_sleep(2);COMMIT;');process.stdin.close()
  for _ in range(100):
   count=sql("SELECT count(*) FROM pg_locks WHERE relation='public.events'::regclass AND mode='RowShareLock' AND granted").stdout.strip()
   if int(count or 0)>0:break
   time.sleep(.03)
  else:raise AssertionError('先行接続のロックを確認できない')
  result=sql(actor+second,False)
  process.wait(timeout=15)
  assert process.returncode==0,process.stderr.read()
  assert result.returncode!=0 and expected in result.stderr,result.stderr
 race(absent,insert,'欠席者')
 assert sql('SELECT count(*) FROM event_team_matches').stdout.strip()=='0'
 sql('TRUNCATE event_team_attendance')
 race(insert,absent,'未完了カード')
 assert sql('SELECT count(*) FROM event_team_attendance').stdout.strip()=='0'
 assert sql('SELECT count(*) FROM event_team_matches').stdout.strip()=='1'
 # 出欠の検証中に、プロフィール統合の所属参照更新が割り込まない。
 sql(f"INSERT INTO player_profiles VALUES('{u(21)}',true)")
 first=sp.Popen(cmd,stdin=sp.PIPE,stdout=sp.PIPE,stderr=sp.PIPE,text=True)
 first.stdin.write(actor+f"BEGIN;SELECT set_friendly_team_attendance('{u(10)}','team_a','{u(30)}',null,'active');SELECT pg_sleep(3);COMMIT;");first.stdin.close()
 for _ in range(100):
  if sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep'").stdout.strip()=='1':break
  time.sleep(.02)
 else:raise AssertionError('出欠RPCの検証ロックを確認できない')
 second=sp.Popen(cmd,stdin=sp.PIPE,stdout=sp.PIPE,stderr=sp.PIPE,text=True)
 second.stdin.write(f"SET application_name='attendance-profile-merge-test';UPDATE club_members SET player_profile_id='{u(21)}' WHERE id='{u(30)}';");second.stdin.close()
 for _ in range(100):
  if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='attendance-profile-merge-test' AND cardinality(pg_blocking_pids(pid))>0").stdout.strip()=='1':break
  time.sleep(.02)
 else:raise AssertionError('所属の参照更新がRPC終了まで待機しなかった')
 first.wait(timeout=15);second.wait(timeout=15)
 assert first.returncode==0 and second.returncode==0,'プロフィール参照の直列化に失敗'
 assert sql(f"SELECT player_profile_id='{u(21)}' FROM club_members WHERE id='{u(30)}'").stdout.strip()=='t'
 print('PostgreSQL 17：出欠→編成／編成→出欠の両実行順で競合を拒否し、失敗側の全体ロールバックを確認')
 print('PostgreSQL 17：出欠検証の所属ロックがプロフィール参照更新を直列化することを確認')
finally:
 sp.run(['docker','rm','-f',name],capture_output=True)
