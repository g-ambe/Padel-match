-- TASK-08 / H51: ISOLATED REHEARSAL CANDIDATE ONLY. NOT A PROD MIGRATION.
-- After Phase2 COMMIT, preserve new name/public-consent approvals while blocking
-- legacy browser calls that would approve a link WITHOUT that confirmation.
-- Preserve legacy rejection/cancellation; maintain all existing business rows.
-- Do NOT restore anon club_members table-wide SELECT, old raw DTO or legacy ACL.
-- REVIEW REQUIRED before adding to a production release/rollback runbook.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $h51$
DECLARE
 v_original text;
 v_named text;
 v_old_needle constant text :=
   'CREATE OR REPLACE FUNCTION public.review_player_profile_link(';
 v_named_needle constant text :=
   'public.review_player_profile_link(p_request_id,''approved'',p_review_token)';
BEGIN
 IF current_user <> 'postgres'
 OR to_regnamespace('profile_link_private') IS NULL
 OR to_regprocedure('public.review_player_profile_link(uuid,text,text)') IS NULL
 OR to_regprocedure('public.review_player_profile_link_named(uuid,text,text,text,boolean)') IS NULL
 OR to_regprocedure('profile_link_private.review_player_profile_link_original(uuid,text,text)') IS NOT NULL
 OR to_regclass('public.club_owner_transfer_requests') IS NULL
 OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='club_members'
                  AND column_name='club_display_name_public_confirmed_at')
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations
     WHERE name='task08_prod_phase2_atomic') <> 1
 THEN RAISE EXCEPTION 'H51_preflight_not_postcommit_or_already_applied';
 END IF;

 SELECT pg_get_functiondef('public.review_player_profile_link(uuid,text,text)'::regprocedure)
   INTO v_original;
 SELECT pg_get_functiondef('public.review_player_profile_link_named(uuid,text,text,text,boolean)'::regprocedure)
   INTO v_named;

 IF v_original IS NULL OR v_named IS NULL
 OR position(v_old_needle IN v_original) <> 1
 OR position('profile_link_private.merge_profiles' IN v_original) = 0
 OR position('profile_link_private.serialize_operations' IN v_original) = 0
 OR position(v_named_needle IN v_named) = 0
 OR position('p_public_confirmation' IN v_named) = 0
 OR (length(v_named)-length(replace(v_named,v_named_needle,''))) <> length(v_named_needle)
 OR (SELECT pg_get_userbyid(proowner)
     FROM pg_proc
     WHERE oid='public.review_player_profile_link(uuid,text,text)'::regprocedure) <> 'postgres'
 OR (SELECT pg_get_userbyid(proowner)
     FROM pg_proc
     WHERE oid='public.review_player_profile_link_named(uuid,text,text,text,boolean)'::regprocedure) <> 'postgres'
 THEN RAISE EXCEPTION 'H51_unreviewed_function_contract_do_not_replace';
 END IF;

 -- Relocate the ORIGINAL privileged implementation, unchanged, to a
 -- non-exposed schema. Only SECURITY DEFINER postgres routines can invoke it.
 EXECUTE replace(v_original, v_old_needle,
   'CREATE OR REPLACE FUNCTION profile_link_private.review_player_profile_link_original(');
 REVOKE ALL ON FUNCTION profile_link_private.review_player_profile_link_original(uuid,text,text)
  FROM PUBLIC,anon,authenticated;

 -- Existing NEW named approval keeps all its consent checks. Change only
 -- its protected internal call to the relocated original implementation.
 EXECUTE replace(v_named,v_named_needle,
   'profile_link_private.review_player_profile_link_original(p_request_id,''approved'',p_review_token)');

 IF position('profile_link_private.review_player_profile_link_original(p_request_id,''approved'',p_review_token)' IN
   (SELECT pg_get_functiondef(oid) FROM pg_proc
    WHERE oid='public.review_player_profile_link_named(uuid,text,text,text,boolean)'::regprocedure)) = 0
 THEN RAISE EXCEPTION 'H51_named_approval_internal_switch_failed';
 END IF;
END $h51$;

-- The legacy public RPC stays available for recipient rejection/admin
-- cancellation, but cannot grant approval without a group alias and consent.
CREATE OR REPLACE FUNCTION public.review_player_profile_link(
 p_request_id uuid, p_decision text, p_review_token text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=''
 AS $legacy_guard$
 BEGIN
   IF p_decision = 'approved' THEN
     RAISE EXCEPTION '公開範囲とグループ内表示名の確認が必要です。最新版の連携画面を使用してください'
       USING ERRCODE='42501';
   END IF;
   RETURN profile_link_private.review_player_profile_link_original(
     p_request_id,p_decision,p_review_token);
 END $legacy_guard$;

REVOKE ALL ON FUNCTION public.review_player_profile_link(uuid,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_player_profile_link(uuid,text,text)
 TO authenticated;

DO $postflight$
BEGIN
 IF has_function_privilege('anon',
     'public.review_player_profile_link(uuid,text,text)','EXECUTE')
 OR NOT has_function_privilege('authenticated',
     'public.review_player_profile_link(uuid,text,text)','EXECUTE')
 OR has_function_privilege('anon',
     'profile_link_private.review_player_profile_link_original(uuid,text,text)','EXECUTE')
 OR has_function_privilege('authenticated',
     'profile_link_private.review_player_profile_link_original(uuid,text,text)','EXECUTE')
 OR has_table_privilege('anon','public.club_members','SELECT')
 THEN RAISE EXCEPTION 'H51_privacy_or_legacy_contract_postflight_failed';
 END IF;
END $postflight$;

COMMIT;
