-- TASK-08-03 / H16: Stage-only rollback probe of scoped aliases and disclosure.
-- Uses synthetic clubs/member rows; no existing club, person, or result is modified.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $seed$
DECLARE v_owner uuid;v_guest uuid;v_member uuid;v_ownerpp uuid;v_guestpp uuid;v_memberpp uuid;
 v_public uuid;v_private uuid;v_p1 uuid;v_p2 uuid;v_public_owner uuid;v_public_guest uuid;
 v_public_member uuid;v_provisional_member uuid;v_provisional_main uuid;v_private_member uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.clubs WHERE name LIKE 'TASK08-H16-ALIAS-ROLLBACK-%')<>0
 OR (SELECT count(*) FROM public.events)<>0
 THEN RAISE EXCEPTION 'H16 stage isolation guard'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_guest FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_member FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_ownerpp FROM public.player_profiles WHERE linked_auth_user_id=v_owner AND is_active;
 SELECT id INTO STRICT v_guestpp FROM public.player_profiles WHERE linked_auth_user_id=v_guest AND is_active;
 SELECT id INTO STRICT v_memberpp FROM public.player_profiles WHERE linked_auth_user_id=v_member AND is_active;

 INSERT INTO public.clubs(name,owner_id,is_active,visibility)
 VALUES('TASK08-H16-ALIAS-ROLLBACK-PUBLIC',v_owner,true,'public') RETURNING id INTO v_public;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility)
 VALUES('TASK08-H16-ALIAS-ROLLBACK-PRIVATE',v_owner,true,'private') RETURNING id INTO v_private;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('TASK08-H16-PROVISIONAL-1',v_owner,true) RETURNING id INTO v_p1;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('TASK08-H16-PROVISIONAL-2',v_owner,true) RETURNING id INTO v_p2;

 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_public,v_owner,v_ownerpp,'main_admin',true,'active') RETURNING id INTO v_public_owner;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_public,v_guest,v_guestpp,'sub_admin',true,'active') RETURNING id INTO v_public_guest;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_public,v_member,v_memberpp,'member',true,'active') RETURNING id INTO v_public_member;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_public,NULL,v_p1,'member',true,'active') RETURNING id INTO v_provisional_member;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_public,NULL,v_p2,'main_admin',true,'active') RETURNING id INTO v_provisional_main;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_private,v_owner,v_ownerpp,'main_admin',true,'active');
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_private,v_member,v_memberpp,'member',true,'active') RETURNING id INTO v_private_member;

 PERFORM set_config('h16.owner',v_owner::text,true);
 PERFORM set_config('h16.guest',v_guest::text,true);
 PERFORM set_config('h16.member',v_member::text,true);
 PERFORM set_config('h16.public',v_public::text,true);
 PERFORM set_config('h16.private',v_private::text,true);
 PERFORM set_config('h16.public_owner',v_public_owner::text,true);
 PERFORM set_config('h16.public_member',v_public_member::text,true);
 PERFORM set_config('h16.provisional_member',v_provisional_member::text,true);
 PERFORM set_config('h16.provisional_main',v_provisional_main::text,true);
 PERFORM set_config('h16.private_member',v_private_member::text,true);
 PERFORM set_config('h16.original_member_name',
 (SELECT display_name FROM public.player_profiles WHERE id=v_memberpp),true);
END $seed$;

SET LOCAL ROLE authenticated;
DO $owner$
DECLARE v jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('h16.owner'),true);
 IF (SELECT count(*) FROM public.get_public_club_directory(current_setting('h16.public')::uuid))<>2
 THEN RAISE EXCEPTION 'H16 unconfirmed linked profiles unexpectedly shown'; END IF;

 BEGIN
  PERFORM public.save_club_member_display_name(current_setting('h16.public')::uuid,
   current_setting('h16.public_owner')::uuid,'H16 A OWNER',NULL,false);
  RAISE EXCEPTION 'H16 missing public confirmation allowed';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;

 BEGIN
  PERFORM public.save_club_member_display_name(current_setting('h16.public')::uuid,
   current_setting('h16.public_member')::uuid,'H16 A other linked',NULL,true);
  RAISE EXCEPTION 'H16 main admin edited other linked identity';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;

 v:=public.save_club_member_display_name(current_setting('h16.public')::uuid,
   current_setting('h16.public_owner')::uuid,'H16 A OWNER',NULL,true);
 IF v->>'club_display_name'<>'H16 A OWNER' OR (v->>'public_name_confirmed')::boolean IS NOT TRUE
 THEN RAISE EXCEPTION 'H16 owner self save failed'; END IF;

 v:=public.save_club_member_display_name(current_setting('h16.public')::uuid,
   current_setting('h16.provisional_main')::uuid,'H16 A provisional main',NULL,false);
 IF v->>'club_display_name'<>'H16 A provisional main' THEN RAISE EXCEPTION 'H16 manager unlinked main edit failed'; END IF;
