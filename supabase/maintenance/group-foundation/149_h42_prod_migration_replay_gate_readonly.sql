-- TASK-08/H42: READ-ONLY migration state/replay gate. Run on Prod AND Stage.
-- The ONLY supported production release order is:
--  1. Supabase apply_migration name task08_prod_phase1_additive
--  2. Supabase apply_migration name task08_prod_phase2_atomic
--  3. After Cloudflare production UI success: existing H35 legacy click anon closure.
-- DO NOT run 'supabase db push' on the existing migration directory; it contains
-- original 0054..0065 while Stage migration versions are timestamped differently.
BEGIN READ ONLY;
WITH hist AS (
 SELECT
 count(*) FILTER (WHERE name='task08_prod_phase1_additive') AS phase1_count,
 count(*) FILTER (WHERE name='task08_prod_phase2_atomic') AS phase2_count,
 count(*) FILTER (WHERE name~'^task08_(stage|staging)_005[4-9]'
                    OR name~'^task08_(stage|staging)_006[0-5]') AS stage_legacy_count,
 count(*) FILTER (WHERE version IN ('0054','0055','0056','0057','0058','0059','0060','0061','0062','0063','0064','0065')) AS old_numeric_count,
 count(*) AS total,
 max(version) FILTER (WHERE name='task08_prod_phase1_additive') AS phase1_version,
 max(version) FILTER (WHERE name='task08_prod_phase2_atomic') AS phase2_version
 FROM supabase_migrations.schema_migrations
),objects AS (
 SELECT
  to_regprocedure('public.get_shared_event(text,text)') IS NOT NULL AS shared,
  to_regprocedure('public.record_event_video_click_by_token(uuid,text,text,text)') IS NOT NULL AS click_event,
  to_regprocedure('public.record_event_video_link_click_by_token(uuid,text,text,text)') IS NOT NULL AS click_link,
  to_regprocedure('public.record_official_video_click_by_token(uuid,text,text,text)') IS NOT NULL AS click_official,
  to_regprocedure('public.get_club_roster(uuid)') IS NOT NULL AS roster,
  to_regprocedure('public.leave_my_club(uuid,uuid)') IS NOT NULL AS self_exit,
  to_regclass('public.club_owner_transfer_requests') IS NOT NULL AS owner_transfer,
  to_regprocedure('public.get_public_club_member_count(uuid)') IS NOT NULL AS member_count,
  to_regclass('public.event_fixed_pair_state') IS NOT NULL AS fixed_pair_prod,
  to_regclass('public.profile_media_objects') IS NOT NULL AS media_prod
)
SELECT jsonb_build_object(
 'read_only',true,
 'migration_history_count',h.total,
 'phase1_history_entries',h.phase1_count,
 'phase2_history_entries',h.phase2_count,
 'phase1_history_version',h.phase1_version,
 'phase2_history_version',h.phase2_version,
 'stage_task08_0054_to_0065_entries',h.stage_legacy_count,
 'numeric_0054_to_0065_entries',h.old_numeric_count,
 'shared_rpc_exists',o.shared,
 'token_click_rpc_count',o.click_event::int+o.click_link::int+o.click_official::int,
 'roster_rpc_exists',o.roster,
 'self_exit_rpc_exists',o.self_exit,
 'owner_transfer_exists',o.owner_transfer,
 'member_count_exists',o.member_count,
 'prod_fixed_pair_and_media_present',o.fixed_pair_prod AND o.media_prod,
 'phase1_eligible',
    h.phase1_count=0 AND h.phase2_count=0 AND h.stage_legacy_count=0
    AND h.old_numeric_count=0
    AND NOT o.shared AND NOT o.click_event AND NOT o.click_link AND NOT o.click_official
    AND NOT o.roster AND NOT o.self_exit AND NOT o.owner_transfer AND NOT o.member_count
    AND o.fixed_pair_prod AND o.media_prod,
 'phase2_eligible',
    h.phase1_count=1 AND h.phase2_count=0 AND h.stage_legacy_count=0
    AND o.shared AND o.click_event AND o.click_link AND o.click_official
    AND o.roster AND o.self_exit AND NOT o.owner_transfer AND NOT o.member_count
    AND o.fixed_pair_prod AND o.media_prod,
 'release_authorized',false
) AS report FROM hist h CROSS JOIN objects o;
ROLLBACK;
