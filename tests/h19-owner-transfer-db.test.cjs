const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = n => fs.readFileSync(n,'utf8');
const m62=read('supabase/migrations/0062_owner_transfer_recipient_approval.sql');
const m63=read('supabase/migrations/0063_owner_transfer_uuid_aggregate_fix.sql');
const m64=read('supabase/migrations/0064_owner_transfer_decline_after_demotion.sql');
const a=read('supabase/maintenance/group-foundation/85_h19_owner_handover_rollback_probe.sql');
const b=read('supabase/maintenance/group-foundation/86_h19_owner_handover_negative_rollback_probe.sql');
const c=read('supabase/maintenance/group-foundation/87_h19_demoted_recipient_decline_rollback_probe.sql');

test('H19 transfer requires owner request and recipient acceptance with no inferred expiry',()=>{
 assert.match(m62,/CREATE TABLE public\.club_owner_transfer_requests/);
 assert.match(m62,/CREATE UNIQUE INDEX task08_h19_one_pending_per_club/);
 assert.match(m62,/CREATE FUNCTION public\.request_club_owner_transfer/);
 assert.match(m62,/CREATE FUNCTION public\.respond_club_owner_transfer/);
 assert.match(m62,/v_req\.to_auth_user_id IS DISTINCT FROM v_actor/);
 assert.match(m62,/v_req\.from_auth_user_id IS DISTINCT FROM v_current_owner/);
 assert.match(m62,/IF p_decision='accepted' THEN/);
 assert.match(m62,/UPDATE public\.clubs SET owner_id=v_actor/);
 assert.doesNotMatch(m62,/expires_at|auto_accept|automatic_approve/i);
});
test('H19 retains last-main guard and prevents current owner role/exit changes',()=>{
 assert.match(m62,/CREATE FUNCTION security_private\.task08_guard_current_owner_membership/);
 assert.match(m62,/BEFORE UPDATE OF role,is_active,status,club_id,profile_id,player_profile_id/);
 assert.match(m62,/OR DELETE ON public\.club_members/);
 assert.match(m62,/NEW\.role IS DISTINCT FROM 'main_admin'/);
 assert.match(m62,/NEW\.is_active IS DISTINCT FROM true/);
 assert.match(m62,/REVOKE ALL ON TABLE public\.club_owner_transfer_requests FROM PUBLIC,anon,authenticated/);
 assert.match(m62,/ENABLE ROW LEVEL SECURITY/);
 assert.match(m62,/has_table_privilege\('authenticated','public\.club_owner_transfer_requests','SELECT'\)/);
});
test('H19 forward-only patches correct uuid aggregation and decline-after-demotion',()=>{
 assert.match(m63,/array_agg\(cm\.id ORDER BY cm\.id\)/);
 assert.match(m63,/array_agg\(pp\.linked_auth_user_id ORDER BY pp\.linked_auth_user_id\)/);
 assert.match(m64,/IF p_decision='accepted' THEN/);
 assert.match(m64,/p_decision IS NULL/);
});
test('H19 owner transfer includes notification link and owner-only candidate listing',()=>{
 assert.match(m62,/related_owner_transfer_request_id uuid/);
 assert.match(m62,/CREATE FUNCTION public\.get_club_owner_transfer_candidates/);
 assert.match(m62,/CREATE FUNCTION public\.list_my_club_owner_transfers/);
 assert.match(m62,/CREATE FUNCTION public\.cancel_club_owner_transfer/);
 assert.match(m62,/club_owner_transfer_requested/);
 assert.match(m62,/club_owner_transfer_accepted/);
 assert.match(m62,/club_owner_transfer_declined/);
 assert.match(m62,/club_owner_transfer_cancelled/);
});
test('H19 Stage probes are rollback-only and cover legacy exit, duplicates, stale and recipient decline',()=>{
 for(const file of [a,b,c]){
  assert.match(file,/^BEGIN;/m);assert.match(file,/^ROLLBACK;/m);
  assert.doesNotMatch(file,/^COMMIT;/m);
 }
 for(const phrase of ['explicit_acceptance','former_owner_can_leave','owner_role_guarded','duplicate_rejected'])
  assert(a.includes(phrase),`missing ${phrase}`);
 for(const phrase of ['anonymous_denied','demoted_candidate_cannot_accept','cancelled_request_cannot_accept'])
  assert(b.includes(phrase),`missing ${phrase}`);
 assert(c.includes('demoted_recipient_can_decline_but_not_accept'));
});
