// Free isolated synthetic fixtures. Never reads hosted credentials or copies production rows.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {fixedPairDatabase,id}=require('./fixed-pair-db.cjs');
const {fixture,uid,other,pid,request}=require('./profile-media-db.cjs');
const path='supabase/maintenance/lineup-home-court/';
const candidate=n=>fs.readFileSync(path+(n===1?'01_nonfixed_lineup_candidate.sql':'02_home_court_master_only_candidate.sql'),'utf8');
const fingerprint=async db=>(await db.query(`SELECT jsonb_build_object(
 'relations',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','lineup_private','fixed_pair_private','profile_media_private') AND c.relkind IN ('r','p')),
 'columns',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,a.attacl::text) ORDER BY n.nspname,c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','lineup_private','fixed_pair_private','profile_media_private') AND a.attnum>0 AND NOT a.attisdropped),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p),
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid::int,p.proowner,p.proacl::text,p.prosecdef,p.provolatile,p.proconfig) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','lineup_private','fixed_pair_private','profile_media_private')),
 'other_bodies',(SELECT jsonb_agg(jsonb_build_array(p.oid::int,md5(p.prosrc)) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','lineup_private','fixed_pair_private','profile_media_private') AND p.proname NOT IN ('snapshot','replace_friendly_round_lineup','save_my_home_court','save_my_home_court_selection')),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(oid::int,tgenabled,pg_get_triggerdef(oid)) ORDER BY oid) FROM pg_trigger WHERE NOT tgisinternal)
 ) value`)).rows[0].value;
async function lineupFixture(apply=true,providedDb){
 const f=await fixedPairDatabase(true,providedDb);for(const n of ['0041_atomic_round_lineups.sql','0042_round_lineup_safety.sql','0043_match_results_one_per_match.sql'])await f.db.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
 const before=await fingerprint(f.db);if(apply){await f.db.exec(candidate(1));assert.deepEqual(await fingerprint(f.db),before);}
 await f.db.exec('update lineup_private.release_control set editing_enabled=true');
 let seq=8900000,ev=5000;f.req=()=>id(seq++);
 f.seed=async(count=9,pairs=[],slots=Array.from({length:8},(_,i)=>i),extra={})=>{
  const e=await f.event(ev++,count,{courts:slots.length/4,...extra});await f.as(extra.noGroup?1:3);
  if(pairs.length)await f.rpc('replace_event_fixed_pairs',[e.eid,0,JSON.stringify(pairs.map(([a,b])=>({id:f.req(),a:e.participants[a],b:e.participants[b]}))),f.req()]);
  for(const n of extra.rest??[])await f.db.query("update event_participants set status='resting' where id=$1",[e.participants[n]]);
  const fixed=extra.noGroup?{revision:0}:await f.rpc('get_event_fixed_pair_state',[e.eid,true]);
  const generated=await f.rpc('create_friendly_round',[JSON.stringify({eventId:e.eid,lineupRevision:0,revision:fixed.revision,lastRound:0,courtCount:slots.length/4,mode:'normal',activeIds:e.participants.filter((_,i)=>!extra.rest?.includes(i)),matches:Array.from({length:slots.length/4},(_,i)=>({court:i+1,teamA:slots.slice(i*4,i*4+2).map(n=>e.participants[n]),teamB:slots.slice(i*4+2,i*4+4).map(n=>e.participants[n])})),requestId:f.req()})]);
  return {...e,rid:generated.round_id};
 };
 f.snap=e=>f.rpc('get_friendly_round_lineup',[e.eid,e.rid]);
 f.edit=(e,s,cards,req=f.req())=>f.rpc('replace_friendly_round_lineup',[e.eid,e.rid,JSON.stringify(s),JSON.stringify(cards),req]);
 f.cards=s=>s.cards.map(c=>({id:c.id,players:structuredClone(c.players)}));
 return f;
}
async function homeFixture(){
 const f=await fixture();for(const n of ['0050_private_profile_home_court.sql'])await f.db.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
 await f.db.exec('create table padel_facilities(id uuid primary key,name text not null unique,prefecture text,address text);create table clubs(id uuid primary key,main_facility_id uuid references padel_facilities(id));');
 await f.db.exec(fs.readFileSync('supabase/migrations/0017_padel_facilities_rls.sql','utf8'));
 f.fid=request(500);f.closed=request(501);await f.db.query("insert into padel_facilities(id,name,prefecture) values($1,'正規施設名','埼玉県'),($2,'閉業施設','東京都')",[f.fid,f.closed]);
 await f.db.query('insert into clubs values($1,$2)',[request(600),f.fid]);await f.as();await f.call('save_my_home_court',[pid,0,'既存の自由入力',await f.ticket()]);await f.db.exec('reset role');
 await f.db.exec(fs.readFileSync('supabase/migrations/0051_shared_home_facility.sql','utf8'));await f.db.query("update padel_facilities set availability='closed' where id=$1",[f.closed]);
 const before=await fingerprint(f.db),rows=(await f.db.query('select to_jsonb(t) value from player_profile_private t')).rows;
 await f.db.exec(candidate(2));assert.deepEqual(await fingerprint(f.db),before);assert.deepEqual((await f.db.query('select to_jsonb(t) value from player_profile_private t')).rows,rows);
 f.select=async(v,facility,name='')=>f.call('save_my_home_court_selection',[pid,v,facility,name,await f.ticket()]);
 f.legacy=async(v,name)=>f.call('save_my_home_court',[pid,v,name,await f.ticket()]);
 return f;
}
module.exports={lineupFixture,homeFixture,candidate,fingerprint,id,uid,other,pid,request};
