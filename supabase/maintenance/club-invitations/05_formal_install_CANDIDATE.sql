-- TASK-08-02 / #262: formal INSTALL CANDIDATE, rev06 body (2026-11-27).
-- REVIEW AND ISOLATED REHEARSAL REQUIRED. NOT AUTHORIZED FOR HOSTED EXECUTION.
-- Source review blob 24f56469c245d0cc81b94a5aea48ed123fe75727.
-- Source SHA256 1c039a661628d229b25d1bd123946dda246233585e3e3901fc7614202429c7b6.
-- Production catalog read-only fingerprint: 56 entries, cb7dd9058615a43fe0efa1f2378254fb.
-- Deliberately outside migrations. Never use db push/reset/repair to apply this.
-- The operator must obtain explicit separate install approval and set the
-- transaction/session opt-in on the approved target. It is an accident guard,
-- NOT authorization or proof of environment. Stage needs its own reviewed baseline.
-- All DDL and original postflight are atomic. Send remains HARD OFF.
-- No keys, extension installation, scheduler, Worker or delivery activation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $formal_install_gate$
DECLARE
 v_count bigint; v_missing bigint; v_fingerprint text;
 v_saved_search_path text:=current_setting('search_path');
BEGIN
 IF current_user<>'postgres'
 OR current_setting('padel.invite_install_approved',true) IS DISTINCT FROM 'task-08-02-rev06-install'
 THEN RAISE EXCEPTION 'Formal invite install requires separately approved operator and opt-in'; END IF;
 IF current_setting('server_version_num')::integer/10000<>17
 THEN RAISE EXCEPTION 'Invite database major version differs from reviewed baseline'; END IF;
 IF to_regclass('supabase_migrations.schema_migrations') IS NULL
 THEN RAISE EXCEPTION 'Invite migration history missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261124044002' AND name='task08_prod_phase2_atomic')
 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261125032915' AND name='group_member_public_choice')
 THEN RAISE EXCEPTION 'Invite prerequisite migration history differs'; END IF;
 PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
 WITH target_relations AS (
 SELECT unnest(ARRAY['public.app_admins','public.clubs','public.club_members','public.events','public.event_participants','public.event_team_matches','public.event_team_sides','public.join_requests','public.match_players','public.matches','public.match_results','public.official_events','public.official_matches','public.official_opponents','public.player_profile_link_requests','public.player_profile_merges','public.player_profile_private','public.player_profiles','public.profile_media_objects','public.profile_media_operations','public.profiles','public.notifications','profile_link_private.merge_changes','profile_link_private.account_lookups','auth.users','vault.decrypted_secrets']) AS object_name
), rel AS (
 SELECT tr.object_name,c.oid,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions FROM target_relations tr LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(tr.object_name)
), fingerprints AS (
 SELECT 'relation' AS kind,r.object_name,CASE WHEN r.oid IS NULL THEN NULL ELSE md5(jsonb_build_object(
 'kind',r.relkind,'owner',pg_get_userbyid(r.relowner),'acl',r.relacl,'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,'options',r.reloptions,
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,a.attacl,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(c.conname,pg_get_constraintdef(c.oid),c.convalidated) ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid=r.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_array(ic.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=r.oid),
 'policies',(SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=r.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid),md5(pg_get_functiondef(t.tgfoid))) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),
 'view',CASE WHEN r.relkind IN ('v','m') THEN pg_get_viewdef(r.oid) ELSE NULL END)::text) END AS fingerprint FROM rel r
 UNION ALL
 SELECT 'function',n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',md5(jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),has_function_privilege('service_role',p.oid,'EXECUTE'))::text)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND (n.nspname='profile_link_private' OR (n.nspname='public' AND p.proname IN ('add_provisional_club_member','find_profile_link_account','request_player_profile_link','review_player_profile_link_named','review_player_profile_link','get_player_profile_link_request','submit_profile_join_request','submit_profile_join_request_named','review_profile_join_request','ensure_my_player_profile','can_manage_player_profile_club','can_edit_player_profile_member')) OR (n.nspname='auth' AND p.proname='uid'))
 UNION ALL
 SELECT 'foreign_keys','public.player_profiles',md5(coalesce(jsonb_agg(jsonb_build_array(c.conrelid::regclass::text,c.conname,pg_get_constraintdef(c.oid),c.convalidated) ORDER BY c.conrelid::regclass::text,c.conname)::text,'[]')) FROM pg_constraint c WHERE c.contype='f' AND c.confrelid=to_regclass('public.player_profiles')
)
 SELECT count(*),count(*) FILTER(WHERE fingerprint IS NULL),
 md5(jsonb_agg(jsonb_build_array(kind,object_name,fingerprint) ORDER BY kind,object_name)::text)
 INTO v_count,v_missing,v_fingerprint FROM fingerprints;
 PERFORM pg_catalog.set_config('search_path',v_saved_search_path,true);
 IF v_count<>56 OR v_missing<>0 OR v_fingerprint IS DISTINCT FROM 'cb7dd9058615a43fe0efa1f2378254fb'
 THEN RAISE EXCEPTION 'Invite catalog drift; stop and independently review current metadata'; END IF;
END $formal_install_gate$;

-- run as the approved migration owner, before any new DDL
DO $invite_preflight$
DECLARE f text; o oid;
BEGIN
 IF current_user<>'postgres' OR to_regnamespace('club_invite_private') IS NOT NULL
 OR to_regnamespace('profile_link_private') IS NULL
 OR to_regclass('vault.decrypted_secrets') IS NULL
 OR to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL
 OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL
 OR to_regprocedure('extensions.digest(bytea,text)') IS NULL
 OR to_regprocedure('extensions.pgp_sym_encrypt(text,text,text)') IS NULL
 OR to_regprocedure('extensions.pgp_sym_decrypt(bytea,text)') IS NULL
 THEN RAISE EXCEPTION 'Invite baseline missing or already installed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.club_members')
  AND attname='club_name_public_choice' AND NOT attisdropped)
 OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.player_profile_link_requests')
  AND attname='club_name_public_choice' AND NOT attisdropped)
 THEN RAISE EXCEPTION 'Invite requires current named consent'; END IF;

 FOREACH f IN ARRAY ARRAY[
  'profile_link_private.serialize_operations()',
  'profile_link_private.lock_references()',
  'profile_link_private.check_reference_schema()',
  'profile_link_private.scoped_preview(uuid,uuid,uuid)',
  'profile_link_private.canonical(uuid,uuid)',
  'profile_link_private.club_role(uuid,uuid)',
  'profile_link_private.expire_requests()',
  'public.request_player_profile_link(uuid,uuid,uuid)',
  'public.review_player_profile_link_named(uuid,text,text,text,boolean)'
 ] LOOP
  o:=to_regprocedure(f);
  IF o IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=o
      AND pg_get_userbyid(proowner)='postgres')
  THEN RAISE EXCEPTION 'Invite baseline function missing or owner changed: %',f; END IF;
  IF has_function_privilege('anon',o,'EXECUTE')
    OR (f LIKE 'profile_link_private.%' AND (
        has_function_privilege('authenticated',o,'EXECUTE')
        OR has_function_privilege('service_role',o,'EXECUTE')))
    OR (f LIKE 'public.%' AND NOT has_function_privilege('authenticated',o,'EXECUTE'))
  THEN RAISE EXCEPTION 'Invite baseline function ACL drift: %',f; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(
     'public.review_player_profile_link_named(uuid,text,text,text,boolean)')
    AND prosecdef AND position('profile_link_private.review_player_profile_link_original' IN prosrc)>0
    AND position('club_name_public_choice' IN prosrc)>0)
 THEN RAISE EXCEPTION 'Invite named approval contract drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
   'check_club_invite_account','consume_club_invite_lookup',
   'reserve_club_invite_send','reserve_club_invite_resend','claim_club_invite_send',
   'finalize_club_invite_send','cancel_club_invite','get_club_invite_status',
   'list_my_club_invites','preview_my_club_invite','preview_club_invite_rebind',
   'rebind_club_invite','accept_my_club_invite','reject_my_club_invite']))
 THEN RAISE EXCEPTION 'Invite RPC name collision'; END IF;
 -- Existing validated FK allowlist; no new FK into player_profiles.
 PERFORM profile_link_private.check_reference_schema();
END $invite_preflight$;

CREATE SCHEMA club_invite_private;
REVOKE ALL ON SCHEMA club_invite_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE club_invite_private.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL,
  member_id uuid NOT NULL,
  source_profile_id uuid NOT NULL,
  inviter_auth_id uuid NOT NULL,
  recipient_auth_id uuid,
  email_digest bytea NOT NULL CHECK (octet_length(email_digest)=32),
  email_ciphertext bytea,
  recovery_digest bytea CHECK (recovery_digest IS NULL OR octet_length(recovery_digest)=32),
  generation integer NOT NULL DEFAULT 0 CHECK (generation>=0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled','expired','superseded')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  link_request_id uuid UNIQUE,
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '168 hours'),
  CHECK ((status='pending' AND decided_at IS NULL) OR
         (status<>'pending' AND decided_at IS NOT NULL)),
  CHECK (status<>'approved' OR (link_request_id IS NOT NULL AND recipient_auth_id IS NOT NULL)),
  CHECK (status='pending' OR (email_ciphertext IS NULL AND recovery_digest IS NULL))
);
CREATE UNIQUE INDEX club_invites_active_member ON club_invite_private.invitations(member_id)
  WHERE status='pending';
CREATE UNIQUE INDEX club_invites_active_source ON club_invite_private.invitations(source_profile_id)
  WHERE status='pending';
CREATE UNIQUE INDEX club_invites_recovery_digest ON club_invite_private.invitations(recovery_digest)
  WHERE recovery_digest IS NOT NULL;
CREATE INDEX club_invites_recipient_pending ON club_invite_private.invitations(recipient_auth_id,expires_at)
  WHERE status='pending';
CREATE INDEX club_invites_expire ON club_invite_private.invitations(expires_at)
  WHERE status='pending';

CREATE TABLE club_invite_private.send_attempts (
  operation_id uuid PRIMARY KEY,
  invite_id uuid NOT NULL REFERENCES club_invite_private.invitations(id) ON DELETE RESTRICT,
  club_id uuid NOT NULL,
  member_id uuid NOT NULL,
  quota_manager_id uuid NOT NULL,
  email_digest bytea NOT NULL CHECK (octet_length(email_digest)=32),
  generation integer NOT NULL CHECK (generation>0),
  actor_kind text NOT NULL CHECK (actor_kind IN ('manager','recipient')),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  day_jst date NOT NULL,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','sending','sent','failed','unknown')),
  finished_at timestamptz,
  UNIQUE(invite_id,generation),
  CHECK (day_jst=(reserved_at AT TIME ZONE 'Asia/Tokyo')::date),
  CHECK ((status IN ('reserved','sending') AND finished_at IS NULL) OR
         (status IN ('sent','failed','unknown') AND finished_at IS NOT NULL))
);
CREATE INDEX club_invite_attempt_member_day ON club_invite_private.send_attempts(member_id,day_jst,reserved_at);
CREATE INDEX club_invite_attempt_email_day ON club_invite_private.send_attempts(email_digest,day_jst,reserved_at);
CREATE INDEX club_invite_attempt_manager_day ON club_invite_private.send_attempts(quota_manager_id,day_jst);
CREATE INDEX club_invite_attempt_club_day ON club_invite_private.send_attempts(club_id,day_jst);
CREATE INDEX club_invite_attempt_member_interval ON club_invite_private.send_attempts(member_id,reserved_at DESC);
CREATE INDEX club_invite_attempt_email_interval ON club_invite_private.send_attempts(email_digest,reserved_at DESC);

