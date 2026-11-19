-- H16 Stage-only real HTTP fixture. Never apply to production.
-- Uses existing Stage test Auth identities but does not modify their pre-existing rows.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $seed$
DECLARE v_owner uuid;v_sub uuid;v_member uuid;v_ownerpp uuid;v_subpp uuid;v_memberpp uuid;
 v_public uuid;v_private uuid;v_unlinked uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.clubs)<>3
 OR (SELECT count(*) FROM public.club_members)<>12
 OR (SELECT count(*) FROM public.player_profiles)<>12
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.join_requests WHERE status='pending')<>0
 OR (SELECT count(*) FROM public.club_members WHERE club_display_name IS NOT NULL OR club_display_name_public_confirmed_at IS NOT NULL)<>0
 OR EXISTS(SELECT 1 FROM public.clubs WHERE name LIKE 'TASK08-H16-HTTP-20261120-%')
 OR EXISTS(SELECT 1 FROM public.player_profiles WHERE display_name='TASK08-H16-HTTP-UNLINKED')
 THEN RAISE EXCEPTION 'H16 Stage-only fixture baseline changed; refusing seed'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_sub FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_member FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_ownerpp FROM public.player_profiles WHERE linked_auth_user_id=v_owner AND is_active;
 SELECT id INTO STRICT v_subpp FROM public.player_profiles WHERE linked_auth_user_id=v_sub AND is_active;
 SELECT id INTO STRICT v_memberpp FROM public.player_profiles WHERE linked_auth_user_id=v_member AND is_active;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility,description)
 VALUES('TASK08-H16-HTTP-20261120-PUBLIC',v_owner,true,'public','Stage-only alias test')
 RETURNING id INTO v_public;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility,description)
 VALUES('TASK08-H16-HTTP-20261120-PRIVATE',v_owner,true,'private','Stage-only alias test')
 RETURNING id INTO v_private;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('TASK08-H16-HTTP-UNLINKED',v_owner,true)
 RETURNING id INTO v_unlinked;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES
 (v_public,v_owner,v_ownerpp,'main_admin',true,'active'),
 (v_public,v_sub,v_subpp,'sub_admin',true,'active'),
 (v_public,v_member,v_memberpp,'member',true,'active'),
 (v_public,NULL,v_unlinked,'member',true,'active'),
 (v_private,v_owner,v_ownerpp,'main_admin',true,'active'),
 (v_private,v_member,v_memberpp,'member',true,'active');
 IF (SELECT count(*) FROM public.club_members WHERE club_id IN(v_public,v_private))<>6
 OR (SELECT count(*) FROM group_read_private.directory_refs r JOIN public.club_members cm ON cm.id=r.member_id WHERE cm.club_id IN(v_public,v_private))<>6
 THEN RAISE EXCEPTION 'H16 Stage setup count mismatch'; END IF;
END $seed$;
SELECT jsonb_build_object('stage_only',true,
'fixture_clubs',(SELECT count(*) FROM public.clubs WHERE name LIKE 'TASK08-H16-HTTP-20261120-%'),
'fixture_members',(SELECT count(*) FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id WHERE c.name LIKE 'TASK08-H16-HTTP-20261120-%'),
'fixture_profiles',(SELECT count(*) FROM public.player_profiles WHERE display_name='TASK08-H16-HTTP-UNLINKED'),
'baseline_profiles',(SELECT count(*) FROM public.player_profiles)) report;
COMMIT;