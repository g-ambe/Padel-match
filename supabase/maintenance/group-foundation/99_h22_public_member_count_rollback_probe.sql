-- H22 Stage only: true membership count must not depend on public name consent.
-- All fixture data (public/private clubs, members) is ROLLED BACK.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $seed$
DECLARE u1 uuid;u2 uuid;pp1 uuid;pp2 uuid;pub uuid;priv uuid;empty_pub uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.clubs)<>3
 OR (SELECT count(*) FROM public.club_members)<>12
 OR (SELECT count(*) FROM public.player_profiles)<>12
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.official_events)<>0
 OR EXISTS(SELECT 1 FROM public.clubs WHERE name LIKE 'TASK08-H22-RB-%')
 THEN RAISE EXCEPTION 'H22 Stage baseline drift'; END IF;

 SELECT id INTO STRICT u1 FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT u2 FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT pp1 FROM public.player_profiles WHERE linked_auth_user_id=u1 AND is_active;
 SELECT id INTO STRICT pp2 FROM public.player_profiles WHERE linked_auth_user_id=u2 AND is_active;
 INSERT INTO public.clubs(name,owner_id,visibility,is_active,is_deleted)
 VALUES ('TASK08-H22-RB-PUBLIC',u1,'public',true,false),
        ('TASK08-H22-RB-PRIVATE',u1,'private',true,false),
        ('TASK08-H22-RB-EMPTY',u1,'public',true,false);
 SELECT id INTO STRICT pub FROM public.clubs WHERE name='TASK08-H22-RB-PUBLIC';
 SELECT id INTO STRICT priv FROM public.clubs WHERE name='TASK08-H22-RB-PRIVATE';
 SELECT id INTO STRICT empty_pub FROM public.clubs WHERE name='TASK08-H22-RB-EMPTY';
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status,
 club_display_name,club_display_name_public_confirmed_at)
 VALUES(pub,u1,pp1,'main_admin',true,'active',NULL,NULL),
       (pub,u2,pp2,'main_admin',true,'active','H22-Confirmed',statement_timestamp());

 PERFORM set_config('h22.public',pub::text,true);
 PERFORM set_config('h22.private',priv::text,true);
 PERFORM set_config('h22.empty',empty_pub::text,true);
 PERFORM set_config('h22.user',u1::text,true);
END $seed$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h22.user'),true);
DO $contract$
DECLARE counted bigint; dir_count bigint; denied boolean;
BEGIN
 SELECT public.get_public_club_member_count(current_setting('h22.public')::uuid) INTO counted;
 IF counted<>2 THEN RAISE EXCEPTION 'H22 count should include 2 linked members irrespective of public consent'; END IF;
 SELECT count(*) INTO dir_count FROM public.get_public_club_directory(current_setting('h22.public')::uuid);
 IF dir_count>=counted THEN RAISE EXCEPTION 'H22 public name disclosure is not independent of member total'; END IF;
 PERFORM set_config('h22.active_count','true',true);
 PERFORM set_config('h22.directory_privacy','true',true);

 SELECT public.get_public_club_member_count(current_setting('h22.empty')::uuid) INTO counted;
 IF counted<>0 THEN RAISE EXCEPTION 'H22 empty public group must have exact 0'; END IF;
 PERFORM set_config('h22.empty_zero','true',true);

 denied:=false;
 BEGIN PERFORM public.get_public_club_member_count(current_setting('h22.private')::uuid);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H22 private group exposed'; END IF;
 PERFORM set_config('h22.private_blocked','true',true);

 denied:=false;
 BEGIN PERFORM public.get_public_club_member_count(gen_random_uuid());
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H22 unknown group exposed'; END IF;
 PERFORM set_config('h22.unknown_blocked','true',true);

 denied:=false;
 BEGIN PERFORM public.get_public_club_member_count(NULL);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H22 null group exposed'; END IF;
 PERFORM set_config('h22.null_blocked','true',true);
END $contract$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
DO $anonymous$
DECLARE denied boolean:=false;
BEGIN
 BEGIN PERFORM public.get_public_club_member_count(current_setting('h22.public')::uuid);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H22 anonymous RPC unexpectedly callable'; END IF;
 PERFORM set_config('h22.anon_blocked','true',true);
END $anonymous$;
RESET ROLE;

SELECT jsonb_build_object(
 'rollback_only',true,
 'linked_no_consent_counted',current_setting('h22.active_count',true)='true',
 'public_directory_still_private',current_setting('h22.directory_privacy',true)='true',
 'empty_public_zero',current_setting('h22.empty_zero',true)='true',
 'private_denied',current_setting('h22.private_blocked',true)='true',
 'unknown_denied',current_setting('h22.unknown_blocked',true)='true',
 'null_denied',current_setting('h22.null_blocked',true)='true',
 'anonymous_denied',current_setting('h22.anon_blocked',true)='true',
 'authentication_only',has_function_privilege('authenticated','public.get_public_club_member_count(uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.get_public_club_member_count(uuid)','EXECUTE'),
 'no_profile_name_backfill',(SELECT count(*)=2 FROM public.club_members
    WHERE club_id=current_setting('h22.public')::uuid AND is_active)
) AS report;
ROLLBACK;