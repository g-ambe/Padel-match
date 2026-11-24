-- TASK-08 H09: ROLLBACK-only last-main demotion/status and second-main positive.
-- Run after staging trigger installation (or after injecting 39 into one transaction).
-- No persistent data changes. Tests actual authenticated RLS, trigger and RETURNING.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='35s';
DO $setup$
DECLARE a uuid; b uuid; ua uuid; ub uuid; outsider uuid; outsider_profile uuid;ma uuid;mb uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.club_members cm JOIN public.clubs c ON cm.club_id=c.id
     WHERE c.name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B')
       AND cm.role='main_admin' AND cm.is_active AND cm.status='active')<>2
 THEN RAISE EXCEPTION 'H09 roles fixture changed'; END IF;
 SELECT id INTO STRICT a FROM public.clubs WHERE name='TASK08-P0-20261119-A';
 SELECT id INTO STRICT b FROM public.clubs WHERE name='TASK08-P0-20261119-B';
 SELECT id INTO STRICT ua FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT ub FROM auth.users WHERE lower(email)='recipient@example.com';
 SELECT id INTO STRICT outsider FROM auth.users WHERE lower(email)='outsider@example.com';
 SELECT id INTO STRICT outsider_profile FROM public.player_profiles WHERE linked_auth_user_id=outsider AND is_active;
 SELECT id INTO STRICT ma FROM public.club_members WHERE club_id=a AND role='main_admin' AND is_active;
 SELECT id INTO STRICT mb FROM public.club_members WHERE club_id=b AND role='main_admin' AND is_active;
 PERFORM set_config('task08.A',a::text,true);
 PERFORM set_config('task08.B',b::text,true);
 PERFORM set_config('task08.mainA',ua::text,true);
 PERFORM set_config('task08.mainB',ub::text,true);
 PERFORM set_config('task08.Amain_member',ma::text,true);
 PERFORM set_config('task08.Bmain_member',mb::text,true);
 PERFORM set_config('task08.outsider',outsider::text,true);
 PERFORM set_config('task08.outsider_profile',outsider_profile::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $deny$
DECLARE n int;code text;row_id uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.mainA'),true);
 BEGIN
  UPDATE public.club_members SET role='member' WHERE id=current_setting('task08.Amain_member')::uuid RETURNING id INTO row_id;
  GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM set_config('task08.demote_denied',(n=0)::text,true);
  PERFORM set_config('task08.demote_code','ROW0',true);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  PERFORM set_config('task08.demote_denied',(code='42501')::text,true);
  PERFORM set_config('task08.demote_code',code,true);
 END;
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.mainB'),true);
 BEGIN
  UPDATE public.club_members SET status='departed' WHERE id=current_setting('task08.Bmain_member')::uuid RETURNING id INTO row_id;
  GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM set_config('task08.status_denied',(n=0)::text,true);
  PERFORM set_config('task08.status_code','ROW0',true);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  PERFORM set_config('task08.status_denied',(code='42501')::text,true);
  PERFORM set_config('task08.status_code',code,true);
 END;
END $deny$;
RESET ROLE;
-- Add one alternative active main in A in this transaction only.
DO $make_second_main$
DECLARE newid uuid;
BEGIN
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(current_setting('task08.A')::uuid,current_setting('task08.outsider')::uuid,
    current_setting('task08.outsider_profile')::uuid,'main_admin',true,'active')
 RETURNING id INTO newid;
 PERFORM set_config('task08.extra_main',newid::text,true);
END $make_second_main$;
SET LOCAL ROLE authenticated;
DO $allow_with_handover$
DECLARE m_id uuid;v_active boolean;n int;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.mainA'),true);
 UPDATE public.club_members SET is_active=false
 WHERE id=current_setting('task08.Amain_member')::uuid
 RETURNING id,is_active INTO m_id,v_active;
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM set_config('task08.handover_deactivate_allowed',(n=1 AND m_id=current_setting('task08.Amain_member')::uuid AND v_active=false)::text,true);
END $allow_with_handover$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'sole_main_demotion_denied',current_setting('task08.demote_denied')::boolean,
 'sole_main_demotion_result',current_setting('task08.demote_code'),
 'sole_main_status_change_denied',current_setting('task08.status_denied')::boolean,
 'sole_main_status_result',current_setting('task08.status_code'),
 'handover_to_second_main_allowed',current_setting('task08.handover_deactivate_allowed')::boolean,
 'active_main_count_after_handover_in_transaction',(SELECT count(*) FROM public.club_members
   WHERE club_id=current_setting('task08.A')::uuid AND role='main_admin' AND is_active AND status='active')
) AS report;
ROLLBACK;
