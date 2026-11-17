const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture,uid,pid}=require('./fixtures/profile-media-db.cjs');
const file=n=>fs.readFileSync('supabase/migrations/'+n,'utf8');
const seed=file('0052_jpa_existing_facility_corrections.sql');
async function setup(){
 const f=await fixture();await f.db.exec(file('0050_private_profile_home_court.sql'));await f.db.exec("alter table player_profiles add column display_name text not null default 'synthetic';create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations values('0050','private_profile_home_court',ARRAY[]::text[])");
 await f.db.exec('create function uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;create table clubs(id uuid primary key,main_facility_id uuid);');
 await f.db.exec(file('0015_group_profile_facility_and_image.sql'));await f.db.exec('alter table clubs add foreign key(main_facility_id) references padel_facilities(id);');
 await f.db.exec(file('0017_padel_facilities_rls.sql'));await f.db.exec(file('0016_seed_padel_facilities_initial.sql'));
 await f.db.exec("insert into clubs select gen_random_uuid(),id from padel_facilities;insert into padel_facilities(name,prefecture) values('協会未掲載の既存施設','沖縄');");
 await f.as();await f.call('save_my_home_court',[pid,0,'以前の自由入力',await f.ticket()]);await f.db.exec('reset role');
 await f.db.exec(fs.readFileSync('supabase/maintenance/shared-home-facility/01_preflight.sql','utf8'));await f.db.exec(file('0051_shared_home_facility.sql'));return f;
}
test('0052は既存9施設だけを同じIDで補正し、冪等・クラブ/個人/協会未掲載行/営業状態を保持',async()=>{
 const f=await setup();try{
 const before=(await f.db.query('select * from padel_facilities order by id')).rows,clubs=(await f.db.query('select * from clubs order by id')).rows;
 const tokyo=before.find(r=>r.name==='パデル東京');await f.as();await f.call('save_my_home_court_selection',[pid,1,tokyo.id,'',await f.ticket()]);await f.db.exec('reset role');
 const privateRows=(await f.db.query('select * from player_profile_private')).rows;
 await f.db.exec(seed);let after=(await f.db.query('select * from padel_facilities order by id')).rows;
 assert.deepEqual(after.map(r=>r.id),before.map(r=>r.id));assert.equal(after.length,10);
 assert.deepEqual((await f.db.query('select * from clubs order by id')).rows,clubs);assert.deepEqual((await f.db.query('select * from player_profile_private')).rows,privateRows);
 for(const row of before){const a=after.find(r=>r.id===row.id);assert.deepEqual(a.created_at,row.created_at);assert.equal(a.availability,row.availability);assert.equal(a.verified_on,null);if(row.name==='協会未掲載の既存施設')assert.deepEqual(a,row);}
 const hare=after.find(r=>r.facility_key==='jpa:harenochihare');assert.equal(hare.prefecture,'千葉県');assert.equal(hare.address,'千葉県千葉市中央区浜野町840');assert(hare.aliases.includes('パデル＆フットサル 晴れのち晴れ'));
 const chigasaki=after.find(r=>r.facility_key==='jpa:chigasaki');assert.equal(chigasaki.name,'CHIGASAKI PADEL CLUB');assert(chigasaki.aliases.includes('茅ヶ崎パデルクラブ'));
 assert.equal(after.find(r=>r.id===tokyo.id).name,'パデル東京（善福寺公園テニスクラブ内）');
 assert.equal(after.filter(r=>r.source_url==='https://www.japanpadel.com/court-list/').length,9);
 await f.db.exec(seed);assert.deepEqual((await f.db.query('select * from padel_facilities order by id')).rows,after);
 await f.db.exec(fs.readFileSync('supabase/maintenance/shared-home-facility/02_verify.sql','utf8'));await f.db.exec(fs.readFileSync('supabase/maintenance/shared-home-facility/03_smoke.sql','utf8'));assert.deepEqual((await f.db.query('select * from player_profile_private')).rows,privateRows);
 }finally{await f.db.close();}
});
test('0052は表記揺れの別ID重複や予期しない住所補正を一括ロールバックし、保留15施設を追加しない',async()=>{
 const f=await setup();try{
 await f.db.exec("insert into padel_facilities(name,prefecture) values('キャプテン翼パデル　調布','東京')");const before=(await f.db.query('select * from padel_facilities order by id')).rows;
 await assert.rejects(f.db.exec(seed),/missing_or_ambiguous/);await f.db.exec('rollback');assert.deepEqual((await f.db.query('select * from padel_facilities order by id')).rows,before);
 await f.db.exec("delete from padel_facilities where name='キャプテン翼パデル　調布';update padel_facilities set address='別の住所' where name='GIARDINO'");
 const modified=(await f.db.query('select * from padel_facilities order by id')).rows;await assert.rejects(f.db.exec(seed),/changed_stop/);await f.db.exec('rollback');assert.deepEqual((await f.db.query('select * from padel_facilities order by id')).rows,modified);
 const decisions=JSON.parse(fs.readFileSync('docs/facilities/jpa-courts-decisions-2026-11-18.json','utf8'));assert.equal(decisions.length,24);assert.equal(decisions.filter(d=>d.decision==='hold').length,15);assert.equal(decisions.find(d=>d.jpa_listing_no===12).decision,'hold');assert.equal(decisions.find(d=>d.jpa_listing_no===11).decision,'hold');
 }finally{await f.db.close();}
});
