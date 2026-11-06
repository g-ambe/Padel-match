const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixedPairDatabase}=require('./fixtures/fixed-pair-db.cjs');
test('本番用の専用イベント試験は停止中と有効化後の両方で既存データを変更しない',async()=>{
 const f=await fixedPairDatabase(true),{db}=f;
 try{
  for(const name of ['0041_atomic_round_lineups.sql','0042_round_lineup_safety.sql','0043_match_results_one_per_match.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
  const sql=fs.readFileSync('supabase/maintenance/match-result-repair/production-rpc-smoke.sql','utf8');
  const fingerprint=async()=>JSON.stringify((await db.query("select (select jsonb_agg(to_jsonb(x) order by id) from events x) events,(select jsonb_agg(to_jsonb(x) order by id) from profiles x) profiles,(select count(*) from friendly_match_operations) operations,(select count(*) from match_results) results")).rows);
  const before=await fingerprint();
  for(const enabled of [false,true]){
   await db.exec('update lineup_private.release_control set editing_enabled='+enabled);
   const result=await db.exec(sql),report=result.find(r=>r.rows?.[0]?.jsonb_build_object).rows[0].jsonb_build_object;
   assert.equal(report.editing_enabled,enabled);
   assert.equal(report.dedicated_events_rolled_back,true);
   assert.equal(await fingerprint(),before);
  }
 }finally{await db.close();}
});
