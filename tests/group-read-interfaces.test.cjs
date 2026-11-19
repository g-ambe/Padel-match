const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const{PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
 const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO PUBLIC;
 CREATE TABLE clubs(id uuid PRIMARY KEY,is_active boolean DEFAULT true,is_deleted boolean DEFAULT false,visibility text);
 CREATE TABLE player_profiles(id uuid PRIMARY KEY,linked_auth_user_id uuid,display_name text,is_active boolean DEFAULT true);
 CREATE TABLE profiles(id uuid PRIMARY KEY,display_name text);
 CREATE TABLE club_members(id uuid PRIMARY KEY,club_id uuid REFERENCES clubs,profile_id uuid,player_profile_id uuid,role text,is_active boolean DEFAULT true,status text DEFAULT 'active',created_at timestamptz DEFAULT now());
 CREATE TABLE events(id uuid PRIMARY KEY,club_id uuid,created_by_auth_user_id uuid,event_mode text,is_deleted boolean DEFAULT false,status text,share_enabled boolean,share_token text);
 CREATE TABLE event_team_sides(event_id uuid,club_id uuid);CREATE TABLE event_participants(event_id uuid,player_profile_id uuid,profile_id uuid);
 CREATE TABLE event_team_matches(event_id uuid,team_a_player1_profile_id uuid,team_a_player2_profile_id uuid,team_b_player1_profile_id uuid,team_b_player2_profile_id uuid);
 CREATE TABLE official_events(id uuid PRIMARY KEY,share_token text,share_enabled boolean,status text,is_deleted boolean DEFAULT false);
 CREATE TABLE official_matches(official_event_id uuid,our_player1_profile_id uuid,our_player2_profile_id uuid);
 CREATE FUNCTION is_super_user() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
 CREATE FUNCTION can_manage_player_profile_club(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT auth.uid()='${id(1)}'::uuid$$;
 CREATE FUNCTION can_view_friendly_team_event_by_sides(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
 INSERT INTO clubs(id,visibility) VALUES('${id(10)}','public'),('${id(20)}','private');
 INSERT INTO player_profiles VALUES('${id(101)}','${id(1)}','Secret owner',true),('${id(102)}',null,'Guest name',true),('${id(103)}','${id(3)}','Other club',true),('${id(104)}','${id(4)}','Departed',true);
 INSERT INTO club_members(id,club_id,player_profile_id,role,is_active) VALUES('${id(201)}','${id(10)}','${id(101)}','main_admin',true),('${id(202)}','${id(10)}','${id(102)}','member',true),('${id(203)}','${id(20)}','${id(103)}','member',true),('${id(204)}','${id(10)}','${id(104)}','member',false);
 INSERT INTO events(id,club_id,event_mode,status,share_enabled,share_token) VALUES('${id(30)}','${id(10)}','auto','closed',true,'valid'),('${id(31)}','${id(20)}','auto','closed',false,'stopped');
 INSERT INTO event_participants VALUES('${id(30)}','${id(101)}',null),('${id(31)}','${id(103)}',null);
 INSERT INTO official_events VALUES('${id(40)}','official',true,'closed',false);
 INSERT INTO official_matches VALUES('${id(40)}','${id(101)}',null);
 `);
 await db.exec(fs.readFileSync('supabase/migrations/0054_group_read_interfaces.sql','utf8'));
 const as=async(uid,role='authenticated')=>{await db.exec(`RESET ROLE;SET ROLE ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid?id(uid):'']);};
 return{db,as};
}
test('group read interfaces: negative authorization, opaque directory, scoped history and unchanged base access',async()=>{
 const{db,as}=await fixture();try{
 await as(null,'anon');await assert.rejects(db.query('select * from get_public_club_directory($1)',[id(10)]));
 await as(9);const pub=(await db.query('select * from get_public_club_directory($1)',[id(10)])).rows;
 assert.equal(pub.length,2);assert.deepEqual(Object.keys(pub[0]).sort(),['display_name','is_unlinked','reference']);assert(!pub.some(r=>r.display_name==='Secret owner'));
 assert(pub.some(r=>r.display_name==='Guest name'));assert(pub.every(r=>![id(201),id(202),id(101),id(102)].includes(r.reference)));
 await assert.rejects(db.query('select * from get_public_club_directory($1)',[id(20)]));
 for(const uid of [9,3,4]){await as(uid);await assert.rejects(db.query('select * from get_club_roster($1)',[id(10)]));await assert.rejects(db.query('select * from get_club_stats_player_names($1)',[id(10)]));}
 await as(1);assert.equal((await db.query('select * from get_club_roster($1)',[id(10)])).rows.length,3);
 assert.equal((await db.query('select * from get_my_club_memberships()')).rows.length,1);
 assert.equal((await db.query('select * from get_club_stats_player_names($1)',[id(10)])).rows.length,3);
 assert.equal((await db.query('select * from get_event_club_candidates($1,$2)',[id(30),id(10)])).rows.length,2);
 await assert.rejects(db.query('select * from get_event_club_candidates($1,$2)',[id(30),id(20)]));
 await as(9);await assert.rejects(db.query('select * from get_event_player_names($1)',[id(30)]));
 await assert.rejects(db.query('select * from group_read_private.event_names($1)',[id(30)]));
 await as(null,'anon');assert.deepEqual((await db.query('select * from get_shared_event_player_names($1)',['valid'])).rows.map(r=>r.id),[id(101)]);
 for(const token of ['', 'stopped','missing'])await assert.rejects(db.query('select * from get_shared_event_player_names($1)',[token]));
 assert.equal((await db.query('select * from get_shared_official_player_names($1)',['official'])).rows[0].display_name,'Secret owner');
 await db.exec('RESET ROLE');const funcs=(await db.query("select proconfig,pg_get_userbyid(proowner) owner from pg_proc where pronamespace in ('public'::regnamespace,'group_read_private'::regnamespace) and proname like 'get_%'")).rows;
 assert(funcs.every(f=>f.proconfig.includes('search_path=""')&&f.owner==='postgres'));
 assert.equal((await db.query('select count(*)::int n from club_members')).rows[0].n,4);
 assert.equal((await db.query("select display_name from player_profiles where id=$1",[id(101)])).rows[0].display_name,'Secret owner');
 }finally{await db.close();}
});
