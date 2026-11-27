-- TASK-08-02 / #262, candidate 03: review-only schema + quota helper.
-- Baseline main 5fd308eea4f7d673c2a3e170c934876634154d94.
-- NOT a production migration. NOT executed or syntax-tested.
-- Intentionally ROLLBACK. Do not use on production or Stage.
-- Review in an isolated disposable DB only after authorization.
-- Missing: complete RPC bodies, binding/expiry sweeper, ACL and key provisioning.
BEGIN;
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
  window_started_at timestamptz NOT NULL,
  lookup_count integer NOT NULL CHECK (lookup_count>=1)
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
ROLLBACK;
