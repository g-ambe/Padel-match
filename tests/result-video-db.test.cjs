const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixedPairDatabase,id}=require('./fixtures/fixed-pair-db.cjs');
test('結果動画RPC：終了後の手動/自動カードは動画のみ更新、既存RLS不変・共有閲覧者の更新拒否',async()=>{
 const {db,as,event,rpc}=await fixedPairDatabase(false);
 try{
  for(const file of ['0044_friendly_team_attendance.sql','0045_friendly_team_random_rounds.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  const catalog=async()=>JSON.stringify((await db.query("select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname")).rows);
  const acl=async()=>JSON.stringify((await db.query("select c.relname,c.relacl::text,a.attname,a.attacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_attribute a on a.attrelid=c.oid and a.attnum>0 where n.nspname='public' and c.relkind='r' order by c.relname,a.attnum")).rows);
  const aclBefore=await acl();
  const before=await catalog();await db.exec(fs.readFileSync('supabase/migrations/0047_event_result_video.sql','utf8'));assert.equal(await catalog(),before);
  const normal=await event(971,4,{status:'closed',noGroup:true});
  await db.query('insert into rounds(id,event_id,round_number) values($1,$2,1)',[id(9711),normal.eid]);
  await db.query('insert into matches(id,event_id,round_id,court_number,completed) values($1,$2,$3,1,true)',[id(9712),normal.eid,id(9711)]);
  await as(1);assert.equal((await db.query("update matches set youtube_url='https://youtu.be/normal' where id=$1 returning id",[id(9712)])).rows.length,1,'通常フレンドリーの終了後動画保存は既存RLSで許可');
  const {eid}=await event(970,0,{mode:'team'});
  await db.query("insert into event_team_sides(event_id,side,club_id,team_name) values($1,'team_a',$2,'A'),($1,'team_b',$3,'B')",[eid,id(600),id(601)]);
  for(const side of ['team_a','team_b'])for(let n=0;n<2;n++)await db.query('insert into event_team_guests(event_id,side,guest_name) values($1,$2,$3)',[eid,side,side+'ゲスト'+n]);
  await as(1);const ctx=await rpc('get_friendly_team_round_context',[eid]),a=ctx.roster.filter(p=>p.source==='team_a'&&p.guest_id),b=ctx.roster.filter(p=>p.source==='team_b'&&p.guest_id);
  await rpc('create_friendly_team_round',[eid,id(9001),ctx.revision,'confrontation',1,JSON.stringify([{court:1,pairs:[a,b]}])]);
  const generated=(await db.query('select * from event_team_matches where event_id=$1',[eid])).rows[0];
  await rpc('update_friendly_team_round_card',[eid,generated.id,JSON.stringify(generated),JSON.stringify({team_a_score:4,team_b_score:2,result:'win'})]);
  await db.exec('reset role');
  const manual=(await db.query("insert into event_team_matches(event_id,match_order,team_a_player1_guest_name,team_a_player2_guest_name,team_b_player1_guest_name,team_b_player2_guest_name,team_a_score,team_b_score,result) values($1,2,'A1','A2','B1','B2',0,0,'undecided') returning *",[eid])).rows[0];
  await db.query("update events set status='closed',share_enabled=true,share_token='result-test' where id=$1",[eid]);
  const snapshot=async()=>JSON.stringify((await db.query("select to_jsonb(m)-'youtube_url'-'updated_at' data from event_team_matches m where event_id=$1 order by id",[eid])).rows);
  const dataBefore=await snapshot();await as(1);
  for(const mid of [generated.id,manual.id]){
   const saved=await rpc('save_friendly_team_match_video',[eid,mid,'https://youtu.be/test',null]);assert.equal(saved.youtube_url,'https://youtu.be/test');
   assert.deepEqual(await rpc('save_friendly_team_match_video',[eid,mid,'https://youtu.be/test',null]),saved);
   await assert.rejects(()=>rpc('save_friendly_team_match_video',[eid,mid,'https://youtu.be/other',null]),/他の端末/);
   await assert.rejects(()=>rpc('save_friendly_team_match_video',[eid,mid,'javascript:bad','https://youtu.be/test']),/YouTube/);
  }
  assert.equal(await snapshot(),dataBefore);
  assert.equal((await db.query("update event_team_matches set team_a_score=99 where id=$1 returning id",[manual.id])).rows.length,0,'終了後の直接スコア更新は引き続きRLSで拒否');
  await as(3);await assert.rejects(()=>rpc('save_friendly_team_match_video',[eid,manual.id,null,'https://youtu.be/test']),/権限/);
  await as(4);await rpc('save_friendly_team_match_video',[eid,manual.id,null,'https://youtu.be/test']);
  await rpc('save_friendly_team_match_video',[eid,manual.id,'https://www.youtube.com/watch?v=sample',null]);
  await rpc('save_friendly_team_match_video',[eid,manual.id,'https://youtube.com/shorts/sample','https://www.youtube.com/watch?v=sample']);
  await rpc('save_friendly_team_match_video',[eid,manual.id,null,'https://youtube.com/shorts/sample']);
  await assert.rejects(()=>rpc('save_friendly_team_match_video',[id(969),manual.id,'https://youtu.be/test',null]),/権限/);
  await as(0,'anon');await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-padel-share-token':'result-test'})]);
  assert.equal((await db.query('select id from event_team_matches where event_id=$1',[eid])).rows.length,2);
  await assert.rejects(()=>rpc('save_friendly_team_match_video',[eid,manual.id,'https://youtu.be/test',null]),/permission denied/);
  for(const table of ['event_team_matches','matches','match_results','events'])await assert.rejects(()=>db.query(`update ${table} set id=id`),/permission denied/);
  await as(1);await db.query("update events set share_enabled=false,share_token=null where id=$1",[eid]);
  await as(0,'anon');assert.equal((await db.query('select id from events where id=$1',[eid])).rows.length,0);assert.equal((await db.query('select id from event_team_matches where event_id=$1',[eid])).rows.length,0);
  await db.exec('reset role');assert.equal(await snapshot(),dataBefore);assert.equal(await catalog(),before);assert.equal(await acl(),aclBefore);
 }finally{await db.close();}
});

test('0047の専用開催検証SQLは手動・自動・共有・競合を試験し、全試験データを取り消す',async()=>{
 const {db}=await fixedPairDatabase(false);
 try{
  for(const file of ['0044_friendly_team_attendance.sql','0045_friendly_team_random_rounds.sql','0047_event_result_video.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  const snapshot=async()=>JSON.stringify((await db.query("select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) data from public.events e")).rows);
  const before=await snapshot();
  await db.exec('begin;'+fs.readFileSync('supabase/maintenance/event-result-video/03_smoke.sql','utf8')+'commit;');
  assert.equal(await snapshot(),before,'成功時にも専用開催を残さない');
  assert.equal((await db.query('select count(*) n from public.event_team_matches')).rows[0].n,0);
 }finally{await db.close();}
});

test('通常フレンドリーのライブ動画登録は0041/0042適用後もスコア・編成を変更しない',async()=>{
 const {db,event,as}=await fixedPairDatabase(true);
 try{
  for(const file of ['0041_atomic_round_lineups.sql','0042_round_lineup_safety.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  for(const noGroup of [true,false]){
   const e=await event(noGroup?985:986,4,{status:'closed',noGroup});
   const r=(await db.query('insert into rounds(event_id,round_number) values($1,1) returning id',[e.eid])).rows[0];
   const m=(await db.query('insert into matches(event_id,round_id,court_number,completed) values($1,$2,1,true) returning id',[e.eid,r.id])).rows[0];
   for(let n=0;n<4;n++)await db.query('insert into match_players(match_id,participant_id,team) values($1,$2,$3)',[m.id,e.participants[n],n<2?'A':'B']);
   await db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,4,2,'A')",[m.id]);
   const snapshot=async()=>JSON.stringify((await db.query("select (select to_jsonb(m)-'youtube_url' from matches m where id=$1) match,(select jsonb_agg(to_jsonb(p) order by p.id) from match_players p where match_id=$1) players,(select jsonb_agg(to_jsonb(r) order by r.id) from match_results r where match_id=$1) results",[m.id])).rows);
   const before=await snapshot();await as(1);
   const url='https://www.youtube.com/live/sample-live?si=sample';
   const saved=await db.query('update matches set youtube_url=$1 where id=$2 and event_id=$3 returning youtube_url',[url,m.id,e.eid]);
   assert.equal(saved.rows[0].youtube_url,url);assert.equal(await snapshot(),before);
   await db.query('update matches set youtube_url=null where id=$1',[m.id]);
   assert.equal(await snapshot(),before);
  }
 }finally{await db.close();}
});
