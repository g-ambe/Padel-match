-- TASK-08/H15: Stage-only, all-Rollback test of self-withdraw RPC.
-- Synthetic private club, three preexisting Stage-only auth test identities.
-- No authentication credentials/IDs are printed or persisted, and existing clubs are untouched.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $seed$
DECLARE v_owner uuid;v_sub uuid;v_member uuid;v_club uuid;
        v_owner_pp uuid;v_sub_pp uuid;v_member_pp uuid;
        v_owner_mid uuid;v_sub_mid uuid;v_member_mid uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.clubs WHERE name='TASK08-H15-WITHDRAW-ROLLBACK')<>0
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.join_requests WHERE status='pending')<>0
 THEN RAISE EXCEPTION 'H15 Stage fixture isolation changed'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_sub FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_member FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_owner_pp FROM public.player_profiles WHERE linked_auth_user_id=v_owner AND is_active;
 SELECT id INTO STRICT v_sub_pp FROM public.player_profiles WHERE linked_auth_user_id=v_sub AND is_active;
 SELECT id INTO STRICT v_member_pp FROM public.player_profiles WHERE linked_auth_user_id=v_member AND is_active;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility)
 VALUES('TASK08-H15-WITHDRAW-ROLLBACK',v_owner,true,'private') RETURNING id INTO v_club;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_club,v_owner,v_owner_pp,'main_admin',true,'active') RETURNING id INTO v_owner_mid;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_club,v_sub,v_sub_pp,'sub_admin',true,'active') RETURNING id INTO v_sub_mid;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_club,v_member,v_member_pp,'member',true,'active') RETURNING id INTO v_member_mid;
 PERFORM set_config('h15.owner',v_owner::text,true);
 PERFORM set_config('h15.sub',v_sub::text,true);
 PERFORM set_config('h15.member',v_member::text,true);
 PERFORM set_config('h15.club',v_club::text,true);
 PERFORM set_config('h15.owner_mid',v_owner_mid::text,true);
 PERFORM set_config('h15.sub_mid',v_sub_mid::text,true);
 PERFORM set_config('h15.member_mid',v_member_mid::text,true);
END $seed$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h15.owner'),true);
DO $owner_reject$
BEGIN
 BEGIN
  PERFORM public.leave_my_club(current_setting('h15.club')::uuid,current_setting('h15.owner_mid')::uuid);
  RAISE EXCEPTION 'H15 owner leave unexpectedly allowed';
 EXCEPTION WHEN SQLSTATE '42501' THEN
  PERFORM set_config('h15.owner_blocked','true',true);
 END;
END $owner_reject$;
SELECT set_config('request.jwt.claim.sub',current_setting('h15.member'),true);
DO $third_party_reject$
BEGIN
 BEGIN
  PERFORM public.leave_my_club(current_setting('h15.club')::uuid,current_setting('h15.sub_mid')::uuid);
  RAISE EXCEPTION 'H15 member changed another member';
 EXCEPTION WHEN SQLSTATE '42501' THEN
  PERFORM set_config('h15.third_party_blocked','true',true);
 END;
END $third_party_reject$;
SELECT set_config('h15.member_exit_ok',(
  public.leave_my_club(current_setting('h15.club')::uuid,current_setting('h15.member_mid')::uuid)
  =current_setting('h15.member_mid')::uuid)::text,true);
DO $retry_reject$
BEGIN
 BEGIN
  PERFORM public.leave_my_club(current_setting('h15.club')::uuid,current_setting('h15.member_mid')::uuid);
  RAISE EXCEPTION 'H15 repeated leave unexpectedly allowed';
 EXCEPTION WHEN SQLSTATE '42501' THEN
  PERFORM set_config('h15.retry_blocked','true',true);
 END;
END $retry_reject$;
SELECT set_config('request.jwt.claim.sub',current_setting('h15.sub'),true);
SELECT set_config('h15.sub_exit_ok',(
  public.leave_my_club(current_setting('h15.club')::uuid,current_setting('h15.sub_mid')::uuid)
  =current_setting('h15.sub_mid')::uuid)::text,true);
RESET ROLE;

SELECT jsonb_build_object(
 'rollback_only',true,
 'owner_blocked',current_setting('h15.owner_blocked',true)='true',
 'third_party_blocked',current_setting('h15.third_party_blocked',true)='true',
 'member_leave',current_setting('h15.member_exit_ok',true)='true',
 'sub_admin_leave',current_setting('h15.sub_exit_ok',true)='true',
 'repeated_leave_blocked',current_setting('h15.retry_blocked',true)='true',
 'last_main_remains',(SELECT count(*) FROM public.club_members WHERE club_id=current_setting('h15.club')::uuid AND is_active AND role='main_admin')=1,
 'retired_rows_retained',(SELECT count(*) FROM public.club_members WHERE club_id=current_setting('h15.club')::uuid AND NOT is_active)=2,
 'history_player_profiles_intact',(SELECT count(*) FROM public.player_profiles WHERE linked_auth_user_id IN (current_setting('h15.owner')::uuid,current_setting('h15.sub')::uuid,current_setting('h15.member')::uuid))=3
) AS report;
ROLLBACK;