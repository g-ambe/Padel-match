-- H19: Stage-only actual JWT pending request acceptance in one transaction.
-- The recipient's approval, ownership transfer and old-owner exit are rolled back.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='50s';
DO $inspect$
DECLARE a uuid;b uuid;club uuid;req uuid;
BEGIN
 IF current_user<>'postgres' OR (SELECT count(*) FROM public.clubs)<>4
 OR (SELECT count(*) FROM public.club_members)<>15
 OR (SELECT count(*) FROM public.player_profiles)<>12
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.notifications)<>3
 OR (SELECT count(*) FROM public.club_owner_transfer_requests)<>2
 THEN RAISE EXCEPTION 'H19 JWT pending probe baseline drift'; END IF;
 SELECT id INTO STRICT a FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT b FROM auth.users WHERE lower(email)='recipient@example.com';
 SELECT id INTO STRICT club FROM public.clubs WHERE name='TASK08-H19-HTTP-20261120' AND owner_id=a
 AND is_active AND NOT coalesce(is_deleted,false);
 SELECT id INTO STRICT req FROM public.club_owner_transfer_requests
 WHERE club_id=club AND from_auth_user_id=a AND to_auth_user_id=b AND status='pending';
 IF (SELECT count(*) FROM public.club_owner_transfer_requests
 WHERE club_id=club AND status='declined')<>1
 THEN RAISE EXCEPTION 'H19 declined companion missing';END IF;
 PERFORM set_config('h19real.a',a::text,true);PERFORM set_config('h19real.b',b::text,true);
 PERFORM set_config('h19real.club',club::text,true);
 PERFORM set_config('h19real.pending',req::text,true);
END $inspect$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h19real.b'),true);
DO $accept$
BEGIN
 IF public.respond_club_owner_transfer(current_setting('h19real.pending')::uuid,'accepted')<>'accepted'
 THEN RAISE EXCEPTION 'H19 pending real JWT approval failed';END IF;
 PERFORM set_config('h19real.accepted','true',true);
END $accept$;
SELECT set_config('request.jwt.claim.sub',current_setting('h19real.a'),true);
DO $leave$
DECLARE member uuid;
BEGIN
 SELECT id INTO STRICT member FROM public.get_my_club_memberships()
 WHERE club_id=current_setting('h19real.club')::uuid;
 IF public.leave_my_club(current_setting('h19real.club')::uuid,member)<>member
 THEN RAISE EXCEPTION 'H19 old owner exit failed';END IF;
 IF public.can_manage_player_profile_club(current_setting('h19real.club')::uuid)
 THEN RAISE EXCEPTION 'H19 old owner still privileged'; END IF;
 PERFORM set_config('h19real.exited','true',true);
END $leave$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'real_jwt_pending_accepted',current_setting('h19real.accepted',true)='true',
 'recipient_is_new_owner',(SELECT owner_id=current_setting('h19real.b')::uuid FROM public.clubs WHERE id=current_setting('h19real.club')::uuid),
 'acceptance_recorded',(SELECT count(*)=1 FROM public.club_owner_transfer_requests WHERE id=current_setting('h19real.pending')::uuid AND status='accepted' AND responded_at IS NOT NULL),
 'former_owner_left',current_setting('h19real.exited',true)='true',
 'former_owner_now_inactive',(SELECT count(*)=1 FROM public.club_members WHERE club_id=current_setting('h19real.club')::uuid AND profile_id=current_setting('h19real.a')::uuid AND NOT is_active),
 'new_owner_active_main',(SELECT count(*)=1 FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=current_setting('h19real.club')::uuid AND cm.role='main_admin' AND cm.is_active AND cm.status='active' AND pp.linked_auth_user_id=current_setting('h19real.b')::uuid),
 'no_history_changed',(SELECT count(*)=0 FROM public.events),
 'notification_scope',(SELECT count(*)=4 FROM public.notifications WHERE related_club_id=current_setting('h19real.club')::uuid AND related_owner_transfer_request_id IS NOT NULL)
) report;
ROLLBACK;