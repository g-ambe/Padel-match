-- TASK-08 / H40: privacy-preserving READ ONLY production-cutover impact audit.
-- Existing full H37/H38 structural probes remain 132/135/140; this focuses on live group impact.
-- No identities, club names, identifiers, email, user data or tokens are returned.
BEGIN READ ONLY;
WITH active_clubs AS (
  SELECT id, owner_id, visibility FROM public.clubs
  WHERE is_active AND NOT coalesce(is_deleted,false)
), members AS (
  SELECT c.id AS club_id,c.owner_id,c.visibility,cm.id AS member_id,cm.role,cm.status,
   cm.is_active,cm.profile_id,pp.is_active AS profile_active,pp.linked_auth_user_id,
   (cm.profile_id=c.owner_id OR (pp.is_active AND pp.linked_auth_user_id=c.owner_id)) AS is_owner
  FROM active_clubs c
  LEFT JOIN public.club_members cm ON cm.club_id=c.id
  LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
), owner_state AS (
 SELECT club_id,
 count(*) FILTER (WHERE role='main_admin' AND is_active AND status='active') AS main_count,
 count(*) FILTER (WHERE is_owner AND role='main_admin' AND is_active AND status='active') AS main_owner_matches
 FROM members GROUP BY club_id
), public_members AS(
 SELECT * FROM members WHERE visibility='public' AND is_active AND status='active'
 AND coalesce(profile_active,true)
)
SELECT jsonb_build_object(
 'read_only',true,
 'all_clubs',(SELECT count(*) FROM public.clubs),
 'active_clubs',(SELECT count(*) FROM active_clubs),
 'active_public_clubs',(SELECT count(*) FROM active_clubs WHERE visibility='public'),
 'public_active_members',(SELECT count(*) FROM public_members),
 'public_active_unlinked_members',(SELECT count(*) FROM public_members WHERE linked_auth_user_id IS NULL),
 'public_active_linked_members',(SELECT count(*) FROM public_members WHERE linked_auth_user_id IS NOT NULL),
 'public_clubs_with_linked_members',(SELECT count(DISTINCT club_id) FROM public_members WHERE linked_auth_user_id IS NOT NULL),
 'public_linked_members_who_will_need_alias_consent_when_0056_adds_NULL_columns',
    CASE WHEN EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='club_members' AND column_name='club_display_name'
    ) THEN NULL ELSE (SELECT count(*) FROM public_members WHERE linked_auth_user_id IS NOT NULL) END,
 'active_clubs_without_active_main',(SELECT count(*) FROM owner_state WHERE main_count=0),
 'active_clubs_without_owner_linked_active_main',(SELECT count(*) FROM owner_state WHERE main_owner_matches=0),
 'active_clubs_with_multiple_owner_matches',(SELECT count(*) FROM owner_state WHERE main_owner_matches>1),
 'legacy_anon_member_select',has_any_column_privilege('anon','public.club_members','SELECT'),
 'new_public_directory_rpc_present',to_regprocedure('public.get_public_club_directory(uuid)') IS NOT NULL,
 'owner_transfer_rpc_present',to_regprocedure('public.respond_club_owner_transfer(uuid,text)') IS NOT NULL,
 'has_explicit_release_approval',false
) AS impact;
ROLLBACK;
