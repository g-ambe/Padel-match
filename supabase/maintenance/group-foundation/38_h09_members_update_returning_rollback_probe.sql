-- TASK-08 H09: STAGING ONLY / ROLLBACK-ONLY actual role-simulated update tests.
-- No persisted role, active-state, member, Auth or profile changes.
-- Test actual granted UPDATE columns, RLS and RETURNING, not just table ACL.
-- Expected: manager A can update A; sub B can update non-main B;
-- cross-club, sub-on-main and last active main demotion/deactivation must be denied.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='35s';
DO $setup$
DECLARE a uuid;b uuid;ma uuid;mb uuid;source uuid; aid uuid; bid uuid;outid uuid;subid uuid;
BEGIN
 IF current_user<>'postgres'
  OR (SELECT count(*) FROM public.clubs WHERE name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B'))<>2
  OR (SELECT count(*) FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id
      WHERE c.name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B'))<>4
  OR (SELECT count(*) FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id
      WHERE c.name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B')
      AND cm.role='main_admin' AND cm.is_active)<>2
 THEN RAISE EXCEPTION 'H09 exact fixture layout drift'; END IF;
 SELECT id INTO STRICT aid FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT bid FROM auth.users WHERE lower(email)='recipient@example.com';
 SELECT id INTO STRICT outid FROM auth.users WHERE lower(email)='outsider@example.com';
 SELECT id INTO STRICT source FROM public.player_profiles WHERE display_name='TASK08-P0 provisional U' AND is_active AND linked_auth_user_id IS NULL;
 SELECT id INTO STRICT a FROM public.clubs WHERE name='TASK08-P0-20261119-A';
 SELECT id INTO STRICT b FROM public.clubs WHERE name='TASK08-P0-20261119-B';
 SELECT id INTO STRICT ma FROM public.club_members WHERE club_id=a AND role='main_admin' AND is_active;
 SELECT id INTO STRICT mb FROM public.club_members WHERE club_id=b AND role='main_admin' AND is_active;
 SELECT id INTO STRICT subid FROM public.club_members WHERE club_id=b AND role='sub_admin' AND is_active AND player_profile_id=source;
 IF (SELECT count(*) FROM public.club_members WHERE club_id=a AND player_profile_id=source)<>1
 THEN RAISE EXCEPTION 'H09 A source row missing'; END IF;
 PERFORM set_config('task08.A',a::text,true);
 PERFORM set_config('task08.B',b::text,true);
 PERFORM set_config('task08.mainA',aid::text,true);
 PERFORM set_config('task08.mainB',bid::text,true);
 PERFORM set_config('task08.outsider',outid::text,true);
 PERFORM set_config('task08.mainA_member',ma::text,true);
 PERFORM set_config('task08.mainB_member',mb::text,true);
 PERFORM set_config('task08.B_sub_member',subid::text,true);
 PERFORM set_config('task08.A_unlinked_member',(SELECT id::text FROM public.club_members WHERE club_id=a AND player_profile_id=source),true);
 PERFORM set_config('task08.source',source::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $setup$;
-- A main: actual role update and RETURNING all five fields required by current UI.
SET LOCAL ROLE authenticated;
DO $A_main$
DECLARE v_id uuid; v_club uuid; v_pp uuid; v_role text; v_active boolean; n int; cross_count int;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.mainA'),true);
 UPDATE public.club_members SET role='sub_admin'
 WHERE id=current_setting('task08.A_unlinked_member')::uuid
   AND club_id=current_setting('task08.A')::uuid AND role='member' AND is_active
 RETURNING id,club_id,player_profile_id,role,is_active INTO v_id,v_club,v_pp,v_role,v_active;
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM set_config('task08.main_role_positive',(n=1 AND v_role='sub_admin'
  AND v_id=current_setting('task08.A_unlinked_member')::uuid
  AND v_club=current_setting('task08.A')::uuid AND v_active)::text,true);
 UPDATE public.club_members SET is_active=false
 WHERE id=current_setting('task08.A_unlinked_member')::uuid AND role='sub_admin'
 RETURNING id,club_id,player_profile_id,role,is_active INTO v_id,v_club,v_pp,v_role,v_active;
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM set_config('task08.main_deactivate_positive',(n=1 AND v_active=false
   AND v_id=current_setting('task08.A_unlinked_member')::uuid)::text,true);
 UPDATE public.club_members SET is_active=true
 WHERE id=current_setting('task08.A_unlinked_member')::uuid AND role='sub_admin'
 RETURNING id,club_id,player_profile_id,role,is_active INTO v_id,v_club,v_pp,v_role,v_active;
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM set_config('task08.main_restore_positive',(n=1 AND v_active=true)::text,true);
 UPDATE public.club_members SET is_active=false
 WHERE id=current_setting('task08.B_sub_member')::uuid RETURNING id INTO v_id;
 GET DIAGNOSTICS cross_count=ROW_COUNT;
 PERFORM set_config('task08.cross_club_denied',(cross_count=0)::text,true);
END $A_main$;
RESET ROLE;
-- Synthetic linked subadmin belongs to B only. Never persist.
DO $setup_sub$
DECLARE uid uuid; player uuid; r uuid;
BEGIN
 uid:=current_setting('task08.outsider')::uuid;
 SELECT id INTO STRICT player FROM public.player_profiles WHERE linked_auth_user_id=uid AND is_active;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active)
 VALUES(current_setting('task08.B')::uuid,uid,player,'sub_admin',true)
 RETURNING id INTO r;
 PERFORM set_config('task08.B_temporary_sub',r::text,true);
END $setup_sub$;
SET LOCAL ROLE authenticated;
DO $sub$
DECLARE v_id uuid;v_role text;n int;blocked_main boolean;blocked_other boolean;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.outsider'),true);
 UPDATE public.club_members SET role='member'
 WHERE id=current_setting('task08.B_sub_member')::uuid AND role='sub_admin'
 RETURNING id,role INTO v_id,v_role;
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM set_config('task08.sub_nonmain_positive',(n=1 AND v_role='member')::text,true);
 UPDATE public.club_members SET role='member'
 WHERE id=current_setting('task08.mainB_member')::uuid AND role='main_admin'
 RETURNING id INTO v_id;
 GET DIAGNOSTICS n=ROW_COUNT;
 blocked_main:=n=0;
 PERFORM set_config('task08.sub_main_denied',blocked_main::text,true);
 UPDATE public.club_members SET role='sub_admin'
 WHERE id=current_setting('task08.A_unlinked_member')::uuid
 RETURNING id INTO v_id;
 GET DIAGNOSTICS n=ROW_COUNT;
 blocked_other:=n=0;
 PERFORM set_config('task08.sub_other_club_denied',blocked_other::text,true);
END $sub$;
RESET ROLE;
-- Non-UI bypass: can the only main admin deactivate/demote themselves directly?
SET LOCAL ROLE authenticated;
DO $last_main$
DECLARE id_ uuid;n int;code text;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.mainB'),true);
 BEGIN
  UPDATE public.club_members SET is_active=false
   WHERE id=current_setting('task08.mainB_member')::uuid AND is_active
   RETURNING id INTO id_;
  GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM set_config('task08.last_main_deactivation_allowed',(n=1)::text,true);
  PERFORM set_config('task08.last_main_deactivation_status','ALLOW',true);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  PERFORM set_config('task08.last_main_deactivation_allowed','false',true);
  PERFORM set_config('task08.last_main_deactivation_status',code,true);
 END;
END $last_main$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'A_manager_role_update_returning',current_setting('task08.main_role_positive')::boolean,
 'A_manager_deactivate_returning',current_setting('task08.main_deactivate_positive')::boolean,
 'A_manager_restore_returning',current_setting('task08.main_restore_positive')::boolean,
 'mainA_cannot_mutate_B',current_setting('task08.cross_club_denied')::boolean,
 'B_sub_can_modify_B_nonmain',current_setting('task08.sub_nonmain_positive')::boolean,
 'B_sub_cannot_modify_B_main',current_setting('task08.sub_main_denied')::boolean,
 'B_sub_cannot_modify_A',current_setting('task08.sub_other_club_denied')::boolean,
 'last_main_deactivation_allowed',current_setting('task08.last_main_deactivation_allowed')::boolean,
 'last_main_deactivation_result',current_setting('task08.last_main_deactivation_status'),
 'synthetic_sub_in_transaction',(SELECT count(*) FROM public.club_members
   WHERE id=current_setting('task08.B_temporary_sub')::uuid)
) AS report;
ROLLBACK;
