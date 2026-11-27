from pathlib import Path
import subprocess,os,hashlib
P=Path(__file__).resolve().parents[3];D=os.environ['TASK0802_DB']
def sql(s):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i','-e','PGOPTIONS=-c search_path=public,extensions',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-'],input=s,text=True,capture_output=True)
 if r.returncode: raise RuntimeError(r.stderr[-1200:])
 return r.stdout
sql('CREATE SCHEMA vault;CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);GRANT USAGE ON SCHEMA auth,extensions TO PUBLIC;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth,extensions TO PUBLIC;')
M=P/'migrations';G=P/'maintenance/group-foundation';E=P/'maintenance/club-invitations/isolated-evidence'
for f in sorted(M.glob('*.sql')):
 if '0001'<=f.name[:4]<='0039' or '0044'<=f.name[:4]<='0052' or f.name[:4] in ('0054','0055'):sql(f.read_text())
sql('REVOKE ALL ON public.club_members FROM anon;')
for f in sorted(M.glob('*.sql')):
 if '0056'<=f.name[:4]<='0060':sql(f.read_text())
sql((G/'139_h38_prod_link_scoped_preview_candidate.sql').read_text());sql((M/'0061_receiver_named_profile_link.sql').read_text())
h51=(G/'164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql').read_text()
for old in (" OR to_regclass('public.club_owner_transfer_requests') IS NULL\n"," OR (SELECT count(*) FROM supabase_migrations.schema_migrations\n     WHERE name='task08_prod_phase2_atomic') <> 1\n"):
 assert h51.count(old)==1;h51=h51.replace(old,'')
sql(h51);sql((M/'20261125032915_group_member_public_choice.sql').read_text())
h52=(G/'168_h52_media_reference_guard_CANDIDATE.sql').read_text()
for old in (" OR to_regclass('public.h51_postcutover_data_preservation') IS NULL\n"," OR NOT EXISTS(SELECT 1 FROM public.h51_postcutover_data_preservation WHERE marker='retained')\n"," OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name='task08_prod_phase2_atomic')<>1\n"):
 assert h52.count(old)==1;h52=h52.replace(old,'')
sql(h52)
if os.environ.get('TASK0802_FORMAL') == '1':
 if os.environ.get('TASK0802_SCORE') == '1':
  import re
  migration=(M/'0040_event_fixed_pairs.sql').read_text()
  # Only the baseline compatibility preflight is bypassed in this disposable
  # copy. It expects production RLS/triggers absent from the synthetic setup;
  # no product SQL or existing RLS/policies is modified.
  migration,n=re.subn(r'do \$guard\$.*?end \$guard\$;',"-- synthetic baseline: production compatibility preflight omitted",migration,count=1,flags=re.S|re.I)
  assert n==1
  sql(migration)
  for f in ('0041_atomic_round_lineups.sql','0042_round_lineup_safety.sql','0043_match_results_one_per_match.sql','20261125010835_nonfixed_round_lineup_protection.sql'):sql((M/f).read_text())
 sql("CREATE ROLE authenticator LOGIN PASSWORD 'fake-postgrest-password' NOINHERIT; GRANT anon,authenticated,service_role TO authenticator; GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;")
 print('PASS synthetic baseline prepared for formal candidate')
 raise SystemExit(0)
candidate=P/'maintenance/club-invitations/04_integrated_review_candidate.sql'
assert hashlib.sha256(candidate.read_bytes()).hexdigest()=='1c039a661628d229b25d1bd123946dda246233585e3e3901fc7614202429c7b6', 'candidate changed; review required'
c=candidate.read_text();assert c.count('ROLLBACK;')==1
sql("SET padel.invite_review_isolated='synthetic-only';\n"+c.replace('ROLLBACK;','COMMIT;'))
sql("ALTER TABLE club_invite_private.settings DROP CONSTRAINT club_invite_review_send_off; UPDATE club_invite_private.settings SET send_enabled=true; INSERT INTO vault.decrypted_secrets VALUES ('padel_club_invite_hmac_v1',encode(decode(repeat('11',32),'hex'),'base64')),('padel_club_invite_encryption_v1',encode(decode(repeat('22',32),'hex'),'base64')); CREATE ROLE authenticator LOGIN PASSWORD 'fake-postgrest-password' NOINHERIT; GRANT anon,authenticated,service_role TO authenticator; GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;")
print('PASS synthetic app baseline + exact candidate transaction copy; real GoTrue schema')