CREATE TABLE club_invite_private.lookup_tickets (
  ticket_digest bytea PRIMARY KEY CHECK (octet_length(ticket_digest)=32),
  manager_auth_id uuid NOT NULL,
  club_id uuid NOT NULL,
  member_id uuid NOT NULL,
  source_profile_id uuid NOT NULL,
  target_auth_id uuid NOT NULL,
  email_digest bytea NOT NULL CHECK (octet_length(email_digest)=32),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
ALTER TABLE club_invite_private.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_invite_private.send_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_invite_private.lookup_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA club_invite_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private FROM PUBLIC, anon, authenticated, service_role;

-- candidate only; existing base DDL = #issuecomment-7158040704
-- distinguish group delivery from invitation-UI Auth confirmation resend
ALTER TABLE club_invite_private.send_attempts
  ADD COLUMN kind text NOT NULL DEFAULT 'group_invite'
    CHECK (kind IN ('group_invite','auth_confirmation')),
  ADD COLUMN request_digest bytea NOT NULL CHECK (octet_length(request_digest)=32),
  ADD COLUMN actor_binding_digest bytea NOT NULL CHECK (octet_length(actor_binding_digest)=32),
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN failure_code text,
  ADD CONSTRAINT invite_attempt_claimed CHECK (
    (status='reserved' AND claimed_at IS NULL) OR
    (status IN ('sending','sent','unknown') AND claimed_at IS NOT NULL) OR status='failed'
  ),
  ADD CONSTRAINT invite_attempt_failure_code CHECK (
    failure_code IS NULL OR failure_code IN
    ('not_claimed','cancelled_before_claim','config_disabled','smtp_rejected',
     'pre_data_failure','auth_rejected','uncertain','claim_timeout')
  );
-- base UNIQUE(invite_id,generation) replaced: Auth resend does not rotate group link
ALTER TABLE club_invite_private.send_attempts
  DROP CONSTRAINT send_attempts_invite_id_generation_key;
CREATE UNIQUE INDEX club_invite_group_generation
  ON club_invite_private.send_attempts(invite_id,generation)
  WHERE kind='group_invite';
CREATE UNIQUE INDEX club_invite_email_inflight
  ON club_invite_private.send_attempts(email_digest)
  WHERE status IN ('reserved','sending');
CREATE INDEX club_invite_global_window
  ON club_invite_private.send_attempts(reserved_at);
CREATE INDEX club_invite_expire_attempts
  ON club_invite_private.send_attempts(status,reserved_at,claimed_at)
  WHERE status IN ('reserved','sending');

-- One short-lived check ticket for either classification. Plain email is never in ticket.
ALTER TABLE club_invite_private.lookup_tickets
  ALTER COLUMN target_auth_id DROP NOT NULL,
  ADD COLUMN account_kind text NOT NULL
    CHECK (account_kind IN ('registered','signup_required')),
  ADD COLUMN consumed_operation_id uuid UNIQUE,
  ADD COLUMN result_link_id uuid,
  ADD CONSTRAINT invite_lookup_kind CHECK (
    (account_kind='registered')=(target_auth_id IS NOT NULL)),
  ADD CONSTRAINT invite_lookup_consumed CHECK (
    (consumed_at IS NULL)=(consumed_operation_id IS NULL));
CREATE INDEX club_invite_lookup_expiry ON club_invite_private.lookup_tickets(expires_at);

-- Dedicated lookup throttle; shared with all new invite check endpoints.
CREATE TABLE club_invite_private.lookup_limits (
  manager_auth_id uuid PRIMARY KEY,
  last_accepted_at timestamptz NOT NULL,
  accepted_at timestamptz[] NOT NULL CHECK (
    cardinality(accepted_at) BETWEEN 1 AND 20
    AND array_position(accepted_at,NULL::timestamptz) IS NULL)
);
-- Operational gate: default OFF, unset global budget cannot enable sending.
CREATE TABLE club_invite_private.settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  send_enabled boolean NOT NULL DEFAULT false,
  global_24h_limit integer CHECK (global_24h_limit>0),
  CHECK (NOT send_enabled OR global_24h_limit IS NOT NULL)
);
INSERT INTO club_invite_private.settings(singleton, global_24h_limit) VALUES(true, 200);
ALTER TABLE club_invite_private.lookup_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_invite_private.settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA club_invite_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- Approved cross-email claim (one invitation only, no additional OTP).
-- The original email digest stays immutable for quota/accounting.
ALTER TABLE club_invite_private.invitations
  ADD COLUMN bound_auth_id uuid,
  ADD COLUMN bound_email_digest bytea CHECK (bound_email_digest IS NULL OR octet_length(bound_email_digest)=32),
  ADD COLUMN bound_at timestamptz,
  ADD COLUMN bound_generation integer,
  ADD COLUMN bind_operation_id uuid UNIQUE,
  ADD CONSTRAINT invite_bound_all_or_none CHECK (
    (bound_auth_id IS NULL AND bound_email_digest IS NULL AND bound_at IS NULL
       AND bound_generation IS NULL AND bind_operation_id IS NULL)
    OR
    (bound_auth_id IS NOT NULL AND bound_email_digest IS NOT NULL AND bound_at IS NOT NULL
       AND bound_generation IS NOT NULL AND bind_operation_id IS NOT NULL
       AND bound_generation=generation AND bound_generation>0
       AND bound_at>=created_at AND bound_at<expires_at
       AND email_ciphertext IS NULL AND recovery_digest IS NULL)
  ),
  ADD CONSTRAINT invite_approved_bound_recipient CHECK (
    status <> 'approved' OR bound_auth_id IS NULL OR recipient_auth_id=bound_auth_id
  );
CREATE INDEX club_invite_bound_pending
  ON club_invite_private.invitations(bound_auth_id,expires_at)
  WHERE status='pending' AND bound_auth_id IS NOT NULL;
CREATE INDEX club_invite_email_pending
  ON club_invite_private.invitations(email_digest,expires_at)
  WHERE status='pending' AND bound_auth_id IS NULL;
