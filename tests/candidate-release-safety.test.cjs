const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {lineupFixture,candidate,fingerprint}=require('./fixtures/lineup-home-court-candidates.cjs');
const {fixture}=require('./fixtures/profile-media-db.cjs');
const hashes=async db=>(await db.query("select proname,md5(prosrc) hash from pg_proc where proname in('snapshot','replace_friendly_round_lineup','save_my_home_court','save_my_home_court_selection') order by proname")).rows;
for(const number of [1,2])test(`候補${number}：role/preflight・二重適用拒否・末尾障害時の関数変更rollback`,async()=>{
 const f=number===1?await lineupFixture(false):await fixture();const {db}=f;
 try{
  if(number===2){await db.exec(fs.readFileSync('supabase/migrations/0050_private_profile_home_court.sql','utf8'));await db.exec('create table padel_facilities(id uuid primary key,name text not null unique,prefecture text);');await db.exec(fs.readFileSync('supabase/migrations/0051_shared_home_facility.sql','utf8'));}
  if(number===1){const e=await f.seed(9,[[0,1]]),s=await f.snap(e),m=s.cards[0];await f.rpc('save_friendly_match_score',[e.eid,m.id,s.revision,JSON.stringify(m.players),JSON.stringify({completed:m.completed,results:m.result}),2,1,f.req()]);await db.exec('reset role');}
  const rowTables=number===1?['events','event_participants','rounds','matches','match_players','match_results','event_fixed_pairs','event_fixed_pair_state','event_fixed_pair_rounds','friendly_match_operations','friendly_round_lineup_state']:['player_profiles','player_profile_private','profile_media_attempts','profile_media_operations','profile_media_objects','padel_facilities'];
  const rows=async()=>{const result={};for(const table of rowTables)result[table]=(await db.query(`select to_jsonb(t) value from public.${table} t order by to_jsonb(t)::text`)).rows;return result;};
  const source=candidate(number),before=await hashes(db),catalog=await fingerprint(db),beforeRows=await rows();
  await db.exec('set role authenticated');await assert.rejects(db.exec(source),/Unexpected migration role/);await db.exec('rollback;reset role');assert.deepEqual(await hashes(db),before);
  await assert.rejects(db.exec(source.replace("NOTIFY pgrst,'reload schema';","SELECT 1/0;")),e=>e.code==='22012');await db.exec('rollback');assert.deepEqual(await hashes(db),before);assert.deepEqual(await fingerprint(db),catalog);assert.deepEqual(await rows(),beforeRows);
  await db.exec(source);const after=await hashes(db);assert.notDeepEqual(after,before);assert.deepEqual(await fingerprint(db),catalog);assert.deepEqual(await rows(),beforeRows);
  await assert.rejects(db.exec(source),/Baseline changed/);await db.exec('rollback');assert.deepEqual(await hashes(db),after);
 }finally{await db.close();}
});
