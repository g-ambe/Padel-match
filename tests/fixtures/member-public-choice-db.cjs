// Synthetic SQL fixture: seven production function-body hashes are checked by the unchanged candidate.
// Auth claims are simulated; this is not PostgREST, real Auth, or the whole production catalog.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const {fixedPairDatabase}=require('./fixed-pair-db.cjs');
async function memberPublicDatabase(apply=true,providedDb,candidate="01_chatgpt_candidate.sql"){
 if(!["01_chatgpt_candidate.sql","03_lock_order_candidate.sql"].includes(candidate))throw Error("Unknown public-choice candidate");
 const f=await fixedPairDatabase(true,providedDb),d=f.db;
 try{
 for(const n of ['0044_friendly_team_attendance.sql','0045_friendly_team_random_rounds.sql','0046_user_preferences_tutorial_status.sql','0047_event_result_video.sql','0048_private_profile_media.sql','0049_profile_avatar_position.sql','0050_private_profile_home_court.sql','0051_shared_home_facility.sql','0054_group_read_interfaces.sql','0055_group_read_consumer_support.sql']){await d.exec(fs.readFileSync(root+'/supabase/migrations/'+n,'utf8'));}
 await d.exec('revoke select on club_members from anon;');
 await d.exec(fs.readFileSync(root+'/supabase/maintenance/group-foundation/139_h38_prod_link_scoped_preview_candidate.sql','utf8'));
 for(const n of ['0056_club_scoped_display_names.sql','0057_club_alias_cas_http_conflict.sql','0058_public_join_alias_consent.sql','0059_public_claim_named_alias_gateway.sql','0060_named_join_merge_snapshot.sql','0061_receiver_named_profile_link.sql','0065_public_club_member_count.sql']){await d.exec(fs.readFileSync(root+'/supabase/migrations/'+n,'utf8'));}
 await d.exec("create table public.club_owner_transfer_requests(id uuid primary key);create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text);insert into supabase_migrations.schema_migrations values('local-fixture','task08_prod_phase2_atomic');");
 await d.exec(fs.readFileSync(root+'/supabase/maintenance/group-foundation/164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql','utf8'));

 // Reproduce the existing H52 media FK guard; marker is disposable fixture data only.
 await d.exec("create table public.h51_postcutover_data_preservation(marker text);insert into public.h51_postcutover_data_preservation values('retained');");
 await d.exec(fs.readFileSync(root+'/supabase/maintenance/group-foundation/168_h52_media_reference_guard_CANDIDATE.sql','utf8'));
 await d.exec('drop table public.h51_postcutover_data_preservation');
 if(apply)await d.exec(fs.readFileSync(root+'/supabase/maintenance/group-member-public-choice/'+candidate,'utf8'));
 return f;
 }catch(e){await d.close();throw e;}
}
module.exports={memberPublicDatabase};