-- No public RPCs, migration runner integration or secret provisioning yet.
-- No DDL here enables sending. Full helper functions and ACL review remain required.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION club_invite_private.quota_check(
  p_member uuid, p_email_digest bytea, p_manager uuid,
  p_club uuid, p_now timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d date := (p_now AT TIME ZONE 'Asia/Tokyo')::date;
        lim integer;
BEGIN
  PERFORM profile_link_private.serialize_operations();
  SELECT global_24h_limit INTO lim FROM club_invite_private.settings
    WHERE singleton AND send_enabled FOR SHARE;
  IF NOT FOUND OR lim IS NULL THEN RETURN 'disabled'; END IF;
  IF EXISTS(SELECT 1 FROM club_invite_private.send_attempts
    WHERE email_digest=p_email_digest AND status IN ('reserved','sending'))
    THEN RETURN 'inflight'; END IF;
  IF EXISTS(SELECT 1 FROM club_invite_private.send_attempts
    WHERE (member_id=p_member OR email_digest=p_email_digest)
      AND reserved_at>p_now-interval '60 seconds')
    THEN RETURN 'cooldown'; END IF;
  IF (SELECT count(*) FROM club_invite_private.send_attempts WHERE member_id=p_member AND day_jst=d)>=3
    THEN RETURN 'member_limit'; END IF;
  IF (SELECT count(*) FROM club_invite_private.send_attempts WHERE email_digest=p_email_digest AND day_jst=d)>=3
    THEN RETURN 'email_limit'; END IF;
  IF (SELECT count(*) FROM club_invite_private.send_attempts WHERE quota_manager_id=p_manager AND day_jst=d)>=10
    THEN RETURN 'manager_limit'; END IF;
  IF (SELECT count(*) FROM club_invite_private.send_attempts WHERE club_id=p_club AND day_jst=d)>=20
    THEN RETURN 'club_limit'; END IF;
  IF (SELECT count(*) FROM club_invite_private.send_attempts WHERE reserved_at>p_now-interval '24 hours')>=lim
    THEN RETURN 'global_limit'; END IF;
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION club_invite_private.quota_check(uuid,bytea,uuid,uuid,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE club_invite_private.send_attempts
 ADD COLUMN request_kind text NOT NULL
   CHECK(request_kind IN ('initial','group_resend','auth_resend')),
 ADD COLUMN reservation_auth_kind text NOT NULL
   CHECK(reservation_auth_kind IN ('manager','recipient','bearer')),
 ADD COLUMN reservation_actor_auth_id uuid,
 ADD CONSTRAINT invite_reservation_actor CHECK (
  (reservation_auth_kind='bearer' AND reservation_actor_auth_id IS NULL AND actor_kind='recipient')
  OR (reservation_auth_kind='recipient' AND reservation_actor_auth_id IS NOT NULL AND actor_kind='recipient')
  OR (reservation_auth_kind='manager' AND reservation_actor_auth_id IS NOT NULL AND actor_kind='manager'
      AND quota_manager_id=reservation_actor_auth_id)),
 ADD CONSTRAINT invite_request_kind CHECK (
  (kind='auth_confirmation')=(request_kind='auth_resend')
  AND (request_kind<>'initial' OR reservation_auth_kind='manager'));

-- Approved initial limits. Nullable values remain a fail-closed operational
-- switch; the hard review send-OFF gate below is unchanged. Worker trust
-- boundary must be verified before any activation. All settings are private.
ALTER TABLE club_invite_private.settings
 ADD COLUMN anonymous_ip_10m_limit integer DEFAULT 10 CHECK(anonymous_ip_10m_limit>0),
 ADD COLUMN anonymous_ref_10m_limit integer DEFAULT 3 CHECK(anonymous_ref_10m_limit>0);
CREATE TABLE club_invite_private.anonymous_limits(
 scope text NOT NULL CHECK(scope IN ('ip','invite')),
 subject_digest bytea NOT NULL CHECK(octet_length(subject_digest)=32),
 window_started_at timestamptz NOT NULL,
 attempt_count integer NOT NULL CHECK(attempt_count>0),
 PRIMARY KEY(scope,subject_digest));
ALTER TABLE club_invite_private.anonymous_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON club_invite_private.anonymous_limits FROM PUBLIC,anon,authenticated,service_role;


-- Store only a domain-separated keyed fingerprint of the rebind payload,
-- never the old bearer or a usable recovery digest after rebind.
ALTER TABLE club_invite_private.invitations
 ADD COLUMN bind_request_digest bytea CHECK(octet_length(bind_request_digest)=32),
 ADD CONSTRAINT invite_bind_request_present
 CHECK((bind_operation_id IS NULL)=(bind_request_digest IS NULL));


-- Stable per-decision replay identity, never a bearer credential.
-- Keep only keyed input fingerprint and the actual deciding account.
ALTER TABLE club_invite_private.invitations
 ADD COLUMN decision_operation_id uuid UNIQUE,
 ADD COLUMN decision_request_digest bytea CHECK(octet_length(decision_request_digest)=32),
 ADD CONSTRAINT invite_decision_operation_pair CHECK(
   (decision_operation_id IS NULL)=(decision_request_digest IS NULL)
   AND (decision_operation_id IS NULL OR (status IN ('approved','rejected')
     AND recipient_auth_id IS NOT NULL)));


CREATE FUNCTION club_invite_private.operation_taken(p_operation uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM club_invite_private.send_attempts WHERE operation_id=p_operation)
 OR EXISTS(SELECT 1 FROM club_invite_private.lookup_tickets WHERE consumed_operation_id=p_operation)
 OR EXISTS(SELECT 1 FROM club_invite_private.invitations
   WHERE bind_operation_id=p_operation OR decision_operation_id=p_operation);
$$;


-- Approved recovery: a terminal invite is never revived. Fresh authorized
-- check and send use a new invitation UUID/secret and retain all quota history.
-- No terminal bound-row tombstone is required after its audit retention.

-- Review-only activation gate: do not enable sending from this candidate.
ALTER TABLE club_invite_private.settings
 ADD CONSTRAINT club_invite_review_send_off CHECK (NOT send_enabled);

-- review candidate only, inside candidate 03 transaction, before ROLLBACK.
CREATE UNIQUE INDEX club_invite_member_inflight
  ON club_invite_private.send_attempts(member_id)
  WHERE status IN ('reserved','sending');

CREATE FUNCTION club_invite_private.settle_stale()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz;
BEGIN
  PERFORM profile_link_private.serialize_operations();
  v_now := clock_timestamp();
  UPDATE club_invite_private.send_attempts
     SET status='failed', finished_at=v_now, failure_code='not_claimed'
   WHERE status='reserved' AND reserved_at<=v_now-interval '2 minutes';
  UPDATE club_invite_private.send_attempts
     SET status='unknown', finished_at=v_now, failure_code='claim_timeout'
   WHERE status='sending' AND claimed_at<=v_now-interval '2 minutes';
  UPDATE club_invite_private.send_attempts a
     SET status='failed', finished_at=v_now, failure_code='cancelled_before_claim'
    FROM club_invite_private.invitations i
   WHERE a.invite_id=i.id AND a.status='reserved'
     AND (i.status<>'pending' OR i.expires_at<=v_now
          OR i.generation<>a.generation);
  UPDATE club_invite_private.invitations
     SET status='expired', decided_at=v_now,
         email_ciphertext=NULL, recovery_digest=NULL
   WHERE status='pending' AND expires_at<=v_now;
END $$;
REVOKE ALL ON FUNCTION club_invite_private.settle_stale()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.finalize_club_invite_send(
  p_operation_id uuid, p_generation integer,
  p_result text, p_failure_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_attempt club_invite_private.send_attempts%ROWTYPE;
        v_now timestamptz;
BEGIN
  IF p_operation_id IS NULL OR p_generation IS NULL OR p_generation<=0
    OR p_result IS NULL OR NOT (
      (p_result='sent' AND p_failure_code IS NULL)
      OR (p_result='failed' AND p_failure_code IS NOT NULL
          AND p_failure_code IN ('smtp_rejected','pre_data_failure','auth_rejected'))
      OR (p_result='unknown' AND p_failure_code IS NOT DISTINCT FROM 'uncertain')
    ) THEN RAISE SQLSTATE '22023' USING MESSAGE='Invalid delivery result'; END IF;
  PERFORM profile_link_private.serialize_operations();
  PERFORM club_invite_private.settle_stale();
  v_now:=clock_timestamp();
  SELECT * INTO v_attempt FROM club_invite_private.send_attempts
   WHERE operation_id=p_operation_id AND generation=p_generation FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF v_attempt.status<>'sending' THEN
    RETURN jsonb_build_object('status',v_attempt.status,'updated',false);
  END IF;
  IF (v_attempt.kind='auth_confirmation' AND p_failure_code IN ('smtp_rejected','pre_data_failure'))
     OR (v_attempt.kind='group_invite' AND p_failure_code='auth_rejected')
  THEN RAISE SQLSTATE '22023' USING MESSAGE='Invalid delivery result'; END IF;
  IF v_attempt.claimed_at<=v_now-interval '2 minutes' THEN
    UPDATE club_invite_private.send_attempts
       SET status='unknown',finished_at=v_now,failure_code='claim_timeout'
     WHERE operation_id=p_operation_id AND generation=p_generation AND status='sending';
    RETURN jsonb_build_object('status','unknown','updated',true);
  END IF;
  UPDATE club_invite_private.send_attempts
     SET status=p_result,finished_at=v_now,failure_code=p_failure_code
   WHERE operation_id=p_operation_id AND generation=p_generation AND status='sending';
  IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Stale operation'; END IF;
  RETURN jsonb_build_object('status',p_result,'updated',true);
END $$;
REVOKE ALL ON FUNCTION public.finalize_club_invite_send(uuid,integer,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_club_invite_send(uuid,integer,text,text)
  TO service_role;

-- Ensure no ordinary-match references are scoped by participant in one
-- club but by actual match in another/unknown club.
CREATE FUNCTION club_invite_private.ordinary_history_in_scope(p_source uuid,p_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(
  SELECT 1 FROM public.match_players mp
  JOIN public.event_participants ep ON ep.id=mp.participant_id
  LEFT JOIN public.matches m ON m.id=mp.match_id
  LEFT JOIN public.events e ON e.id=m.event_id
  WHERE ep.player_profile_id=p_source
   AND (e.club_id IS DISTINCT FROM p_club OR m.event_id IS DISTINCT FROM ep.event_id)
 );
$$;


-- Private only. Technical key names/encoding are candidate conventions.
-- Provision two independent random 32-byte keys as base64 in Vault separately.
-- Do not create or print any real secret in this migration or in tests.
CREATE FUNCTION club_invite_private.normalize_email(p_email text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v text:=lower(btrim(p_email));
BEGIN
 IF v IS NULL OR octet_length(v) NOT BETWEEN 3 AND 254
 OR v !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$'
 THEN RETURN NULL; END IF;
 RETURN v;
END $$;

CREATE FUNCTION club_invite_private.key_bytes(p_purpose text)
RETURNS bytea LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_h text; v_e text; h bytea; e bytea; n_h int; n_e int;
BEGIN
 SELECT count(*),max(decrypted_secret) INTO n_h,v_h
 FROM vault.decrypted_secrets WHERE name='padel_club_invite_hmac_v1';
 SELECT count(*),max(decrypted_secret) INTO n_e,v_e
 FROM vault.decrypted_secrets WHERE name='padel_club_invite_encryption_v1';
 IF n_h<>1 OR n_e<>1 OR v_h IS NULL OR v_e IS NULL
 THEN RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation configuration unavailable'; END IF;
 h:=decode(v_h,'base64'); e:=decode(v_e,'base64');
 IF octet_length(h)<>32 OR octet_length(e)<>32 OR h=e
 THEN RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation configuration unavailable'; END IF;
 IF p_purpose='hmac' THEN RETURN h;
 ELSIF p_purpose='encryption' THEN RETURN e;
 END IF;
 RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation configuration unavailable';
EXCEPTION WHEN OTHERS THEN
 RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation configuration unavailable';
END $$;

CREATE FUNCTION club_invite_private.email_hmac(p_email text)
RETURNS bytea LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text:=club_invite_private.normalize_email(p_email);
BEGIN
 IF v IS NULL THEN RETURN NULL; END IF;
 RETURN extensions.hmac(convert_to(v,'UTF8'),
   club_invite_private.key_bytes('hmac'),'sha256');
END $$;

CREATE FUNCTION club_invite_private.encrypt_email(p_email text)
RETURNS bytea LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text:=club_invite_private.normalize_email(p_email);
BEGIN
 IF v IS NULL THEN RAISE SQLSTATE '22023' USING MESSAGE='Invalid invitation address'; END IF;
 RETURN extensions.pgp_sym_encrypt(v,
   encode(club_invite_private.key_bytes('encryption'),'base64'),
   'cipher-algo=aes256,compress-algo=0,disable-mdc=0');
EXCEPTION WHEN OTHERS THEN
 RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation encryption unavailable';
END $$;

CREATE FUNCTION club_invite_private.decrypt_email(p_cipher bytea,p_digest bytea)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;
BEGIN
 IF p_cipher IS NULL OR p_digest IS NULL THEN
  RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation address unavailable';
 END IF;
 v:=extensions.pgp_sym_decrypt(p_cipher,
   encode(club_invite_private.key_bytes('encryption'),'base64'));
 IF club_invite_private.normalize_email(v) IS DISTINCT FROM v
 OR club_invite_private.email_hmac(v) IS DISTINCT FROM p_digest
 THEN RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation address unavailable'; END IF;
 RETURN v;
EXCEPTION WHEN OTHERS THEN
 RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation address unavailable';
END $$;

CREATE FUNCTION club_invite_private.new_secret()
RETURNS text LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT encode(extensions.gen_random_bytes(32),'hex');
$$;
CREATE FUNCTION club_invite_private.secret_hash(p_secret text)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_secret IS NULL OR length(p_secret)<>64 OR p_secret !~ '^[0-9a-f]{64}$'
 THEN RETURN NULL; END IF;
 RETURN extensions.digest(decode(p_secret,'hex'),'sha256');
END $$;

-- No plaintext address in terminal invitations. Mask generated only from
-- a verified decrypted pending address for an already authorized viewer.
CREATE FUNCTION club_invite_private.mask_email(p_email text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN club_invite_private.normalize_email(p_email) IS NULL THEN NULL
 ELSE left(split_part(p_email,'@',1),1)||'***@'||left(split_part(p_email,'@',2),1)||'***' END;
$$;

-- Actor is private and derived from real auth.uid() or server verified JWT.
-- Current role, club validity and target-role ceiling must be reevaluated.
CREATE FUNCTION club_invite_private.manager_ok(p_actor uuid,p_club uuid,p_member uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(p_actor IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.clubs c JOIN public.club_members m ON m.club_id=c.id
  WHERE c.id=p_club AND m.id=p_member AND c.is_active AND NOT coalesce(c.is_deleted,false)
    AND m.is_active AND m.status='active'
    AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor
      AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false)
      AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()))
    AND (profile_link_private.club_role(c.id,p_actor) IN ('super_user','main_admin')
      OR (profile_link_private.club_role(c.id,p_actor)='sub_admin' AND m.role<>'main_admin'))
 ),false);
$$;

-- Scope follows H08/H38 and H52. Does not modify existing routines/allowlist.
-- Refuse ALL memberships other than original (including inactive), legacy
-- ambiguous ownership, out-of-scope history or source private/media rows.
CREATE FUNCTION club_invite_private.source_in_scope(p_club uuid,p_member uuid,p_source uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(
   EXISTS(SELECT 1 FROM public.club_members m JOIN public.clubs c ON c.id=m.club_id
    JOIN public.player_profiles p ON p.id=m.player_profile_id
    WHERE m.id=p_member AND m.club_id=p_club AND p.id=p_source
      AND c.is_active AND NOT coalesce(c.is_deleted,false)
      AND m.is_active AND m.status='active' AND m.profile_id IS NULL
      AND p.is_active AND p.linked_auth_user_id IS NULL)
   AND NOT EXISTS(SELECT 1 FROM public.club_members m WHERE m.player_profile_id=p_source AND m.id<>p_member)
   AND NOT EXISTS(SELECT 1 FROM public.event_participants ep
     LEFT JOIN public.events e ON e.id=ep.event_id
     WHERE ep.player_profile_id=p_source AND e.club_id IS DISTINCT FROM p_club)
   AND NOT EXISTS(SELECT 1 FROM public.join_requests j WHERE j.requester_player_profile_id=p_source)
   AND club_invite_private.ordinary_history_in_scope(p_source,p_club)
   AND NOT EXISTS(SELECT 1 FROM public.event_team_matches t
     CROSS JOIN LATERAL (VALUES
      (t.team_a_player1_profile_id,coalesce(t.team_a_player1_source_side,'team_a')),
      (t.team_a_player2_profile_id,coalesce(t.team_a_player2_source_side,'team_a')),
      (t.team_b_player1_profile_id,coalesce(t.team_b_player1_source_side,'team_b')),
      (t.team_b_player2_profile_id,coalesce(t.team_b_player2_source_side,'team_b'))
     ) slot(profile_id,source_side)
     WHERE slot.profile_id=p_source
       AND NOT EXISTS(SELECT 1 FROM public.event_team_sides s
        WHERE s.event_id=t.event_id AND s.side=slot.source_side AND s.club_id=p_club))
   AND NOT EXISTS(SELECT 1 FROM public.official_matches m LEFT JOIN public.official_events e ON e.id=m.official_event_id
     WHERE p_source IN(m.our_player1_profile_id,m.our_player2_profile_id) AND e.club_id IS DISTINCT FROM p_club)
   AND NOT EXISTS(SELECT 1 FROM public.player_profile_private WHERE profile_id=p_source)
   AND NOT EXISTS(SELECT 1 FROM public.profile_media_objects WHERE profile_id=p_source)
   AND NOT EXISTS(SELECT 1 FROM public.profile_media_operations WHERE profile_id=p_source)
   AND NOT EXISTS(SELECT 1 FROM public.player_profile_merges WHERE source_player_profile_id=p_source AND restored_at IS NULL)
 ,false);
$$;

CREATE FUNCTION club_invite_private.source_available(p_club uuid,p_member uuid,p_source uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT club_invite_private.source_in_scope(p_club,p_member,p_source)
 AND NOT EXISTS(SELECT 1 FROM public.player_profile_link_requests r
  WHERE r.source_player_profile_id=p_source AND r.status='pending' AND r.expires_at>clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.join_requests j WHERE j.consent_source_player_profile_id=p_source
  AND j.status='pending' AND coalesce(j.expires_at,j.created_at+interval '7 days')>clock_timestamp());
$$;

-- Require actual confirmed current Auth address AND existing profile.
-- For mutations lock Auth row to prevent concurrent email changes.
-- Call under the shared serialization lock. Canonical must be unique.
CREATE FUNCTION club_invite_private.recipient_identity(p_actor uuid)
RETURNS TABLE(actor_id uuid,canonical_id uuid,current_email_digest bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text; v_pid uuid;
BEGIN
 IF p_actor IS NULL THEN RETURN; END IF;
 SELECT u.email INTO v_email FROM auth.users u JOIN public.profiles p ON p.id=u.id
 WHERE u.id=p_actor AND u.email_confirmed_at IS NOT NULL
   AND NOT coalesce(u.is_anonymous,false) AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()) FOR SHARE OF u;
 IF NOT FOUND OR club_invite_private.normalize_email(v_email) IS NULL THEN RETURN; END IF;
 v_pid:=profile_link_private.canonical(p_actor);
 IF v_pid IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT p_actor,v_pid,club_invite_private.email_hmac(v_email);
END $$;

CREATE FUNCTION club_invite_private.recipient_matches(
 p_inv club_invite_private.invitations,p_actor uuid,p_digest bytea
) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(p_actor IS NOT NULL AND p_digest IS NOT NULL AND
   CASE WHEN p_inv.bound_auth_id IS NULL THEN p_digest=p_inv.email_digest
     ELSE p_inv.bound_auth_id=p_actor AND p_inv.bound_email_digest=p_digest
       AND p_inv.bound_generation=p_inv.generation END,false);
$$;

CREATE FUNCTION club_invite_private.invite_usable(
 p_inv club_invite_private.invitations,p_generation integer
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(p_inv.id IS NOT NULL AND p_inv.status='pending'
   AND p_inv.generation=p_generation AND p_inv.generation>0
   AND p_inv.expires_at>clock_timestamp()
   AND club_invite_private.manager_ok(p_inv.inviter_auth_id,p_inv.club_id,p_inv.member_id)
   AND club_invite_private.source_available(p_inv.club_id,p_inv.member_id,p_inv.source_profile_id),false);
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private
 FROM PUBLIC,anon,authenticated,service_role;

-- Internal classification only: exact normalized address, no listing.
-- One confirmed account missing its app profile, or duplicate Auth rows:
-- fail closed instead of creating a signup invite to an ambiguous account.
CREATE FUNCTION club_invite_private.classify_account(p_email text)
RETURNS TABLE(account_kind text,target_auth_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_confirmed boolean; v_count integer; v_usable boolean;
        v_email text:=club_invite_private.normalize_email(p_email);
BEGIN
 IF v_email IS NULL THEN RETURN QUERY SELECT 'conflict'::text,NULL::uuid; RETURN; END IF;
 SELECT count(*) INTO v_count FROM auth.users u WHERE lower(u.email)=v_email;
 IF v_count>1 THEN RETURN QUERY SELECT 'conflict'::text,NULL::uuid; RETURN; END IF;
 IF v_count=0 THEN RETURN QUERY SELECT 'signup_required'::text,NULL::uuid; RETURN; END IF;
 BEGIN
  SELECT u.id,u.email_confirmed_at IS NOT NULL,
   NOT coalesce(u.is_anonymous,false) AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
  INTO STRICT v_id,v_confirmed,v_usable
  FROM auth.users u WHERE lower(u.email)=v_email FOR SHARE;
 EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RETURN QUERY SELECT 'conflict'::text,NULL::uuid; RETURN;
 END;
 IF v_usable IS NOT TRUE THEN RETURN QUERY SELECT 'conflict'::text,NULL::uuid; RETURN; END IF;
 IF v_confirmed THEN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_id) THEN
   RETURN QUERY SELECT 'conflict'::text,NULL::uuid; RETURN;
  END IF;
  RETURN QUERY SELECT 'registered'::text,v_id;
 ELSE
  RETURN QUERY SELECT 'signup_required'::text,NULL::uuid;
 END IF;
END $$;

-- Approved interpretation of 20 per 10 minutes: at most 20 accepted
-- lookups in any rolling ten-minute window (start exclusive).
-- One bounded timestamp array per manager, no email or target information.
-- All new invite check calls share the existing serialization lock.
-- Consume invalid authorized attempts too. Do not throw on limit denial.
CREATE FUNCTION club_invite_private.take_lookup(p_actor uuid,p_now timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $lookup_rolling$
DECLARE v_times timestamptz[]; v_now timestamptz; v_recent timestamptz[];
BEGIN
 IF p_actor IS NULL OR p_now IS NULL THEN RETURN false; END IF;
 PERFORM profile_link_private.serialize_operations();
 v_now:=clock_timestamp();
 INSERT INTO club_invite_private.lookup_limits(manager_auth_id,last_accepted_at,accepted_at)
 VALUES(p_actor,v_now,ARRAY[v_now])
 ON CONFLICT(manager_auth_id) DO NOTHING;
 IF FOUND THEN RETURN true; END IF;
 SELECT accepted_at INTO v_times FROM club_invite_private.lookup_limits
 WHERE manager_auth_id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 v_now:=clock_timestamp();
 SELECT coalesce(array_agg(t ORDER BY t),ARRAY[]::timestamptz[]) INTO v_recent
 FROM unnest(v_times) AS times(t) WHERE t>v_now-interval '10 minutes';
 IF cardinality(v_recent)>=20 THEN RETURN false; END IF;
 UPDATE club_invite_private.lookup_limits
 SET accepted_at=array_append(v_recent,v_now),last_accepted_at=v_now
 WHERE manager_auth_id=p_actor;
 RETURN FOUND;
END $lookup_rolling$;

CREATE FUNCTION public.check_club_invite_account(p_club uuid,p_member uuid,p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_source uuid; v_email text; v_now timestamptz;
 v_kind text; v_target uuid; v_secret text; v_digest bytea;
BEGIN
 IF v_actor IS NULL OR NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 IF NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_now:=clock_timestamp();
 -- consume before address lookup; invalid input also counts for an authorized target.
 IF NOT club_invite_private.take_lookup(v_actor,v_now)
 THEN RETURN jsonb_build_object('status','lookup_limit'); END IF;
 BEGIN
 v_email:=club_invite_private.normalize_email(p_email);
 IF v_email IS NULL THEN RETURN jsonb_build_object('status','invalid'); END IF;
 -- Settle elapsed invitations before issuing a new check ticket.
 PERFORM club_invite_private.settle_stale();
 v_now:=clock_timestamp();
 SELECT player_profile_id INTO v_source FROM public.club_members WHERE id=p_member AND club_id=p_club;
 IF v_source IS NULL OR NOT club_invite_private.source_available(p_club,p_member,v_source)
 OR EXISTS(SELECT 1 FROM club_invite_private.invitations i WHERE i.source_profile_id=v_source
      AND i.status='pending' AND i.expires_at>v_now)
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 -- Local exception block preserves outer lookup counter if source check,
 -- classification, Vault or insert fails; never expose input or SQLERRM.
  SELECT a.account_kind,a.target_auth_id INTO v_kind,v_target
    FROM club_invite_private.classify_account(v_email) a;
  IF v_kind NOT IN ('registered','signup_required') OR v_kind IS NULL
     OR v_target=v_actor
  THEN RETURN jsonb_build_object('status','conflict'); END IF;
  v_digest:=club_invite_private.email_hmac(v_email);
  v_secret:=club_invite_private.new_secret();
  INSERT INTO club_invite_private.lookup_tickets(ticket_digest,manager_auth_id,club_id,member_id,
    source_profile_id,target_auth_id,email_digest,expires_at,account_kind)
  VALUES(club_invite_private.secret_hash(v_secret),v_actor,p_club,p_member,
    v_source,v_target,v_digest,clock_timestamp()+interval '5 minutes',v_kind);
  RETURN jsonb_build_object('status',v_kind,'ticket',v_secret);
 EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','unavailable');
 END;
END $$;

-- Registered route only. For signup_required the service-only reserve
-- RPC will consume the same ticket atomically with the first send attempt.
CREATE FUNCTION public.consume_club_invite_lookup(
 p_club uuid,p_member uuid,p_email text,p_ticket text,
 p_operation_id uuid,p_confirm_registered boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_t club_invite_private.lookup_tickets%ROWTYPE;
 v_hash bytea; v_mail_digest bytea; v_kind text; v_target uuid; v_link uuid;
BEGIN
 IF v_actor IS NULL OR p_operation_id IS NULL OR p_confirm_registered IS NOT TRUE
    OR NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_hash:=club_invite_private.secret_hash(p_ticket);
 IF v_hash IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT * INTO v_t FROM club_invite_private.lookup_tickets t
 WHERE t.ticket_digest=v_hash AND t.manager_auth_id=v_actor
  AND t.club_id=p_club AND t.member_id=p_member FOR UPDATE;
 IF NOT FOUND OR v_t.account_kind<>'registered'
   OR NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_mail_digest:=club_invite_private.email_hmac(p_email);
 IF v_mail_digest IS NULL OR v_mail_digest IS DISTINCT FROM v_t.email_digest
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT a.account_kind,a.target_auth_id INTO v_kind,v_target
   FROM club_invite_private.classify_account(p_email) a;
 IF v_kind IS DISTINCT FROM 'registered' OR v_target IS DISTINCT FROM v_t.target_auth_id
   OR v_target=v_actor
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 IF v_t.consumed_at IS NOT NULL THEN
  IF v_t.consumed_operation_id=p_operation_id AND v_t.result_link_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.player_profile_link_requests r
       WHERE r.id=v_t.result_link_id AND r.club_id=p_club AND r.source_club_member_id=p_member
         AND r.source_player_profile_id=v_t.source_profile_id
         AND r.target_auth_user_id=v_target AND r.requested_by_auth_user_id=v_actor)
  THEN RETURN jsonb_build_object('status','requested','link_id',v_t.result_link_id); END IF;
  RETURN jsonb_build_object('status','conflict');
 END IF;
 IF v_t.expires_at<=clock_timestamp()
   OR NOT club_invite_private.source_available(p_club,p_member,v_t.source_profile_id)
   OR EXISTS(SELECT 1 FROM club_invite_private.invitations i
     WHERE i.source_profile_id=v_t.source_profile_id AND i.status='pending' AND i.expires_at>clock_timestamp())
   OR club_invite_private.operation_taken(p_operation_id)
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 -- Existing RPC checks real auth.uid(), target and current role again,
 -- creates request and notification. Never spoof JWT or create a direct merge.
 BEGIN
  v_link:=public.request_player_profile_link(p_club,p_member,v_target);
  IF v_link IS NULL OR NOT EXISTS(SELECT 1 FROM public.player_profile_link_requests r
    WHERE r.id=v_link AND r.club_id=p_club AND r.source_club_member_id=p_member
     AND r.source_player_profile_id=v_t.source_profile_id
     AND r.requested_by_auth_user_id=v_actor AND r.target_auth_user_id=v_target
     AND r.status='pending')
  THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
  UPDATE club_invite_private.lookup_tickets
   SET consumed_at=clock_timestamp(),consumed_operation_id=p_operation_id,result_link_id=v_link
   WHERE ticket_digest=v_hash AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
  RETURN jsonb_build_object('status','requested','link_id',v_link);
 EXCEPTION WHEN OTHERS THEN
  -- Subtransaction rolls back both request and notification on any failure.
  RETURN jsonb_build_object('status','conflict');
 END;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.check_club_invite_account(uuid,uuid,text),
 public.consume_club_invite_lookup(uuid,uuid,text,text,uuid,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.check_club_invite_account(uuid,uuid,text),
 public.consume_club_invite_lookup(uuid,uuid,text,text,uuid,boolean)
 TO authenticated;

CREATE FUNCTION club_invite_private.request_fingerprint(p_value jsonb)
RETURNS bytea LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT extensions.hmac(convert_to('invite-request-v1:'||p_value::text,'UTF8'),
   club_invite_private.key_bytes('hmac'),'sha256');
$$;

CREATE FUNCTION club_invite_private.take_anonymous_limit(
 p_scope text,p_digest bytea,p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_lim integer; v_count integer;
BEGIN
 IF p_scope IS NULL OR p_scope NOT IN ('ip','invite') OR p_digest IS NULL
 OR octet_length(p_digest)<>32 OR p_now IS NULL THEN RETURN false; END IF;
 SELECT CASE WHEN p_scope='ip' THEN anonymous_ip_10m_limit ELSE anonymous_ref_10m_limit END
 INTO v_lim FROM club_invite_private.settings WHERE singleton AND send_enabled FOR SHARE;
 IF NOT FOUND OR v_lim IS NULL THEN RETURN false; END IF;
 INSERT INTO club_invite_private.anonymous_limits(scope,subject_digest,window_started_at,attempt_count)
 VALUES(p_scope,p_digest,p_now,1)
 ON CONFLICT(scope,subject_digest) DO UPDATE SET
  attempt_count=CASE WHEN club_invite_private.anonymous_limits.window_started_at<=p_now-interval '10 minutes'
   THEN 1 ELSE club_invite_private.anonymous_limits.attempt_count+1 END,
  window_started_at=CASE WHEN club_invite_private.anonymous_limits.window_started_at<=p_now-interval '10 minutes'
   THEN p_now ELSE club_invite_private.anonymous_limits.window_started_at END
 WHERE club_invite_private.anonymous_limits.window_started_at<=p_now-interval '10 minutes'
   OR club_invite_private.anonymous_limits.attempt_count<v_lim
 RETURNING attempt_count INTO v_count;
 RETURN FOUND AND v_count<=v_lim;
END $$;

CREATE FUNCTION club_invite_private.send_quota(
 p_member uuid,p_digest bytea,p_manager uuid,p_club uuid,p_now timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM club_invite_private.send_attempts
 WHERE member_id=p_member AND status IN ('reserved','sending')) THEN RETURN 'inflight'; END IF;
 RETURN club_invite_private.quota_check(p_member,p_digest,p_manager,p_club,p_now);
END $$;

-- Only a single existing unconfirmed account may receive Auth signup resend.
CREATE FUNCTION club_invite_private.auth_resend_ok(p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(*)=1 AND coalesce(bool_and(u.email_confirmed_at IS NULL
   AND NOT coalesce(u.is_anonymous,false) AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())),false)
 FROM auth.users u WHERE lower(u.email)=club_invite_private.normalize_email(p_email);
$$;

CREATE FUNCTION public.reserve_club_invite_send(
 p_actor uuid,p_club uuid,p_member uuid,p_operation_id uuid,p_ticket text,p_email text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_t club_invite_private.lookup_tickets%ROWTYPE;
 v_a club_invite_private.send_attempts%ROWTYPE; v_id uuid;
 v_now timestamptz; v_email text; v_digest bytea; v_ticket_hash bytea;
 v_actor_digest bytea; v_request bytea; v_kind text; v_quota text;
BEGIN
 IF p_actor IS NULL OR p_operation_id IS NULL
 OR NOT club_invite_private.manager_ok(p_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 v_now:=clock_timestamp();
 IF NOT club_invite_private.manager_ok(p_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_email:=club_invite_private.normalize_email(p_email);
 v_ticket_hash:=club_invite_private.secret_hash(p_ticket);
 IF v_email IS NULL OR v_ticket_hash IS NULL THEN RETURN jsonb_build_object('status','invalid'); END IF;
 v_digest:=club_invite_private.email_hmac(v_email);
 SELECT * INTO v_t FROM club_invite_private.lookup_tickets
 WHERE ticket_digest=v_ticket_hash AND manager_auth_id=p_actor
  AND club_id=p_club AND member_id=p_member FOR UPDATE;
 IF NOT FOUND OR v_t.account_kind<>'signup_required' OR v_t.email_digest IS DISTINCT FROM v_digest
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_actor_digest:=club_invite_private.request_fingerprint(jsonb_build_array('manager',p_actor));
 v_request:=club_invite_private.request_fingerprint(jsonb_build_array('initial',p_club,p_member,
    encode(v_ticket_hash,'hex'),encode(v_digest,'hex'),p_operation_id));
 IF v_t.consumed_at IS NOT NULL THEN
  SELECT * INTO v_a FROM club_invite_private.send_attempts WHERE operation_id=p_operation_id;
  IF FOUND AND v_t.consumed_operation_id=p_operation_id AND v_a.request_digest=v_request
   AND v_a.actor_binding_digest=v_actor_digest
  THEN RETURN jsonb_build_object('status',v_a.status,'operation_id',p_operation_id,'invite_id',v_a.invite_id,'generation',v_a.generation); END IF;
  RETURN jsonb_build_object('status','conflict');
 END IF;
 IF v_t.expires_at<=v_now OR club_invite_private.operation_taken(p_operation_id)
 OR NOT club_invite_private.source_available(p_club,p_member,v_t.source_profile_id)
 OR EXISTS(SELECT 1 FROM club_invite_private.invitations
   WHERE status='pending' AND (member_id=p_member OR source_profile_id=v_t.source_profile_id))
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 SELECT account_kind INTO v_kind FROM club_invite_private.classify_account(v_email);
 IF v_kind IS DISTINCT FROM 'signup_required'
 THEN RETURN jsonb_build_object('status','recheck_required'); END IF;
 v_now:=clock_timestamp();
 IF v_t.expires_at<=v_now OR NOT club_invite_private.manager_ok(p_actor,p_club,p_member)
 OR NOT club_invite_private.source_available(p_club,p_member,v_t.source_profile_id)
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 v_quota:=club_invite_private.send_quota(p_member,v_digest,p_actor,p_club,v_now);
 -- Do not disclose destination/global quota reasons or other-group activity.
 IF v_quota<>'ok' THEN RETURN jsonb_build_object('status','temporarily_unavailable'); END IF;
 INSERT INTO club_invite_private.invitations(club_id,member_id,source_profile_id,inviter_auth_id,
  email_digest,email_ciphertext,generation,created_at,expires_at)
 VALUES(p_club,p_member,v_t.source_profile_id,p_actor,v_digest,
  club_invite_private.encrypt_email(v_email),1,v_now,v_now+interval '168 hours')
 RETURNING id INTO v_id;
 INSERT INTO club_invite_private.send_attempts(operation_id,invite_id,club_id,member_id,
  quota_manager_id,email_digest,generation,actor_kind,reserved_at,day_jst,
  kind,request_digest,actor_binding_digest,request_kind,reservation_auth_kind,reservation_actor_auth_id)
 VALUES(p_operation_id,v_id,p_club,p_member,p_actor,v_digest,1,'manager',v_now,
  (v_now AT TIME ZONE 'Asia/Tokyo')::date,'group_invite',v_request,v_actor_digest,'initial','manager',p_actor);
 UPDATE club_invite_private.lookup_tickets SET consumed_at=v_now,consumed_operation_id=p_operation_id
 WHERE ticket_digest=v_ticket_hash AND consumed_at IS NULL;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 RETURN jsonb_build_object('status','reserved','operation_id',p_operation_id,'invite_id',v_id,'generation',1);
END $$;

-- A single service-only RPC for group mail or Auth confirmation resend.
-- p_mode selected by the server route, never caller-controlled identity.
-- No p_email: only the encrypted original address can be used.
CREATE FUNCTION public.reserve_club_invite_resend(
 p_actor uuid,p_mode text,p_invite uuid,p_generation integer,p_operation_id uuid,
 p_kind text,p_secret text DEFAULT NULL,p_ip_digest bytea DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_i club_invite_private.invitations%ROWTYPE; v_a club_invite_private.send_attempts%ROWTYPE;
 v_now timestamptz; v_email text; v_actor_digest bytea; v_request bytea;
 v_current_digest bytea; v_secret_digest bytea; v_quota text; v_manager uuid;
 v_generation integer; v_kind text; v_request_kind text; v_actor_kind text; v_class text;
BEGIN
 IF p_mode IS NULL OR p_mode NOT IN ('manager','recipient','bearer')
 OR p_kind IS NULL OR p_kind NOT IN ('group_invite','auth_confirmation')
 OR p_operation_id IS NULL OR p_invite IS NULL OR p_generation IS NULL OR p_generation<=0
 OR (p_mode='bearer' AND p_actor IS NOT NULL) OR (p_mode<>'bearer' AND p_actor IS NULL)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 v_now:=clock_timestamp();
 IF p_mode='bearer' THEN
  IF NOT club_invite_private.take_anonymous_limit('ip',p_ip_digest,v_now)
  THEN RETURN jsonb_build_object('status','not_found'); END IF;
  v_secret_digest:=club_invite_private.secret_hash(p_secret);
  IF v_secret_digest IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 ELSE
  IF p_secret IS NOT NULL OR p_ip_digest IS NOT NULL
  THEN RETURN jsonb_build_object('status','invalid'); END IF;
 END IF;
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF p_mode='manager' THEN
  IF NOT club_invite_private.manager_ok(p_actor,v_i.club_id,v_i.member_id)
  THEN RETURN jsonb_build_object('status','not_found'); END IF;
  v_manager:=p_actor; v_actor_kind:='manager';
 ELSIF p_mode='recipient' THEN
  SELECT current_email_digest INTO v_current_digest FROM club_invite_private.recipient_identity(p_actor);
  IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,p_actor,v_current_digest)
  THEN RETURN jsonb_build_object('status','not_found'); END IF;
  v_manager:=v_i.inviter_auth_id; v_actor_kind:='recipient';
 ELSE
  IF v_i.status<>'pending' OR v_i.generation<>p_generation OR v_i.bound_auth_id IS NOT NULL
  OR v_i.expires_at<=v_now OR v_i.recovery_digest IS DISTINCT FROM v_secret_digest
  THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF NOT club_invite_private.take_anonymous_limit('invite',
    club_invite_private.request_fingerprint(jsonb_build_array('anonymous-invite',v_i.id)),v_now)
  THEN RETURN jsonb_build_object('status','not_found'); END IF;
  v_manager:=v_i.inviter_auth_id; v_actor_kind:='recipient';
 END IF;
 v_actor_digest:=club_invite_private.request_fingerprint(jsonb_build_array(p_mode,p_actor,encode(v_secret_digest,'hex')));
 v_request:=club_invite_private.request_fingerprint(jsonb_build_array('resend',p_mode,p_invite,p_generation,p_kind,p_operation_id));
 -- Authenticated retries may see the already advanced generation, but can
 -- never schedule a second mail. An old anonymous bearer gets neutral denial.
 SELECT * INTO v_a FROM club_invite_private.send_attempts WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF v_a.invite_id=p_invite AND v_a.request_digest=v_request AND v_a.actor_binding_digest=v_actor_digest
  THEN RETURN jsonb_build_object('status',v_a.status,'operation_id',p_operation_id,'invite_id',v_a.invite_id,'generation',v_a.generation); END IF;
  RETURN jsonb_build_object('status','not_found');
 END IF;
 IF club_invite_private.operation_taken(p_operation_id)
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 OR v_i.bound_auth_id IS NOT NULL OR v_i.email_ciphertext IS NULL
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_email:=club_invite_private.decrypt_email(v_i.email_ciphertext,v_i.email_digest);
 SELECT account_kind INTO v_class FROM club_invite_private.classify_account(v_email);
 IF v_class IS NULL OR v_class='conflict' THEN RETURN jsonb_build_object('status','conflict'); END IF;
 IF p_kind='auth_confirmation' AND NOT club_invite_private.auth_resend_ok(v_email)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_now:=clock_timestamp();
 IF NOT club_invite_private.invite_usable(v_i,p_generation)
 OR (p_mode='manager' AND NOT club_invite_private.manager_ok(p_actor,v_i.club_id,v_i.member_id))
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_quota:=club_invite_private.send_quota(v_i.member_id,v_i.email_digest,v_manager,v_i.club_id,v_now);
 IF v_quota<>'ok' THEN
  -- Anonymous invalid/limited requests remain indistinguishable; logged-in
  -- callers receive no cross-group quota reason.
  RETURN jsonb_build_object('status',CASE WHEN p_mode='bearer' THEN 'not_found' ELSE 'temporarily_unavailable' END);
 END IF;
 v_generation:=v_i.generation; v_kind:=p_kind;
 IF p_kind='group_invite' THEN
  v_generation:=v_generation+1; v_request_kind:='group_resend';
  UPDATE club_invite_private.invitations SET generation=v_generation,recovery_digest=NULL
   WHERE id=v_i.id AND status='pending' AND generation=p_generation AND bound_auth_id IS NULL;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 ELSE v_request_kind:='auth_resend'; END IF;
 INSERT INTO club_invite_private.send_attempts(operation_id,invite_id,club_id,member_id,
   quota_manager_id,email_digest,generation,actor_kind,reserved_at,day_jst,kind,
   request_digest,actor_binding_digest,request_kind,reservation_auth_kind,reservation_actor_auth_id)
 VALUES(p_operation_id,v_i.id,v_i.club_id,v_i.member_id,v_manager,v_i.email_digest,v_generation,
   v_actor_kind,v_now,(v_now AT TIME ZONE 'Asia/Tokyo')::date,v_kind,
   v_request,v_actor_digest,v_request_kind,p_mode,p_actor);
 RETURN jsonb_build_object('status','reserved','operation_id',p_operation_id,'invite_id',v_i.id,'generation',v_generation);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.reserve_club_invite_send(uuid,uuid,uuid,uuid,text,text),
 public.reserve_club_invite_resend(uuid,text,uuid,integer,uuid,text,text,bytea)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_club_invite_send(uuid,uuid,uuid,uuid,text,text),
 public.reserve_club_invite_resend(uuid,text,uuid,integer,uuid,text,text,bytea)
 TO service_role;

-- Private helper for invalidated reservations. Never updates the invite or
-- makes a previously claimed send available again.
CREATE FUNCTION club_invite_private.fail_reservation(p_operation uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_code IS NULL OR p_code NOT IN ('cancelled_before_claim','config_disabled','not_claimed')
 THEN RAISE SQLSTATE '22023' USING MESSAGE='Invalid reservation result'; END IF;
 UPDATE club_invite_private.send_attempts SET status='failed',finished_at=clock_timestamp(),failure_code=p_code
 WHERE operation_id=p_operation AND status='reserved';
 RETURN jsonb_build_object('status','not_claimable');
END $$;

CREATE FUNCTION public.claim_club_invite_send(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_a club_invite_private.send_attempts%ROWTYPE; v_i club_invite_private.invitations%ROWTYPE;
 v_now timestamptz; v_email text; v_secret text; v_digest bytea; v_kind text;
 v_club_name text; v_member_name text; v_inviter_name text;
 v_enabled boolean; v_expected_binding bytea;
BEGIN
 IF p_operation_id IS NULL THEN RETURN jsonb_build_object('status','not_claimable'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT * INTO v_a FROM club_invite_private.send_attempts
  WHERE operation_id=p_operation_id FOR UPDATE;
 IF NOT FOUND OR v_a.status<>'reserved'
 THEN RETURN jsonb_build_object('status','not_claimable'); END IF;
 SELECT send_enabled AND global_24h_limit IS NOT NULL INTO v_enabled
 FROM club_invite_private.settings WHERE singleton FOR SHARE;
 IF v_enabled IS NOT TRUE THEN
  RETURN club_invite_private.fail_reservation(p_operation_id,'config_disabled'); END IF;
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=v_a.invite_id FOR UPDATE;
 IF NOT FOUND OR NOT club_invite_private.invite_usable(v_i,v_a.generation)
 OR v_i.bound_auth_id IS NOT NULL OR v_i.email_ciphertext IS NULL
 OR v_i.club_id IS DISTINCT FROM v_a.club_id OR v_i.member_id IS DISTINCT FROM v_a.member_id
 OR v_i.email_digest IS DISTINCT FROM v_a.email_digest
 THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
 -- Recheck current reservation actor. Original inviter rights are separately
 -- checked by invite_usable. No spoofed auth.uid() or external actor input.
 IF v_a.reservation_auth_kind='manager' THEN
  IF NOT club_invite_private.manager_ok(v_a.reservation_actor_auth_id,v_i.club_id,v_i.member_id)
  OR v_a.quota_manager_id IS DISTINCT FROM v_a.reservation_actor_auth_id
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
  v_expected_binding:=club_invite_private.request_fingerprint(
    CASE WHEN v_a.request_kind='initial'
     THEN jsonb_build_array('manager',v_a.reservation_actor_auth_id)
     ELSE jsonb_build_array('manager',v_a.reservation_actor_auth_id,NULL::text) END);
  IF v_expected_binding IS DISTINCT FROM v_a.actor_binding_digest
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
 ELSIF v_a.reservation_auth_kind='recipient' THEN
  SELECT current_email_digest INTO v_digest
  FROM club_invite_private.recipient_identity(v_a.reservation_actor_auth_id);
  IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,v_a.reservation_actor_auth_id,v_digest)
  OR v_a.quota_manager_id IS DISTINCT FROM v_i.inviter_auth_id
  OR v_a.actor_binding_digest IS DISTINCT FROM club_invite_private.request_fingerprint(
    jsonb_build_array('recipient',v_a.reservation_actor_auth_id,NULL::text))
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
 ELSIF v_a.reservation_auth_kind='bearer' THEN
  IF v_a.quota_manager_id IS DISTINCT FROM v_i.inviter_auth_id
  OR NOT EXISTS(SELECT 1 FROM club_invite_private.settings WHERE singleton
      AND anonymous_ip_10m_limit IS NOT NULL AND anonymous_ref_10m_limit IS NOT NULL)
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
  -- Auth resend retains the exact bearer generation. Group resend already
  -- consumed old generation at reservation, and cannot validate it again.
  IF v_a.kind='auth_confirmation' AND (v_i.recovery_digest IS NULL
     OR v_a.actor_binding_digest IS DISTINCT FROM club_invite_private.request_fingerprint(
          jsonb_build_array('bearer',NULL::uuid,encode(v_i.recovery_digest,'hex'))))
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
 ELSE RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;

 -- Secret/key/config or current account drift must stop the claim.
 BEGIN
  v_email:=club_invite_private.decrypt_email(v_i.email_ciphertext,v_i.email_digest);
  SELECT account_kind INTO v_kind FROM club_invite_private.classify_account(v_email);
  IF v_kind IS NULL OR v_kind='conflict'
     OR (v_a.request_kind='initial' AND v_kind IS DISTINCT FROM 'signup_required')
     OR (v_a.kind='auth_confirmation' AND NOT club_invite_private.auth_resend_ok(v_email))
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
  IF v_a.kind='group_invite' THEN
   SELECT c.name,coalesce(m.club_display_name,s.display_name),
      coalesce(p.display_name,'グループ管理者')
   INTO v_club_name,v_member_name,v_inviter_name
   FROM public.clubs c JOIN public.club_members m ON m.club_id=c.id
   JOIN public.player_profiles s ON s.id=m.player_profile_id
   LEFT JOIN public.profiles p ON p.id=v_i.inviter_auth_id
   WHERE c.id=v_i.club_id AND m.id=v_i.member_id AND s.id=v_i.source_profile_id;
   IF NOT FOUND OR nullif(btrim(v_club_name),'') IS NULL OR nullif(btrim(v_member_name),'') IS NULL
   THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
   v_secret:=club_invite_private.new_secret();
  END IF;
 EXCEPTION WHEN OTHERS THEN
  RETURN club_invite_private.fail_reservation(p_operation_id,'config_disabled');
 END;
 v_now:=clock_timestamp();
 IF v_a.reserved_at<=v_now-interval '2 minutes'
 THEN RETURN club_invite_private.fail_reservation(p_operation_id,'not_claimed'); END IF;
 IF v_i.expires_at<=v_now
 THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
 IF v_a.kind='group_invite' THEN
  UPDATE club_invite_private.invitations SET recovery_digest=club_invite_private.secret_hash(v_secret)
   WHERE id=v_i.id AND status='pending' AND generation=v_a.generation
    AND bound_auth_id IS NULL AND recovery_digest IS NULL;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 END IF;
 UPDATE club_invite_private.send_attempts SET status='sending',claimed_at=v_now
  WHERE operation_id=p_operation_id AND status='reserved' AND generation=v_a.generation;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 -- This is the only delivery-secret egress and goes only to trusted service
 -- code. Commit succeeded before SMTP/Auth call; never return to browser/log.
 IF v_a.kind='group_invite' THEN
  RETURN jsonb_build_object('status','claimed','kind','group_invite',
    'operation_id',p_operation_id,'invite_id',v_i.id,'generation',v_a.generation,
    'email',v_email,'secret',v_secret,'expires_at',v_i.expires_at,
    'club_name',v_club_name,'member_name',v_member_name,'inviter_name',v_inviter_name);
 END IF;
 RETURN jsonb_build_object('status','claimed','kind','auth_confirmation',
   'operation_id',p_operation_id,'generation',v_a.generation,'email',v_email);
END $$;

CREATE FUNCTION public.cancel_club_invite(p_invite uuid,p_generation integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_i club_invite_private.invitations%ROWTYPE;
 v_now timestamptz; v_sending boolean;
BEGIN
 IF v_actor IS NULL OR p_invite IS NULL OR p_generation IS NULL
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND OR NOT club_invite_private.manager_ok(v_actor,v_i.club_id,v_i.member_id)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF v_i.generation IS DISTINCT FROM p_generation THEN RETURN jsonb_build_object('status','conflict'); END IF;
 IF v_i.status='cancelled' THEN RETURN jsonb_build_object('status','cancelled'); END IF;
 IF v_i.status<>'pending' THEN RETURN jsonb_build_object('status','conflict'); END IF;
 v_now:=clock_timestamp();
 IF v_i.expires_at<=v_now THEN
  PERFORM club_invite_private.settle_stale();
  RETURN jsonb_build_object('status','conflict');
 END IF;
 SELECT EXISTS(SELECT 1 FROM club_invite_private.send_attempts
  WHERE invite_id=v_i.id AND status='sending') INTO v_sending;
 UPDATE club_invite_private.invitations SET status='cancelled',decided_at=v_now,
  email_ciphertext=NULL,recovery_digest=NULL
  WHERE id=v_i.id AND status='pending' AND generation=p_generation;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 UPDATE club_invite_private.send_attempts
 SET status='failed',finished_at=v_now,failure_code='cancelled_before_claim'
 WHERE invite_id=v_i.id AND status='reserved';
 RETURN jsonb_build_object('status','cancelled','delivery_may_continue',v_sending);
END $$;

-- Manager DTO is limited to this target. Never expose raw email or hash,
-- auth uid, operation id, or raw SMTP error. Terminal/bound mask is NULL:
-- no decryption or secret retention solely to populate an old label.
CREATE FUNCTION public.get_club_invite_status(p_club uuid,p_member uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_i club_invite_private.invitations%ROWTYPE;
 v_now timestamptz; v_mask text; v_count bigint; v_last timestamptz;
 v_delivery text; v_inflight boolean; v_expiry timestamptz;
BEGIN
 IF v_actor IS NULL OR NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 IF NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_now:=clock_timestamp();
 SELECT * INTO v_i FROM club_invite_private.invitations
 WHERE club_id=p_club AND member_id=p_member
 ORDER BY (status='pending') DESC,created_at DESC,id DESC LIMIT 1;
 SELECT count(*) INTO v_count FROM club_invite_private.send_attempts
 WHERE club_id=p_club AND member_id=p_member AND day_jst=(v_now AT TIME ZONE 'Asia/Tokyo')::date;
 IF NOT FOUND THEN v_count:=0; END IF;
 IF v_i.id IS NULL THEN RETURN jsonb_build_object('status','none','member_attempts_today',v_count); END IF;
 IF v_i.status='pending' AND v_i.bound_auth_id IS NULL AND v_i.email_ciphertext IS NOT NULL THEN
  BEGIN
   v_mask:=club_invite_private.mask_email(club_invite_private.decrypt_email(v_i.email_ciphertext,v_i.email_digest));
  EXCEPTION WHEN OTHERS THEN v_mask:=NULL;
  END;
 END IF;
 SELECT max(reserved_at),coalesce(bool_or(status IN ('reserved','sending')),false) INTO v_last,v_inflight
 -- Only this managed membership; do not expose destination-wide activity.
 FROM club_invite_private.send_attempts WHERE club_id=p_club AND member_id=p_member;
 SELECT status INTO v_delivery FROM club_invite_private.send_attempts
 WHERE invite_id=v_i.id ORDER BY reserved_at DESC,operation_id DESC LIMIT 1;
 v_expiry:=v_i.expires_at;
 RETURN jsonb_build_object('status',v_i.status,'invite_id',v_i.id,'generation',v_i.generation,
   'masked_email',v_mask,'expires_at',v_expiry,'member_attempts_today',v_count,
   'cooldown_until',CASE WHEN v_last IS NULL OR v_last+interval '60 seconds'<=v_now
      THEN NULL ELSE v_last+interval '60 seconds' END,
   'delivery_status',v_delivery,'inflight',v_inflight,'rebound',v_i.bound_auth_id IS NOT NULL);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_club_invite_send(uuid),
 public.cancel_club_invite(uuid,integer),public.get_club_invite_status(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_club_invite_send(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_club_invite(uuid,integer),
 public.get_club_invite_status(uuid,uuid) TO authenticated;

CREATE FUNCTION club_invite_private.has_inflight(p_invite uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM club_invite_private.send_attempts
 WHERE invite_id=p_invite AND status IN ('reserved','sending'));
$$;

-- Explicit minimal DTO. Source history is disclosed ONLY after recipient
-- authorization and scope checks. No global player profile rows, emails,
-- Auth ids, hidden group records, raw snapshot or delivery credentials.
CREATE FUNCTION public.list_my_club_invites()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_digest bytea; v_target uuid; v_result jsonb;
BEGIN
 IF v_actor IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND THEN RETURN jsonb_build_object('status','identity_required'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'invite_id',i.id,'generation',i.generation,'club_id',i.club_id,'club_name',c.name,
   'member_name',coalesce(m.club_display_name,p.display_name),'expires_at',i.expires_at,
   'group_visibility',c.visibility,'inflight',club_invite_private.has_inflight(i.id),
   'rebound',i.bound_auth_id IS NOT NULL
 ) ORDER BY i.created_at,i.id),'[]'::jsonb) INTO v_result
 FROM club_invite_private.invitations i
 JOIN public.clubs c ON c.id=i.club_id
 JOIN public.club_members m ON m.id=i.member_id AND m.club_id=i.club_id
 JOIN public.player_profiles p ON p.id=i.source_profile_id AND m.player_profile_id=p.id
 WHERE i.status='pending' AND i.expires_at>clock_timestamp()
 AND ((i.bound_auth_id IS NULL AND i.email_digest=v_digest)
   OR (i.bound_auth_id=v_actor AND i.bound_email_digest=v_digest AND i.bound_generation=i.generation))
 AND club_invite_private.recipient_matches(i,v_actor,v_digest)
 AND club_invite_private.invite_usable(i,i.generation)
 AND c.visibility IN ('public','private');
 RETURN jsonb_build_object('status','ok','invitations',v_result);
END $$;

CREATE FUNCTION public.preview_my_club_invite(p_invite uuid,p_generation integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_digest bytea; v_target uuid;
 v_i club_invite_private.invitations%ROWTYPE; v_p jsonb; v_name text; v_raw text;
 v_visibility text; v_club text;
BEGIN
 IF v_actor IS NULL OR p_invite IS NULL OR p_generation IS NULL
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,v_actor,v_digest)
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF club_invite_private.has_inflight(v_i.id) THEN RETURN jsonb_build_object('status','inflight'); END IF;
 SELECT c.name,c.visibility,m.club_display_name,coalesce(m.club_display_name,p.display_name)
 INTO v_club,v_visibility,v_raw,v_name
 FROM public.clubs c JOIN public.club_members m ON m.club_id=c.id
 JOIN public.player_profiles p ON p.id=m.player_profile_id
 WHERE c.id=v_i.club_id AND m.id=v_i.member_id AND p.id=v_i.source_profile_id;
 IF NOT FOUND OR v_visibility NOT IN ('public','private') THEN RETURN jsonb_build_object('status','conflict'); END IF;
 v_p:=profile_link_private.scoped_preview(v_i.source_profile_id,v_actor,v_i.club_id);
 IF nullif(v_p->>'review_token','') IS NULL OR v_p->>'target_profile_id' IS DISTINCT FROM v_target::text
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 RETURN jsonb_build_object('status','ok','invite_id',v_i.id,'generation',v_i.generation,
  'club_id',v_i.club_id,'club_name',v_club,'expires_at',v_i.expires_at,
  'group_visibility',v_visibility,'group_display_name_suggestion',v_name,
  'group_display_name_current',v_raw,'review_token',v_p->>'review_token',
  'target_display_name',v_p->>'target_display_name',
  'participant_count',v_p->'participant_count','match_count',v_p->'match_count',
  'result_count',v_p->'result_count','team_match_count',v_p->'team_match_count',
  'official_match_count',v_p->'official_match_count');
END $$;

-- This preview is an authenticated POST, not a GET, and does not consume
-- the bearer. Only the particular invitation proven by the current token.
CREATE FUNCTION public.preview_club_invite_rebind(
 p_invite uuid,p_generation integer,p_secret text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_digest bytea; v_target uuid;
 v_i club_invite_private.invitations%ROWTYPE; v_secret_hash bytea; v_email text;
 v_current_email text; v_name text;
BEGIN
 IF v_actor IS NULL OR p_invite IS NULL OR p_generation IS NULL
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_secret_hash:=club_invite_private.secret_hash(p_secret);
 IF v_secret_hash IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND OR v_i.bound_auth_id IS NOT NULL OR v_i.recovery_digest IS DISTINCT FROM v_secret_hash
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF club_invite_private.has_inflight(v_i.id) THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF v_digest=v_i.email_digest THEN RETURN jsonb_build_object('status','use_normal_invite'); END IF;
 v_email:=club_invite_private.decrypt_email(v_i.email_ciphertext,v_i.email_digest);
 SELECT u.email,p.display_name INTO v_current_email,v_name
 FROM auth.users u JOIN public.player_profiles p ON p.id=v_target
 WHERE u.id=v_actor AND p.linked_auth_user_id=v_actor AND p.is_active;
 IF NOT FOUND OR club_invite_private.email_hmac(v_current_email) IS DISTINCT FROM v_digest
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 RETURN jsonb_build_object('status','ok','invite_id',v_i.id,'generation',v_i.generation,
  'original_email_masked',club_invite_private.mask_email(v_email),
  'current_account_email',v_current_email,'current_account_name',v_name,
  'account_review_token',encode(club_invite_private.request_fingerprint(jsonb_build_array(
    'rebind-preview-v1',v_i.id,v_i.generation,v_actor,v_target,encode(v_digest,'hex'),
    encode(v_secret_hash,'hex'))),'hex'));
END $$;

CREATE FUNCTION public.rebind_club_invite(
 p_operation_id uuid,p_invite uuid,p_generation integer,p_secret text,p_consent boolean,
 p_account_review_token text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_digest bytea; v_target uuid;
 v_i club_invite_private.invitations%ROWTYPE; v_hash bytea; v_request bytea; v_now timestamptz;
BEGIN
 IF v_actor IS NULL OR p_operation_id IS NULL OR p_invite IS NULL
 OR p_generation IS NULL OR p_consent IS NOT TRUE
 OR p_account_review_token IS NULL OR p_account_review_token !~ '^[0-9a-f]{64}$'
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_hash:=club_invite_private.secret_hash(p_secret);
 IF v_hash IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF p_account_review_token IS DISTINCT FROM encode(club_invite_private.request_fingerprint(jsonb_build_array(
   'rebind-preview-v1',p_invite,p_generation,v_actor,v_target,encode(v_digest,'hex'),encode(v_hash,'hex'))),'hex')
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_request:=club_invite_private.request_fingerprint(jsonb_build_array('rebind',p_operation_id,
   p_invite,p_generation,v_actor,encode(v_digest,'hex'),encode(v_hash,'hex'),true,p_account_review_token));
 -- Replay returns only the result, never new authority or another link.
 IF v_i.bound_auth_id IS NOT NULL THEN
  IF v_i.bind_operation_id=p_operation_id AND v_i.bind_request_digest=v_request
  AND club_invite_private.recipient_matches(v_i,v_actor,v_digest)
  AND club_invite_private.invite_usable(v_i,p_generation)
  THEN RETURN jsonb_build_object('status','rebound','invite_id',v_i.id,'generation',v_i.generation); END IF;
  RETURN jsonb_build_object('status','not_found');
 END IF;
 IF club_invite_private.operation_taken(p_operation_id)
 OR v_i.recovery_digest IS DISTINCT FROM v_hash OR v_i.email_digest=v_digest
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 OR club_invite_private.has_inflight(v_i.id)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 -- Verify the source/cipher and current key before irreversible erasure.
 PERFORM club_invite_private.decrypt_email(v_i.email_ciphertext,v_i.email_digest);
 v_now:=clock_timestamp();
 IF v_i.expires_at<=v_now THEN RETURN jsonb_build_object('status','not_found'); END IF;
 UPDATE club_invite_private.invitations
 SET bound_auth_id=v_actor,bound_email_digest=v_digest,bound_at=v_now,
  bound_generation=p_generation,bind_operation_id=p_operation_id,bind_request_digest=v_request,
  email_ciphertext=NULL,recovery_digest=NULL
 WHERE id=v_i.id AND status='pending' AND generation=p_generation
  AND bound_auth_id IS NULL AND recovery_digest=v_hash AND expires_at>v_now;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 RETURN jsonb_build_object('status','rebound','invite_id',v_i.id,'generation',p_generation);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.list_my_club_invites(),public.preview_my_club_invite(uuid,integer),
 public.preview_club_invite_rebind(uuid,integer,text),public.rebind_club_invite(uuid,uuid,integer,text,boolean,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_my_club_invites(),public.preview_my_club_invite(uuid,integer),
 public.preview_club_invite_rebind(uuid,integer,text),public.rebind_club_invite(uuid,uuid,integer,text,boolean,text)
 TO authenticated;

-- Lock parents as well as existing merge references. This is a draft lock
-- order for isolated deadlock tests, not a change to legacy merge locks.
-- No external network calls while locks are held.
CREATE FUNCTION club_invite_private.lock_accept_scope(p_club uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM profile_link_private.serialize_operations();
 -- The existing reference lock order is authoritative. Extra parent/role
 -- locks are nonblocking so a competing event write cannot cause a new
 -- indefinite inversion. Contention must roll back and prompt fresh review.
 PERFORM profile_link_private.lock_references();
 LOCK TABLE public.app_admins,public.clubs,public.events,public.event_team_sides,
  public.official_events
 IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 PERFORM 1 FROM public.clubs WHERE id=p_club FOR UPDATE NOWAIT;
END $$;

-- Registered invitations become ordinary link requests. Guard the final
-- merge, not merely the issuance or a browser endpoint. This trigger
-- deliberately applies ONLY to requests marked by the new lookup ticket.
-- The legacy merge INSERT precedes reassignment/retirement of source rows.
-- No new FK, no replacement of the existing named approval or merge body.
-- Review-only: confirm trigger permissions, table order, rollback and
-- ordinary paths in the isolated DB before approving a release.
CREATE UNIQUE INDEX club_invite_registered_request_marker
 ON club_invite_private.lookup_tickets(result_link_id)
 WHERE result_link_id IS NOT NULL;

CREATE FUNCTION club_invite_private.guard_registered_invite_merge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $registered_invite_guard$
DECLARE v_t club_invite_private.lookup_tickets%ROWTYPE;
 v_r public.player_profile_link_requests%ROWTYPE;
 v_digest bytea; v_target uuid;
BEGIN
 IF NEW.link_request_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO v_t FROM club_invite_private.lookup_tickets
 WHERE result_link_id=NEW.link_request_id;
 -- The unchanged legacy direct link/join paths have no marker.
 IF NOT FOUND THEN RETURN NEW; END IF;
 PERFORM profile_link_private.serialize_operations();
 SELECT * INTO v_r FROM public.player_profile_link_requests
 WHERE id=NEW.link_request_id FOR UPDATE;
 IF NOT FOUND OR v_t.account_kind<>'registered'
 OR v_t.consumed_at IS NULL OR v_t.consumed_operation_id IS NULL
 OR v_r.status<>'pending' OR v_r.expires_at<=clock_timestamp()
 OR v_r.club_id IS DISTINCT FROM v_t.club_id
 OR v_r.source_club_member_id IS DISTINCT FROM v_t.member_id
 OR v_r.source_player_profile_id IS DISTINCT FROM v_t.source_profile_id
 OR v_r.target_auth_user_id IS DISTINCT FROM v_t.target_auth_id
 OR v_r.requested_by_auth_user_id IS DISTINCT FROM v_t.manager_auth_id
 OR NEW.club_id IS DISTINCT FROM v_t.club_id
 OR NEW.source_player_profile_id IS DISTINCT FROM v_t.source_profile_id
 OR NEW.target_auth_user_id IS DISTINCT FROM v_t.target_auth_id
 OR NEW.requested_by_auth_user_id IS DISTINCT FROM v_t.manager_auth_id
 OR NEW.approved_by_auth_user_id IS DISTINCT FROM auth.uid()
 OR auth.uid() IS DISTINCT FROM v_t.target_auth_id
 THEN RAISE SQLSTATE 'PT409' USING MESSAGE='招待の連携内容を再確認してください'; END IF;
 PERFORM club_invite_private.lock_accept_scope(v_t.club_id);
 -- Use the current confirmed target, not manager-provided or stale JWT email.
 -- Registered route is tied to the original existing Auth account; an email
 -- change requires fresh review rather than silently reusing an old ticket.
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_t.target_auth_id);
 IF NOT FOUND OR v_target IS DISTINCT FROM NEW.target_player_profile_id
 OR v_digest IS DISTINCT FROM v_t.email_digest
 OR NOT club_invite_private.manager_ok(v_t.manager_auth_id,v_t.club_id,v_t.member_id)
 OR NOT club_invite_private.source_in_scope(v_t.club_id,v_t.member_id,v_t.source_profile_id)
 OR v_r.expires_at<=clock_timestamp()
 THEN RAISE SQLSTATE 'PT409' USING MESSAGE='招待の連携内容を再確認してください'; END IF;
 RETURN NEW;
END $registered_invite_guard$;

CREATE TRIGGER club_invite_guard_registered_merge
 BEFORE INSERT ON public.player_profile_merges
 FOR EACH ROW EXECUTE FUNCTION club_invite_private.guard_registered_invite_merge();
REVOKE ALL ON FUNCTION club_invite_private.guard_registered_invite_merge()
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.accept_my_club_invite(
 p_invite uuid,p_generation integer,p_operation_id uuid,
 p_review_token text,p_expected_club_display_name text,p_expected_visibility text,
 p_club_display_name text,p_public_confirmation boolean,p_inheritance_consent boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_target uuid; v_digest bytea;
 v_i club_invite_private.invitations%ROWTYPE; v_source public.club_members%ROWTYPE;
 v_club public.clubs%ROWTYPE; v_preview jsonb; v_result jsonb; v_link uuid;
 v_merge uuid; v_request bytea; v_chosen text:=btrim(p_club_display_name);
BEGIN
 IF v_actor IS NULL OR p_invite IS NULL OR p_generation IS NULL
 OR p_operation_id IS NULL OR p_inheritance_consent IS NOT TRUE
 OR p_review_token IS NULL OR char_length(p_review_token) NOT BETWEEN 1 AND 256
 OR v_chosen IS NULL OR char_length(v_chosen) NOT BETWEEN 1 AND 120
 OR v_chosen ~ '[[:cntrl:]]' OR p_public_confirmation IS NULL
 OR p_expected_visibility IS NULL OR p_expected_visibility NOT IN ('public','private')
 OR (p_expected_visibility='private' AND p_public_confirmation)
 THEN RETURN jsonb_build_object('status','invalid'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND OR v_i.generation IS DISTINCT FROM p_generation
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,v_actor,v_digest)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_request:=club_invite_private.request_fingerprint(jsonb_build_array(
   'accept',p_invite,p_generation,p_operation_id,v_actor,encode(v_digest,'hex'),
   p_review_token,p_expected_club_display_name,p_expected_visibility,
   p_club_display_name,p_public_confirmation,true));
 IF v_i.status='approved' THEN
  IF v_i.recipient_auth_id=v_actor AND v_i.decision_operation_id=p_operation_id
     AND v_i.decision_request_digest=v_request
     AND EXISTS(SELECT 1 FROM public.player_profile_merges m
       WHERE m.link_request_id=v_i.link_request_id AND m.target_auth_user_id=v_actor
       AND m.target_player_profile_id=v_target AND m.club_id=v_i.club_id
       AND m.restored_at IS NULL)
  THEN RETURN jsonb_build_object('status','approved','invite_id',v_i.id,'club_id',v_i.club_id); END IF;
  RETURN jsonb_build_object('status','not_found');
 END IF;
 IF club_invite_private.operation_taken(p_operation_id)
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 OR club_invite_private.has_inflight(v_i.id)
 THEN RETURN jsonb_build_object('status','conflict'); END IF;

 -- Do not rely on the earlier optimistic checks. Hold source references
 -- and group visibility through the actual named approval.
 PERFORM club_invite_private.lock_accept_scope(v_i.club_id);
 SELECT * INTO v_club FROM public.clubs WHERE id=v_i.club_id AND is_active
  AND NOT coalesce(is_deleted,false);
 IF NOT FOUND OR v_club.visibility IS DISTINCT FROM p_expected_visibility
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 SELECT * INTO v_source FROM public.club_members WHERE id=v_i.member_id
  AND club_id=v_i.club_id AND player_profile_id=v_i.source_profile_id FOR UPDATE;
 IF NOT FOUND OR v_source.club_display_name IS DISTINCT FROM p_expected_club_display_name
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,v_actor,v_digest)
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 OR NOT club_invite_private.ordinary_history_in_scope(v_i.source_profile_id,v_i.club_id)
 OR v_target=v_i.source_profile_id OR club_invite_private.has_inflight(v_i.id)
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 -- Do not silently collapse duplicate memberships or a concurrent normal
 -- join. Existing merge guards remain the final authority.
 IF EXISTS(SELECT 1 FROM public.club_members
     WHERE club_id=v_i.club_id AND id<>v_i.member_id
      AND (player_profile_id=v_target OR profile_id=v_actor))
 OR EXISTS(SELECT 1 FROM public.join_requests j
     WHERE j.club_id=v_i.club_id AND j.requester_player_profile_id=v_target
      AND j.status='pending' AND coalesce(j.expires_at,j.created_at+interval '7 days')>clock_timestamp())
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 v_preview:=profile_link_private.scoped_preview(v_i.source_profile_id,v_actor,v_i.club_id);
 IF v_preview->>'review_token' IS DISTINCT FROM p_review_token
 OR v_preview->>'target_profile_id' IS DISTINCT FROM v_target::text
 OR v_i.expires_at<=clock_timestamp()
 THEN RETURN jsonb_build_object('status','conflict'); END IF;

 -- The existing pending-source unique index includes expired pending rows.
 -- Use the same existing expiry routine as request_player_profile_link,
 -- only inside the approval subtransaction, before inserting the request.
 BEGIN
  PERFORM profile_link_private.expire_requests();
  IF NOT club_invite_private.invite_usable(v_i,p_generation)
  OR EXISTS(SELECT 1 FROM public.player_profile_link_requests
      WHERE source_player_profile_id=v_i.source_profile_id AND status='pending')
  OR EXISTS(SELECT 1 FROM public.join_requests
      WHERE consent_source_player_profile_id=v_i.source_profile_id AND status='pending')
  THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
  INSERT INTO public.player_profile_link_requests(
   club_id,source_club_member_id,source_player_profile_id,target_auth_user_id,
   expected_target_player_profile_id,requested_by_auth_user_id,expires_at)
  VALUES(v_i.club_id,v_i.member_id,v_i.source_profile_id,v_actor,
   v_target,v_i.inviter_auth_id,v_i.expires_at) RETURNING id INTO v_link;
  -- Critical: call the existing PUBLIC named RPC as the real recipient.
  -- No set_config JWT impersonation, direct private merge or raw name write.
  v_result:=public.review_player_profile_link_named(v_link,p_review_token,
      v_chosen,p_expected_club_display_name,p_public_confirmation);
  IF v_result->>'status' IS DISTINCT FROM 'approved'
   OR nullif(v_result->>'merge_id','') IS NULL
  THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation approval failed'; END IF;
  v_merge:=(v_result->>'merge_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.player_profile_merges m
    WHERE m.id=v_merge AND m.link_request_id=v_link AND m.restored_at IS NULL
     AND m.source_player_profile_id=v_i.source_profile_id AND m.target_player_profile_id=v_target
     AND m.target_auth_user_id=v_actor AND m.club_id=v_i.club_id)
  OR NOT EXISTS(SELECT 1 FROM public.player_profile_link_requests r
     WHERE r.id=v_link AND r.status='approved' AND r.reviewed_by_auth_user_id=v_actor
     AND r.target_auth_user_id=v_actor)
  OR NOT EXISTS(SELECT 1 FROM public.club_members m JOIN public.player_profiles p
     ON p.id=m.player_profile_id WHERE m.id=v_i.member_id AND m.club_id=v_i.club_id
     AND p.id=v_target AND p.linked_auth_user_id=v_actor AND p.is_active
     AND m.is_active AND m.status='active' AND m.club_display_name=v_chosen
     AND m.club_name_public_choice IS NOT DISTINCT FROM
      CASE WHEN v_club.visibility='public' THEN CASE WHEN p_public_confirmation THEN 'on' ELSE 'off' END ELSE NULL END)
  THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation approval failed'; END IF;
  UPDATE club_invite_private.invitations SET status='approved',recipient_auth_id=v_actor,
    link_request_id=v_link,decided_at=clock_timestamp(),email_ciphertext=NULL,recovery_digest=NULL,
    decision_operation_id=p_operation_id,decision_request_digest=v_request
   WHERE id=v_i.id AND status='pending' AND generation=p_generation
     AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation approval failed'; END IF;
  -- Existing named approval already writes notification and restore audit.
  -- No additional notification or modification of the canonical name.
  RETURN jsonb_build_object('status','approved','invite_id',v_i.id,'club_id',v_i.club_id);
 EXCEPTION WHEN OTHERS THEN
  -- Roll back request + merge + notification + alias + invite in this
  -- subtransaction. Never return SQLERRM, raw rows or tokens to caller.
  RETURN jsonb_build_object('status','conflict');
 END;
END $$;

CREATE FUNCTION public.reject_my_club_invite(
 p_invite uuid,p_generation integer,p_operation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_i club_invite_private.invitations%ROWTYPE;
 v_digest bytea;v_request bytea;v_now timestamptz;
BEGIN
 IF v_actor IS NULL OR p_invite IS NULL OR p_generation IS NULL OR p_operation_id IS NULL
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND OR v_i.generation IS DISTINCT FROM p_generation
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT current_email_digest INTO v_digest FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,v_actor,v_digest)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_request:=club_invite_private.request_fingerprint(jsonb_build_array(
    'reject',p_invite,p_generation,p_operation_id,v_actor,encode(v_digest,'hex')));
 IF v_i.status='rejected' THEN
  IF v_i.recipient_auth_id=v_actor AND v_i.decision_operation_id=p_operation_id
   AND v_i.decision_request_digest=v_request
  THEN RETURN jsonb_build_object('status','rejected','invite_id',v_i.id); END IF;
  RETURN jsonb_build_object('status','not_found');
 END IF;
 IF club_invite_private.operation_taken(p_operation_id)
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 OR club_invite_private.has_inflight(v_i.id)
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 v_now:=clock_timestamp();
 UPDATE club_invite_private.invitations SET status='rejected',recipient_auth_id=v_actor,
  decided_at=v_now,email_ciphertext=NULL,recovery_digest=NULL,
  decision_operation_id=p_operation_id,decision_request_digest=v_request
 WHERE id=v_i.id AND status='pending' AND generation=p_generation AND expires_at>v_now;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF;
 RETURN jsonb_build_object('status','rejected','invite_id',v_i.id);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.accept_my_club_invite(uuid,integer,uuid,text,text,text,text,boolean,boolean),
 public.reject_my_club_invite(uuid,integer,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.accept_my_club_invite(uuid,integer,uuid,text,text,text,text,boolean,boolean),
 public.reject_my_club_invite(uuid,integer,uuid) TO authenticated;

-- candidate only; do not execute standalone
ALTER TABLE club_invite_private.invitations
 DROP CONSTRAINT invite_bind_request_present,
 ADD CONSTRAINT invite_bind_request_present CHECK (
   (status='pending' AND (bind_operation_id IS NULL)=(bind_request_digest IS NULL))
   OR (status<>'pending' AND bind_request_digest IS NULL)
 );
CREATE FUNCTION club_invite_private.erase_terminal_secrets()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status<>'pending' THEN
  NEW.email_ciphertext:=NULL;
  NEW.recovery_digest:=NULL;
  NEW.bind_request_digest:=NULL;
  -- A fresh explicit check must follow the terminal transition. Do not delete
  -- consumed tickets: they retain request provenance and replay evidence.
  IF TG_OP='UPDATE' THEN
   IF OLD.status='pending' THEN
    DELETE FROM club_invite_private.lookup_tickets
     WHERE source_profile_id=OLD.source_profile_id AND consumed_at IS NULL;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER club_invite_erase_terminal_secrets
 BEFORE INSERT OR UPDATE ON club_invite_private.invitations
 FOR EACH ROW EXECUTE FUNCTION club_invite_private.erase_terminal_secrets();

CREATE INDEX club_invite_terminal_retention
 ON club_invite_private.invitations(decided_at)
 WHERE status<>'pending';
CREATE INDEX club_invite_attempt_retention
 ON club_invite_private.send_attempts(finished_at)
 WHERE status IN ('sent','failed','unknown');
CREATE INDEX club_invite_consumed_lookup_retention
 ON club_invite_private.lookup_tickets(consumed_at)
 WHERE consumed_at IS NOT NULL;
CREATE INDEX club_invite_lookup_limit_window
 ON club_invite_private.lookup_limits(last_accepted_at);
CREATE INDEX club_invite_anon_limit_window
 ON club_invite_private.anonymous_limits(window_started_at);

-- Owner-only maintenance. Not exposed to PostgREST or service_role.
-- Approved schedule: daily 03:00 JST (18:00 UTC if scheduler is UTC).
-- No cron job, network call, send, key creation, or actual deletion now.
CREATE FUNCTION club_invite_private.cleanup_retention()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz; v_cutoff timestamptz;
 v_attempts bigint; v_invites bigint; v_tickets bigint;
 v_lookup_limits bigint; v_anonymous_limits bigint;
BEGIN
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 v_now:=clock_timestamp();
 v_cutoff:=v_now-interval '720 hours';
 DELETE FROM club_invite_private.send_attempts
 WHERE status IN ('sent','failed','unknown')
   AND finished_at<=v_cutoff
   AND reserved_at<=v_cutoff
   -- never remove a current quota window entry even if the retention
   -- or time configuration changes unexpectedly
   AND reserved_at<=v_now-interval '24 hours'
   AND day_jst < (v_now AT TIME ZONE 'Asia/Tokyo')::date;
 GET DIAGNOSTICS v_attempts=ROW_COUNT;

 DELETE FROM club_invite_private.invitations i
 WHERE i.status<>'pending' AND i.decided_at<=v_cutoff
   AND i.email_ciphertext IS NULL AND i.recovery_digest IS NULL
   AND i.bind_request_digest IS NULL
   AND NOT EXISTS(SELECT 1 FROM club_invite_private.send_attempts a WHERE a.invite_id=i.id);
 GET DIAGNOSTICS v_invites=ROW_COUNT;

 DELETE FROM club_invite_private.lookup_tickets
 WHERE (consumed_at IS NULL AND expires_at<=v_now)
    OR (consumed_at IS NOT NULL AND consumed_at<=v_cutoff
       AND NOT EXISTS(SELECT 1 FROM public.player_profile_link_requests r
        WHERE r.id=club_invite_private.lookup_tickets.result_link_id
          AND r.status='pending' AND r.expires_at>v_now));
 -- An anomalously extended live request must not lose its guard marker.
 -- Report/resolve this retention anomaly before release; normal requests
 -- expire in seven days, so the 30-day cleanup is unaffected.
 GET DIAGNOSTICS v_tickets=ROW_COUNT;

 DELETE FROM club_invite_private.lookup_limits
 WHERE last_accepted_at<=v_now-interval '10 minutes';
 GET DIAGNOSTICS v_lookup_limits=ROW_COUNT;

 DELETE FROM club_invite_private.anonymous_limits
 WHERE window_started_at<=v_now-interval '10 minutes';
 GET DIAGNOSTICS v_anonymous_limits=ROW_COUNT;

 RETURN jsonb_build_object('attempts_deleted',v_attempts,'invitations_deleted',v_invites,
  'tickets_deleted',v_tickets,'lookup_windows_deleted',v_lookup_limits,
  'anonymous_windows_deleted',v_anonymous_limits);
END $$;
REVOKE ALL ON FUNCTION club_invite_private.cleanup_retention(),
 club_invite_private.erase_terminal_secrets()
 FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA club_invite_private
 REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;

DO $invite_acl$
DECLARE f text; r text; o oid; expected_role text;
 auth_f text[]:=ARRAY[
 'public.check_club_invite_account(uuid,uuid,text)',
 'public.consume_club_invite_lookup(uuid,uuid,text,text,uuid,boolean)',
 'public.cancel_club_invite(uuid,integer)',
 'public.get_club_invite_status(uuid,uuid)',
 'public.list_my_club_invites()',
 'public.preview_my_club_invite(uuid,integer)',
 'public.preview_club_invite_rebind(uuid,integer,text)',
 'public.rebind_club_invite(uuid,uuid,integer,text,boolean,text)',
 'public.accept_my_club_invite(uuid,integer,uuid,text,text,text,text,boolean,boolean)',
 'public.reject_my_club_invite(uuid,integer,uuid)'];
 svc_f text[]:=ARRAY[
 'public.reserve_club_invite_send(uuid,uuid,uuid,uuid,text,text)',
 'public.reserve_club_invite_resend(uuid,text,uuid,integer,uuid,text,text,bytea)',
 'public.claim_club_invite_send(uuid)',
 'public.finalize_club_invite_send(uuid,integer,text,text)'];
 roles_to_check text[]:=ARRAY['anon','authenticated','service_role'];
 nsp oid:=to_regnamespace('club_invite_private');
 x record;
BEGIN
 IF current_user<>'postgres' OR nsp IS NULL THEN RAISE EXCEPTION 'Invite owner mismatch'; END IF;
 FOREACH f IN ARRAY auth_f||svc_f LOOP
  o:=to_regprocedure(f);
  IF o IS NULL THEN RAISE EXCEPTION 'Missing invite RPC: %',f; END IF;
  expected_role:=CASE WHEN f=ANY(auth_f) THEN 'authenticated' ELSE 'service_role' END;
  -- f is a constant audited signature array, never user input.
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',f,expected_role);
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=o AND p.prosecdef
    AND pg_get_userbyid(p.proowner)='postgres'
    AND coalesce(p.proconfig,ARRAY[]::text[]) && ARRAY['search_path=""','search_path='])
  THEN RAISE EXCEPTION 'Invite RPC unsafe owner/search path: %',f; END IF;
  FOREACH r IN ARRAY roles_to_check LOOP
   IF has_function_privilege(r,o,'EXECUTE') IS DISTINCT FROM (r=expected_role)
   THEN RAISE EXCEPTION 'Invite RPC ACL mismatch: % / %',f,r; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL
     aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE p.oid=o AND (a.grantee=0 OR
       a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname=expected_role))
       OR (a.grantee<>p.proowner AND a.is_grantable)))
  THEN RAISE EXCEPTION 'Unexpected RPC grant: %',f; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL
    aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.oid=nsp AND a.grantee<>n.nspowner)
 OR NOT EXISTS(SELECT 1 FROM pg_namespace WHERE oid=nsp AND pg_get_userbyid(nspowner)='postgres')
 THEN RAISE EXCEPTION 'Private schema grant/owner mismatch'; END IF;
 FOREACH r IN ARRAY roles_to_check LOOP
  IF has_schema_privilege(r,nsp,'USAGE') OR has_schema_privilege(r,nsp,'CREATE')
  THEN RAISE EXCEPTION 'Private schema exposed: %',r; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class WHERE relnamespace=nsp AND relkind IN ('r','p'))<>6
 THEN RAISE EXCEPTION 'Unexpected private table count'; END IF;
 FOR x IN SELECT c.oid,c.relname,c.relowner,c.relacl,c.relrowsecurity
  FROM pg_class c WHERE c.relnamespace=nsp AND c.relkind IN ('r','p') LOOP
  IF NOT x.relrowsecurity OR pg_get_userbyid(x.relowner)<>'postgres'
  OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=x.oid)
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(x.relacl,acldefault('r',x.relowner))) a
    WHERE a.grantee<>x.relowner)
  THEN RAISE EXCEPTION 'Private table boundary mismatch: %',x.relname; END IF;
  FOREACH r IN ARRAY roles_to_check LOOP
   IF has_table_privilege(r,x.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_any_column_privilege(r,x.oid,'SELECT,INSERT,UPDATE,REFERENCES')
   THEN RAISE EXCEPTION 'Private table exposed: % / %',x.relname,r; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid=x.oid AND acl.grantee<>x.relowner)
  THEN RAISE EXCEPTION 'Unexpected private column grant: %',x.relname; END IF;
 END LOOP;
 FOR x IN SELECT p.oid,p.proname,p.proowner,p.proacl,p.proconfig
  FROM pg_proc p WHERE p.pronamespace=nsp LOOP
  IF pg_get_userbyid(x.proowner)<>'postgres'
   OR NOT (coalesce(x.proconfig,ARRAY[]::text[]) && ARRAY['search_path=""','search_path='])
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(x.proacl,acldefault('f',x.proowner))) a
     WHERE a.grantee<>x.proowner)
  THEN RAISE EXCEPTION 'Private function boundary mismatch: %',x.proname; END IF;
  FOREACH r IN ARRAY roles_to_check LOOP
   IF has_function_privilege(r,x.oid,'EXECUTE')
   THEN RAISE EXCEPTION 'Private function exposed: % / %',x.proname,r; END IF;
  END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM club_invite_private.settings)<>1
 OR NOT EXISTS(SELECT 1 FROM club_invite_private.settings
    WHERE singleton AND NOT send_enabled AND global_24h_limit=200
    AND anonymous_ip_10m_limit=10 AND anonymous_ref_10m_limit=3)
 THEN RAISE EXCEPTION 'Invite initial operational gate is unsafe'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relnamespace=nsp AND c.contype='f' AND c.confrelid='public.player_profiles'::regclass)
 THEN RAISE EXCEPTION 'Invite introduces forbidden player profile FK'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid='public.player_profile_merges'::regclass
      AND t.tgname='club_invite_guard_registered_merge'
      AND t.tgfoid=to_regprocedure('club_invite_private.guard_registered_invite_merge()')
      AND NOT t.tgisinternal AND t.tgenabled='O')
 THEN RAISE EXCEPTION 'Invite registered approval guard missing'; END IF;
 PERFORM profile_link_private.check_reference_schema();
END $invite_acl$;

COMMIT;