END $owner$;

DO $sub$
DECLARE v jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('h16.guest'),true);
 BEGIN
  PERFORM public.save_club_member_display_name(current_setting('h16.public')::uuid,
   current_setting('h16.provisional_main')::uuid,'Sub main change','H16 A provisional main',false);
  RAISE EXCEPTION 'H16 sub admin edited main admin';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;

 v:=public.save_club_member_display_name(current_setting('h16.public')::uuid,
  current_setting('h16.provisional_member')::uuid,'H16 A provisional edited',NULL,false);
 IF v->>'club_display_name'<>'H16 A provisional edited' THEN RAISE EXCEPTION 'H16 sub cannot manage member'; END IF;
END $sub$;

DO $member$
DECLARE v jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('h16.member'),true);
 BEGIN
  PERFORM public.save_club_member_display_name(current_setting('h16.public')::uuid,
   current_setting('h16.provisional_member')::uuid,'H16 attempt','H16 A provisional edited',false);
  RAISE EXCEPTION 'H16 ordinary member managed unlinked';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 v:=public.save_club_member_display_name(current_setting('h16.public')::uuid,
  current_setting('h16.public_member')::uuid,'H16 A linked member',NULL,true);
 IF v->>'club_display_name'<>'H16 A linked member' THEN RAISE EXCEPTION 'H16 linked self save failed'; END IF;
 BEGIN
  PERFORM public.save_club_member_display_name(current_setting('h16.public')::uuid,
    current_setting('h16.public_member')::uuid,'H16 stale',NULL,true);
  RAISE EXCEPTION 'H16 stale optimistic lock passed';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
 END;
 v:=public.save_club_member_display_name(current_setting('h16.private')::uuid,
  current_setting('h16.private_member')::uuid,'H16 B private alias',NULL,false);
 IF v->>'club_display_name'<>'H16 B private alias' OR (v->>'public_name_confirmed')::boolean IS TRUE
 THEN RAISE EXCEPTION 'H16 private alias/consent fail'; END IF;
 BEGIN
  PERFORM public.get_public_club_directory(current_setting('h16.private')::uuid);
  RAISE EXCEPTION 'H16 private name directory exposed';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 IF (SELECT count(*) FROM public.get_public_club_directory(current_setting('h16.public')::uuid))<>4
 THEN RAISE EXCEPTION 'H16 public must show 2 unlinked and 2 approved linked'; END IF;
END $member$;
RESET ROLE;

SELECT jsonb_build_object(
 'rollback_only',true,
 'no_profile_name_change',(SELECT pp.display_name=current_setting('h16.original_member_name') FROM public.player_profiles pp
  WHERE pp.linked_auth_user_id=current_setting('h16.member')::uuid),
 'same_profile_different_group_names',(
   SELECT count(DISTINCT cm.club_display_name)=2 FROM public.club_members cm
   WHERE cm.player_profile_id=(SELECT id FROM public.player_profiles WHERE linked_auth_user_id=current_setting('h16.member')::uuid)
    AND cm.club_id IN(current_setting('h16.public')::uuid,current_setting('h16.private')::uuid)),
 'public_group_confirmed_count',(
   SELECT count(*) FROM public.club_members cm WHERE cm.club_id=current_setting('h16.public')::uuid
   AND cm.club_display_name_public_confirmed_at IS NOT NULL),
 'private_group_confirmed_count',(
   SELECT count(*) FROM public.club_members cm WHERE cm.club_id=current_setting('h16.private')::uuid
   AND cm.club_display_name_public_confirmed_at IS NOT NULL),
 'unlinked_profile_name_untouched',(
   SELECT count(*)=2 FROM public.player_profiles WHERE display_name IN('TASK08-H16-PROVISIONAL-1','TASK08-H16-PROVISIONAL-2')),
 'all_alias_changes_scoped',(
   SELECT count(*)=5 FROM public.club_members cm WHERE cm.club_id IN(current_setting('h16.public')::uuid,current_setting('h16.private')::uuid)
      AND cm.club_display_name IS NOT NULL)
) AS report;
ROLLBACK;