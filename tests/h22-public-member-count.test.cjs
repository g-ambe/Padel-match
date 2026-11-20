const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs');
const migration=fs.readFileSync('supabase/migrations/0065_public_club_member_count.sql','utf8');
const probe=fs.readFileSync('supabase/maintenance/group-foundation/99_h22_public_member_count_rollback_probe.sql','utf8');
test('H22 requires logged-in public-group context, never permits anon execute',()=>{
 assert.match(migration,/auth\.uid\(\) IS NULL/);
 assert.match(migration,/visibility='public'/);
 assert.match(migration,/REVOKE ALL ON FUNCTION public\.get_public_club_member_count\(uuid\)/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.get_public_club_member_count\(uuid\)\s+TO authenticated/);
 assert.doesNotMatch(migration,/GRANT EXECUTE[^;]*TO anon/);
});
test('H22 counts active, linked or unlinked players without exposing names',()=>{
 assert.match(migration,/cm\.is_active AND cm\.status='active'/);
 assert.match(migration,/pp\.is_active/);
 assert.match(migration,/SELECT count\(\*\) INTO v_count/);
 assert.doesNotMatch(migration,/cm\.club_display_name_public_confirmed_at IS NOT NULL\s+AND/);
});
test('H22 privacy probe rolls back and checks directory independently',()=>{
 assert.match(probe,/^BEGIN;/m);
 assert.match(probe,/^ROLLBACK;/m);
 assert.doesNotMatch(probe,/^COMMIT;/m);
 assert.match(probe,/public_directory_still_private/);
 assert.match(probe,/anonymous_denied/);
 assert.match(probe,/private_denied/);
});
