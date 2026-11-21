-- TASK-08 / H40: READ ONLY data preservation snapshot for PROD only.
-- Run before and after a coordinated cutover; compare counts, not personal data.
-- Requires Prod's fixed-pair and private image tables (absent from Stage).
BEGIN READ ONLY;
SELECT jsonb_build_object(
 'read_only',true,
 'clubs',(SELECT count(*) FROM public.clubs),
 'club_members',(SELECT count(*) FROM public.club_members),
 'player_profiles',(SELECT count(*) FROM public.player_profiles),
 'profiles',(SELECT count(*) FROM public.profiles),
 'events',(SELECT count(*) FROM public.events),
 'official_events',(SELECT count(*) FROM public.official_events),
 'matches',(SELECT count(*) FROM public.matches),
 'match_results',(SELECT count(*) FROM public.match_results),
 'event_team_matches',(SELECT count(*) FROM public.event_team_matches),
 'official_matches',(SELECT count(*) FROM public.official_matches),
 'event_fixed_pair_state',(SELECT count(*) FROM public.event_fixed_pair_state),
 'event_fixed_pairs',(SELECT count(*) FROM public.event_fixed_pairs),
 'event_fixed_pair_rounds',(SELECT count(*) FROM public.event_fixed_pair_rounds),
 'friendly_match_operations',(SELECT count(*) FROM public.friendly_match_operations),
 'profile_media_objects',(SELECT count(*) FROM public.profile_media_objects),
 'profile_media_operations',(SELECT count(*) FROM public.profile_media_operations),
 'profile_media_attempts',(SELECT count(*) FROM public.profile_media_attempts),
 'padel_facilities',(SELECT count(*) FROM public.padel_facilities),
 'schema_migrations',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'snapshot_only',true
) AS report;
ROLLBACK;
