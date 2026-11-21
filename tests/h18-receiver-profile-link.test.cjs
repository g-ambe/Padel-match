const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration=fs.readFileSync('supabase/migrations/0061_receiver_named_profile_link.sql','utf8');
const probe=fs.readFileSync('supabase/maintenance/group-foundation/78_h18_receiver_named_link_rollback_probe.sql','utf8');

test('H18 maintains previous reviewer while adding receiver-only named approval and recipient-only suggestion',()=>{
 assert.match(migration,/CREATE FUNCTION public\.review_player_profile_link_named\(/);
 assert.match(migration,/v_user:=auth\.uid\(\)/);
 assert.match(migration,/v_req\.target_auth_user_id<>v_user/);
 assert.match(migration,/v_req\.status<>'pending'/);
 assert.match(migration,/v_source\.club_display_name IS DISTINCT FROM p_expected_club_display_name/);
 assert.match(migration,/RAISE SQLSTATE 'PT409'/);
 assert.match(migration,/p_public_confirmation IS NOT TRUE/);
 assert.match(migration,/v_review:=public\.review_player_profile_link\(p_request_id,'approved',p_review_token\)/);
 assert.match(migration,/group_display_name_suggestion/);
 assert.match(migration,/group_display_name_current/);
 assert.match(migration,/group_visibility/);
 assert.match(migration,/if recipient then/);
 assert.match(migration,/REVOKE ALL ON FUNCTION public\.review_player_profile_link_named/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.review_player_profile_link_named/);
});
test('H18 atomically logs receiver consent with merged membership and audit snapshot',()=>{
 assert.match(migration,/club_display_name_selected=v_chosen/);
 assert.match(migration,/club_display_name_public_confirmed_at=v_confirmed/);
 assert.match(migration,/mc\.merge_id=v_merge/);
 assert.match(migration,/mc\.source_schema='public' AND mc\.source_table='club_members'/);
 assert.match(migration,/mc\.row_id=v_source\.id/);
 assert.match(migration,/SET after_row=to_jsonb\(cm\)/);
 assert.match(migration,/v_count<>1/);
 assert.doesNotMatch(migration,/UPDATE public\.player_profiles\s+SET/i);
 assert.doesNotMatch(migration,/DELETE FROM public\./i);
});
test('H18 reversible Stage probe includes manager scope, rejected cases, private and legacy',()=>{
 assert.match(probe,/^BEGIN;/m);
 assert.match(probe,/^ROLLBACK;/m);
 for(const key of [
 'manager_scope_safe','other_user_rejected','public_requires_consent','alias_cas_pt409',
 'obsolete_review_token_rejected','private_public_flag_rejected','approved_all',
 'public_alias_saved','private_alias_is_private','old_legacy_alias_not_exposed',
 'public_directory_only_approved','merge_snapshots_consistent',
 'request_receiver_consent_saved','private_request_consent_not_public',
 'legacy_request_not_backfilled','original_profile_names_unmodified',
 'synthetic_sources_retired']){
 assert(probe.includes(`'${key}'`),`missing ${key}`);
 }
});
