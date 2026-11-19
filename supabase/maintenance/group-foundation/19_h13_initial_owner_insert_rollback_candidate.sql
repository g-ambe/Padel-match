-- TASK-08 / H13: ROLLBACK-ONLY staging prototype for first club + owner membership.
-- NOT an installable migration. DO NOT APPLY TO PRODUCTION.
-- This is intentionally owner-only, not a copy of production's broad INSERT grants.
-- Concurrent first-member inserts/unique constraints need separate review before commit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
 IF current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE name='TASK08-P0-20261119-A')
 OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN('clubs','club_members') AND cmd='INSERT')
 OR has_table_privilege('authenticated','public.clubs','INSERT')
 OR has_table_privilege('authenticated','public.club_members','INSERT')
 THEN RAISE EXCEPTION 'H13 stage insert state drift; stop'; END IF;
END $guard$;
CREATE FUNCTION security_private.task08_initial_owner_member_allowed(
 p_club uuid,p_profile uuid,p_player uuid,p_role text,p_is_active boolean,p_status text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $task08_owner$
DECLARE owner_ok boolean;
BEGIN
 IF auth.uid() IS NULL OR p_profile IS DISTINCT FROM auth.uid()
    OR p_role IS DISTINCT FROM 'main_admin'
    OR p_is_active IS DISTINCT FROM true OR p_status IS DISTINCT FROM 'active'
 THEN RETURN false; END IF;
 -- Lock the owner club row before the initial-membership absence check,
 -- so concurrently attempted initial inserts serialize on the club.
 SELECT true INTO owner_ok FROM public.clubs c
  WHERE c.id=p_club AND c.owner_id=auth.uid() AND c.is_active AND NOT c.is_deleted
  FOR UPDATE;
 IF NOT coalesce(owner_ok,false) THEN RETURN false; END IF;
 RETURN EXISTS (SELECT 1 FROM public.player_profiles p WHERE p.id=p_player
                 AND p.linked_auth_user_id=auth.uid() AND p.is_active)
        AND NOT EXISTS (SELECT 1 FROM public.club_members cm WHERE cm.club_id=p_club);
END $task08_owner$;
REVOKE ALL ON FUNCTION security_private.task08_initial_owner_member_allowed(uuid,uuid,uuid,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION security_private.task08_initial_owner_member_allowed(uuid,uuid,uuid,text,boolean,text) TO authenticated;
GRANT INSERT(name,description,owner_id,is_active,visibility) ON public.clubs TO authenticated;
GRANT INSERT(club_id,profile_id,player_profile_id,role,is_active) ON public.club_members TO authenticated;
CREATE POLICY task08_clubs_initial_owner_insert ON public.clubs
 FOR INSERT TO authenticated WITH CHECK(
  auth.uid() IS NOT NULL AND owner_id=auth.uid() AND is_active AND NOT is_deleted);
CREATE POLICY task08_club_members_initial_owner_insert ON public.club_members
 FOR INSERT TO authenticated WITH CHECK(
  security_private.task08_initial_owner_member_allowed(
    club_id,profile_id,player_profile_id,role,is_active,status));
DO $setup$
DECLARE a uuid;r uuid;main_player uuid; recipient_player uuid;
BEGIN
 SELECT id INTO STRICT a FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT r FROM auth.users WHERE lower(email)='recipient@example.com';
 SELECT id INTO STRICT main_player FROM public.player_profiles WHERE linked_auth_user_id=a AND is_active;
 SELECT id INTO STRICT recipient_player FROM public.player_profiles WHERE linked_auth_user_id=r AND is_active;
 PERFORM set_config('task08.main',a::text,true);
 PERFORM set_config('task08.recipient',r::text,true);
 PERFORM set_config('task08.main_player',main_player::text,true);
 PERFORM set_config('task08.recipient_player',recipient_player::text,true);
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $positive_negative$
DECLARE new_club uuid;new_member uuid; denied_other_owner boolean:=false;
 denied_wrong_role boolean:=false; denied_wrong_player boolean:=false;denied_duplicate boolean:=false;
 denied_other_user boolean:=false;
BEGIN
 BEGIN
  INSERT INTO public.clubs(name,owner_id,is_active,visibility)
  VALUES('TASK08-H13-ROLLBACK-FOREIGN',current_setting('task08.recipient')::uuid,true,'private');
 EXCEPTION WHEN insufficient_privilege THEN denied_other_owner:=true;
 WHEN SQLSTATE 'P0001' THEN
   denied_other_owner:=position('グループ所有者' IN SQLERRM)>0;
 END;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility)
 VALUES('TASK08-H13-ROLLBACK-SELF',current_setting('task08.main')::uuid,true,'private')
 RETURNING id INTO new_club;
 PERFORM set_config('task08.created_club',new_club::text,true);
 BEGIN
  INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active)
  VALUES(new_club,current_setting('task08.main')::uuid,current_setting('task08.main_player')::uuid,'member',true);
 EXCEPTION WHEN insufficient_privilege THEN denied_wrong_role:=true;
 END;
 BEGIN
  INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active)
  VALUES(new_club,current_setting('task08.main')::uuid,current_setting('task08.recipient_player')::uuid,'main_admin',true);
 EXCEPTION WHEN insufficient_privilege THEN denied_wrong_player:=true;
 WHEN SQLSTATE 'P0001' THEN
   denied_wrong_player:=position('旧profile_idと選手の連携アカウント' IN SQLERRM)>0;
 END;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active)
 VALUES(new_club,current_setting('task08.main')::uuid,current_setting('task08.main_player')::uuid,'main_admin',true)
 RETURNING id INTO new_member;
 BEGIN
  INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active)
  VALUES(new_club,current_setting('task08.main')::uuid,current_setting('task08.main_player')::uuid,'main_admin',true);
 EXCEPTION WHEN insufficient_privilege THEN denied_duplicate:=true;
 END;
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.recipient'),true);
 BEGIN
  INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active)
  VALUES(new_club,current_setting('task08.recipient')::uuid,current_setting('task08.recipient_player')::uuid,'main_admin',true);
 EXCEPTION WHEN insufficient_privilege THEN denied_other_user:=true;
 END;
 PERFORM set_config('task08.owner_created',(new_club IS NOT NULL AND new_member IS NOT NULL)::text,true);
 PERFORM set_config('task08.denied_other_owner',denied_other_owner::text,true);
 PERFORM set_config('task08.denied_wrong_role',denied_wrong_role::text,true);
 PERFORM set_config('task08.denied_wrong_player',denied_wrong_player::text,true);
 PERFORM set_config('task08.denied_duplicate',denied_duplicate::text,true);
 PERFORM set_config('task08.denied_other_user',denied_other_user::text,true);
END $positive_negative$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'owner_and_main_member_created',current_setting('task08.owner_created')::boolean,
 'other_owner_denied',current_setting('task08.denied_other_owner')::boolean,
 'wrong_role_denied',current_setting('task08.denied_wrong_role')::boolean,
 'wrong_profile_denied',current_setting('task08.denied_wrong_player')::boolean,
 'duplicate_self_denied',current_setting('task08.denied_duplicate')::boolean,
 'other_user_denied',current_setting('task08.denied_other_user')::boolean,
 'new_club_count',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H13-ROLLBACK-SELF'),
 'new_member_count',(SELECT count(*) FROM public.club_members WHERE club_id=current_setting('task08.created_club')::uuid)
) AS report;
ROLLBACK;
