-- H18: STAGING ONLY guarded fixture for real Auth HTTP negative/preview tests.
-- Existing Stage Auth profiles are referenced but never updated or deleted.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='35s';
DO $setup$
DECLARE v_owner uuid;v_owner_pp uuid;v_pub uuid;v_priv uuid;v_pub_p uuid;v_priv_p uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.clubs)<>3
 OR (SELECT count(*) FROM public.club_members)<>12
 OR (SELECT count(*) FROM public.player_profiles)<>12
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.player_profile_link_requests)<>0
 OR (SELECT count(*) FROM public.player_profile_merges)<>0
 OR (SELECT count(*) FROM public.notifications)<>0
 OR EXISTS (SELECT 1 FROM public.clubs WHERE name LIKE 'TASK08-H18-HTTP-20261120-%')
 THEN RAISE EXCEPTION 'H18 Stage fixture isolation drift'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com'
   AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_owner_pp FROM public.player_profiles
   WHERE linked_auth_user_id=v_owner AND is_active;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility,description)
 VALUES('TASK08-H18-HTTP-20261120-PUBLIC',v_owner,true,'public','Stage-only H18'),
       ('TASK08-H18-HTTP-20261120-PRIVATE',v_owner,true,'private','Stage-only H18');
 SELECT id INTO STRICT v_pub FROM public.clubs WHERE name='TASK08-H18-HTTP-20261120-PUBLIC';
 SELECT id INTO STRICT v_priv FROM public.clubs WHERE name='TASK08-H18-HTTP-20261120-PRIVATE';
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_pub,v_owner,v_owner_pp,'main_admin',true,'active'),
       (v_priv,v_owner,v_owner_pp,'main_admin',true,'active');
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('H18-HTTP-PUBLIC-PROFILE',v_owner,true)
 RETURNING id INTO v_pub_p;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('H18-HTTP-PRIVATE-PROFILE',v_owner,true)
 RETURNING id INTO v_priv_p;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status,club_display_name)
 VALUES(v_pub,NULL,v_pub_p,'member',true,'active','H18-HTTP-PUBLIC-ALIAS');
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_priv,NULL,v_priv_p,'member',true,'active');
 IF (SELECT count(*) FROM public.club_members WHERE club_id IN(v_pub,v_priv))<>4
 THEN RAISE EXCEPTION 'H18 fixture membership mismatch'; END IF;
END $setup$;
SELECT jsonb_build_object('stage_only',true,
 'club_count',(SELECT count(*) FROM public.clubs WHERE name LIKE 'TASK08-H18-HTTP-20261120-%'),
 'member_count',(SELECT count(*) FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id WHERE c.name LIKE 'TASK08-H18-HTTP-20261120-%'),
 'provisional_count',(SELECT count(*) FROM public.player_profiles WHERE display_name IN('H18-HTTP-PUBLIC-PROFILE','H18-HTTP-PRIVATE-PROFILE')),
 'other_active_requests',(SELECT count(*) FROM public.player_profile_link_requests)
) report;
COMMIT;