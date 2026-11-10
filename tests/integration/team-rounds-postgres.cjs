// PostgreSQL 17・外向きネットワークなし・合成データのみ。既存環境・本番URLを使用しない。
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {Client,types}=require(process.env.TEAM_ROUND_PG_DRIVER||'pg');
// PostgREST同様にマイクロ秒を保持する（JS Dateへ変換すると期待値が丸められる）。
types.setTypeParser(1184,value=>value);
const {fixedPairDatabase,id}=require('../fixtures/fixed-pair-db.cjs');
require('../fixtures/friendly-round-helpers.cjs');
require('node:module').registerHooks({resolve(specifier,context,next){return next(specifier==='./friendly-team-rounds'?specifier+'.ts':specifier,context);}});
const {friendlyTeamStats}=require('../../lib/friendly-team-results.ts');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'padel-team-round-pg-')),socket=path.join(dir,'socket'),name='padel-team-round-'+crypto.randomUUID().slice(0,8);
fs.mkdirSync(socket,{mode:0o777});fs.chmodSync(socket,0o777);
const dockerEnv={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
const run=(args,input)=>cp.execFileSync('docker',['--host=unix:///var/run/docker.sock',...args],{env:dockerEnv,input,stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let owner,a,b,monitor,restore,raceCount=0,eventNumber=1200;
const migration=fs.readFileSync('supabase/migrations/0045_friendly_team_random_rounds.sql','utf8');
async function client(database='team_round_test',application_name='team-round-test'){const c=new Client({host:socket,user:'postgres',database,application_name});c.on('error',()=>{});await c.connect();return c;}
const rpc=(c,name,args)=>c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args).then(r=>r.rows[0].result);
const auth=async(c,n=1)=>{await c.query('reset role');await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id(n),JSON.stringify({sub:id(n),email:`user${n}@example.invalid`})]);await c.query('set role authenticated');};
(async()=>{
 try{
  run(['run','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','--mount',`type=bind,src=${socket},dst=/var/run/postgresql`,'postgres:17-alpine','-c','listen_addresses=']);
  for(let i=0;i<150;i++){try{if(!run(['logs',name]).toString().includes('PostgreSQL init process complete')){await delay(100);continue;}owner=await client('postgres');break;}catch{await delay(100);}}if(!owner){console.error(run(['logs',name]).toString().slice(-1500));throw new Error('隔離PostgreSQLの起動失敗');}
  await owner.query('create database team_round_test');await owner.end();owner=await client();
  const adapter={exec:s=>owner.query(s),query:(s,args)=>owner.query(s,args)};
  const f=await fixedPairDatabase(true,adapter);for(const file of ['0041_atomic_round_lineups.sql','0042_round_lineup_safety.sql','0043_match_results_one_per_match.sql'])await owner.query(fs.readFileSync('supabase/migrations/'+file,'utf8'));await owner.query(fs.readFileSync('supabase/migrations/0044_friendly_team_attendance.sql','utf8'));
  const normal=await f.event(1198,4);const normalRound=(await owner.query('insert into rounds(event_id,round_number) values($1,1) returning id',[normal.eid])).rows[0].id;const normalMatch=(await owner.query('insert into matches(event_id,round_id,court_number,completed) values($1,$2,1,true) returning id',[normal.eid,normalRound])).rows[0].id;for(const [i,participant]of normal.participants.entries())await owner.query('insert into match_players(match_id,participant_id,team) values($1,$2,$3)',[normalMatch,participant,i<2?'A':'B']);await owner.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,4,2,'A')",[normalMatch]);
  const legacy=await f.event(1199,0,{mode:'team'});await owner.query("insert into event_team_matches(event_id,match_order,team_a_score,team_b_score,result,memo) values($1,1,4,2,'win','既存データ維持')",[legacy.eid]);
  const oldData=JSON.stringify((await owner.query('select * from event_team_matches order by id')).rows);
  const acl=async c=>JSON.stringify((await c.query("select relname,relrowsecurity,relforcerowsecurity,relacl::text from pg_class where relname in ('events','event_team_matches','event_team_sides','event_team_guests','event_team_attendance') order by relname")).rows);
  const policies=async c=>JSON.stringify((await c.query("select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename<>'event_team_rounds' order by tablename,policyname")).rows);
  const legacyTables=['events','event_participants','rounds','matches','match_players','match_results','profiles','player_profiles','club_members','clubs','official_events','official_matches','event_team_matches','event_team_sides','event_team_guests','event_team_attendance'];
  const newColumns=['pair_1_score','pair_2_score','pair_result','round_id','round_number','court_number','generation_mode',...['team_a_player1','team_a_player2','team_b_player1','team_b_player2'].flatMap(p=>[p+'_source_side',p+'_guest_id'])];
  const snapshots=async c=>JSON.stringify((await c.query(legacyTables.map(table=>`select '${table}' name,md5(coalesce((select jsonb_agg(to_jsonb(r)${table==='event_team_matches'?'-ARRAY['+newColumns.map(v=>"'"+v+"'").join(',')+']':''} order by id) from public.${table} r),'[]'::jsonb)::text) checksum`).join(' union all '))).rows);
  const beforeData=await snapshots(owner),beforeAcl=await acl(owner),beforePolicies=await policies(owner);
  // 実ファイルから別DBへ復元する。ファイルはGit外・合成データ・0600。
  const backup=run(['exec',name,'pg_dump','-h','/var/run/postgresql','-U','postgres','-Fc','team_round_test']),backupFile=path.join(dir,'backup.dump');fs.writeFileSync(backupFile,backup,{mode:0o600});
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex'),crypto.createHash('sha256').update(backup).digest('hex'));
  await owner.query('create database team_round_restore');run(['exec','-i',name,'pg_restore','-h','/var/run/postgresql','-U','postgres','--exit-on-error','-d','team_round_restore'],fs.readFileSync(backupFile));restore=await client('team_round_restore');
  assert.equal(JSON.stringify((await restore.query('select * from event_team_matches order by id')).rows),oldData);assert.equal(await snapshots(restore),beforeData);assert.equal(await acl(restore),beforeAcl);assert.equal(await policies(restore),beforePolicies);
  await restore.query(migration);await restore.query(fs.readFileSync('supabase/maintenance/team-rounds/04_rollback_empty.sql','utf8').replace(/ROLLBACK;/g,'COMMIT;'));
  assert.equal(JSON.stringify((await restore.query('select * from event_team_matches order by id')).rows),oldData);assert.equal(await snapshots(restore),beforeData);assert.equal(await acl(restore),beforeAcl);assert.equal(await policies(restore),beforePolicies);await restore.query(migration);
  await owner.query(migration);assert.equal(await snapshots(owner),beforeData);assert.equal(await acl(owner),beforeAcl);assert.equal(await policies(owner),beforePolicies);await owner.query('select profile_link_private.check_reference_schema()');
  console.log('PostgreSQL17：バックアップ実ファイル→別DB復元、0045適用→空データ切戻し→再適用、既存データ・RLS・ACL維持 PASS');
  a=await client('team_round_test','team-round-a');b=await client('team_round_test','team-round-b');monitor=await client('team_round_test','team-round-monitor');await auth(a);await auth(b);
  async function setup(){await owner.query('reset role');const {eid}=await f.event(eventNumber++,0,{mode:'team',courts:2});await owner.query("insert into event_team_sides(event_id,side,club_id,team_name) values($1,'team_a',$2,'A'),($1,'team_b',$3,'B')",[eid,id(600),id(601)]);for(const side of ['team_a','team_b'])for(let n=0;n<5;n++)await owner.query('insert into event_team_guests(event_id,side,guest_name) values($1,$2,$3)',[eid,side,'ゲスト'+n]);const ctx=await rpc(a,'get_friendly_team_round_context',[eid]),aa=ctx.roster.filter(p=>p.source==='team_a'&&p.guest_id),bb=ctx.roster.filter(p=>p.source==='team_b'&&p.guest_id);return{eid,ctx,aa,bb,cards:[0,1].map(i=>({court:i+1,pairs:[[aa[i*2],bb[i*2]],[aa[i*2+1],bb[i*2+1]]]}))};}
  const args=(s,req=crypto.randomUUID())=>[s.eid,req,s.ctx.revision,'mixed',2,JSON.stringify(s.cards)];
  async function race(first,second,pattern){await a.query('begin');await first(a);let finished=false;const pending=second(b).then(value=>({value}),error=>({error})).finally(()=>finished=true);let blocked=false;for(let i=0;i<150&&!finished;i++){if((await monitor.query("select cardinality(pg_blocking_pids(pid))>0 blocked from pg_stat_activity where application_name='team-round-b'")).rows[0]?.blocked){blocked=true;break;}await delay(10);}assert(blocked,'後続接続が開催ロックを待たなかった');await a.query('commit');const outcome=await pending;if(pattern)assert(outcome.error&&pattern.test(outcome.error.message),outcome.error?.message||'安全停止されなかった');else assert(!outcome.error,outcome.error?.message);raceCount++;return outcome.value;}
  let s=await setup(),params=args(s);await race(c=>rpc(c,'create_friendly_team_round',params),c=>rpc(c,'create_friendly_team_round',args(s)),/更新/);
  assert.equal((await owner.query('select count(*)::int n from event_team_matches where event_id=$1',[s.eid])).rows[0].n,2);
  s=await setup();params=args(s);const same=await race(c=>rpc(c,'create_friendly_team_round',params),c=>rpc(c,'create_friendly_team_round',params));assert(same.round_id);assert.deepEqual(await rpc(a,'create_friendly_team_round',params),same);
  s=await setup();await race(c=>rpc(c,'set_friendly_team_attendance',[s.eid,'team_b',null,s.bb[0].guest_id,'absent']),c=>rpc(c,'create_friendly_team_round',args(s)),/更新/);
  s=await setup();await race(c=>rpc(c,'create_friendly_team_round',args(s)),c=>rpc(c,'set_friendly_team_attendance',[s.eid,'team_b',null,s.bb[0].guest_id,'absent']),/未完了/);
  const manual=(c,s)=>c.query("insert into event_team_matches(event_id,match_order,team_a_player1_guest_name,result) values($1,9,$2,'undecided')",[s.eid,s.aa[0].name]);
  s=await setup();await race(c=>manual(c,s),c=>rpc(c,'create_friendly_team_round',args(s)),/更新|未完了/);
  s=await setup();await race(c=>rpc(c,'create_friendly_team_round',args(s)),c=>manual(c,s),/未完了ラウンド/);
  for(const editFirst of [true,false]){
   s=await setup();await rpc(a,'create_friendly_team_round',args(s));const m=(await owner.query('select * from event_team_matches where event_id=$1 order by court_number',[s.eid])).rows[0];
   const edit=c=>rpc(c,'update_friendly_team_round_card',[s.eid,m.id,JSON.stringify(m),JSON.stringify({team_a_player1_guest_id:s.aa[4].guest_id,team_a_player1_guest_name:s.aa[4].name})]);
   const score=c=>rpc(c,'update_friendly_team_round_card',[s.eid,m.id,JSON.stringify(m),JSON.stringify({team_a_score:4,team_b_score:2,result:'win'})]);
   await race(editFirst?edit:score,editFirst?score:edit,/他の端末/);
   await assert.rejects(()=>a.query('update event_team_matches set team_a_score=5 where id=$1',[m.id]),/画面を更新/);
  }
  s=await setup();await race(c=>c.query("update events set status='closed' where id=$1",[s.eid]),c=>rpc(c,'create_friendly_team_round',args(s)),/権限/);
  s=await setup();await race(c=>rpc(c,'create_friendly_team_round',args(s)),c=>c.query("update events set status='closed' where id=$1",[s.eid]));
  // 既存プロフィール統合のテーブルロックとの両実行順。権限処理自体は変更しない。
  s=await setup();await b.query('reset role');await race(c=>rpc(c,'create_friendly_team_round',args(s)),c=>c.query("select profile_link_private.lock_references();update public.club_members set player_profile_id='"+id(106)+"' where player_profile_id='"+id(103)+"'"));await auth(b);
  s=await setup();await a.query('reset role');await race(c=>c.query('select profile_link_private.lock_references()'),c=>rpc(c,'create_friendly_team_round',args(s)));await auth(a);
  // 途中2面目での不正は1面目・ラウンド・コート数更新も残さない。
  s=await setup();s.cards[1].pairs[0][0]=s.aa[0];await assert.rejects(()=>rpc(a,'create_friendly_team_round',args(s)),/重複/);assert.equal((await owner.query('select count(*)::int n from event_team_rounds where event_id=$1',[s.eid])).rows[0].n,0);
  s=await setup();await rpc(a,'create_friendly_team_round',args(s));const scoredCard=(await owner.query('select * from event_team_matches where event_id=$1 order by court_number',[s.eid])).rows[0];await rpc(a,'update_friendly_team_round_card',[s.eid,scoredCard.id,JSON.stringify(scoredCard),JSON.stringify({team_a_score:4,team_b_score:2,result:'win'})]);const aggregate=friendlyTeamStats((await owner.query('select * from event_team_matches where event_id=$1',[s.eid])).rows,['A','B'],(source,pid,guest)=>pid||guest);assert.equal((await owner.query("select count(*)::int n from event_team_matches where event_id=$1 and (team_a_score is not null or team_b_score is not null or result<>'undecided')",[s.eid])).rows[0].n,0);assert.equal(aggregate.countedMatches,0);assert.equal(aggregate.allCountedMatches,1);assert.equal(aggregate.players.reduce((n,p)=>n+p.matches,0),4);assert.equal(aggregate.pairs.reduce((n,p)=>n+p.matches,0),2);
  // 一般メンバー・対象外・匿名は拒否。両側の管理者・既存super権限は許可。
  s=await setup();for(const n of [2,4,6]){await auth(b,n);await rpc(b,'get_friendly_team_round_context',[s.eid]);}for(const n of [3,5]){await auth(b,n);await assert.rejects(()=>rpc(b,'get_friendly_team_round_context',[s.eid]),/権限/);}await b.query('reset role;set role anon');await assert.rejects(()=>rpc(b,'get_friendly_team_round_context',[s.eid]),/permission denied/);await auth(b);
  await owner.query(fs.readFileSync('supabase/maintenance/team-rounds/03_disable_generation.sql','utf8'));await assert.rejects(()=>rpc(a,'create_friendly_team_round',args(s)),/permission denied/);await rpc(a,'get_friendly_team_round_context',[s.eid]);await owner.query('grant execute on function public.create_friendly_team_round(uuid,uuid,text,text,integer,jsonb) to authenticated');
  await assert.rejects(()=>owner.query(fs.readFileSync('supabase/maintenance/team-rounds/04_rollback_empty.sql','utf8')),/生成データ/);await owner.query('rollback');
  await owner.query(fs.readFileSync('supabase/maintenance/team-rounds/02_verify.sql','utf8'));
  console.log(`PostgreSQL17：複数接続の競合 ${raceCount}構成、再送・途中ROLLBACK・混合出欠・旧クライアント拒否・権限・生成停止／復旧ガード PASS`);
 }catch(error){console.error(error.message);process.exitCode=1;}
 finally{for(const c of [a,b,monitor,restore,owner])if(c)await c.end().catch(()=>{});try{run(['exec',name,'chmod','0777','/var/run/postgresql']);run(['rm','-f',name]);}catch{}try{fs.rmSync(dir,{recursive:true,force:true});}catch{console.error('隔離ソケットの所有権により一時ディレクトリの削除を保留');}}
})();
