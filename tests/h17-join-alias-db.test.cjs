const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = n => fs.readFileSync(`supabase/migrations/${n}`,'utf8');
const join = sql('0058_public_join_alias_consent.sql');
const gateway = sql('0059_public_claim_named_alias_gateway.sql');
const merge = sql('0060_named_join_merge_snapshot.sql');
const probe = fs.readFileSync('supabase/maintenance/group-foundation/71_h17_named_join_rollback_probe.sql','utf8');

test('H17 public join stores explicit name and disclosure consent without global profile mutation', () => {
 assert.match(join,/ADD COLUMN club_display_name_requested text/);
 assert.match(join,/ADD COLUMN club_display_name_confirmed_at timestamptz/);
 assert.match(join,/IF p_public_confirmation IS NOT TRUE THEN/);
 assert.match(join,/v_request:=public\.submit_profile_join_request\(/);
 assert.match(join,/requester_auth_user_id=v_auth AND status='pending'/);
 assert.match(join,/CREATE TRIGGER task08_h17_apply_join_name_after_approval/);
 assert.match(join,/OLD.status='pending' AND NEW.status='approved'/);
 assert.match(join,/pp.linked_auth_user_id=NEW.requester_auth_user_id/);
 assert.match(join,/club_display_name=NEW.club_display_name_requested/);
 assert.doesNotMatch(join,/UPDATE public\.player_profiles SET/i);
 assert.doesNotMatch(join,/DELETE FROM public\./i);
});

test('H17 public entrypoint accepts opaque reference, raw internal ID RPC is closed', () => {
 assert.match(gateway,/CREATE FUNCTION public\.submit_public_club_claim_named\(/);
 assert.match(gateway,/group_read_private\.claim_member\(p_club_id,p_reference\)/);
 assert.match(gateway,/REVOKE ALL ON FUNCTION public\.submit_profile_join_request_named/);
 assert.match(gateway,/GRANT EXECUTE ON FUNCTION public\.submit_public_club_claim_named/);
 assert.match(gateway,/auth\.uid\(\) IS NULL/);
});

test('H17 merges retain exact post-approval alias in audit before/after rows', () => {
 assert.match(merge,/profile_link_private\.merge_changes changes/);
 assert.match(merge,/after_row=to_jsonb\(cm\)/);
 assert.match(merge,/changes\.source_table='club_members'/);
 assert.match(merge,/m\.join_request_id=NEW.id/);
 assert.match(merge,/v_count<>1/);
});

test('H17 integration probe rolls back identity claims, consent, approval and merge effects', () => {
 assert.match(probe,/^BEGIN;/m);
 assert.match(probe,/^ROLLBACK;/m);
 for(const key of ['no_consent_rejected','approval_requests','recipient_name_applied',
  'claimed_name_applied','merge_audit_consistent','provisional_profile_inactivated',
  'public_directory_only_consented','public_ref_not_real_member_id',
  'direct_named_raw_rpc_revoked']){
   assert(probe.includes(`'${key}'`),`missing ${key}`);
 }
 assert.match(probe,/public\.preview_public_club_claim/);
 assert.match(probe,/public\.submit_public_club_claim_named/);
});
