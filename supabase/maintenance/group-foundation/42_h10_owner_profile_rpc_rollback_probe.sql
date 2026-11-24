-- TASK-08 H10: STAGING ONLY / ROLLBACK-only existing owner-only read/write RPC verification.
-- Do NOT GRANT bio/level/details SELECT/UPDATE to all authenticated users.
-- Existing public.get_my_player_profiles and public.save_my_player_profile
-- delegate to security_private helpers with auth.uid ownership checks.
-- Also test manager unlinked-name and outsider denial without persisted edits.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='35s';
DO $setup$
DECLARE ua uuid;ur uuid;ux uuid;pa uuid;pr uuid;pu uuid;
BEGIN
 IF current_user<>'postgres' OR
  (SELECT count(*) FROM public.clubs WHERE name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B'))<>2
 OR (SELECT count(*) FROM public.player_profiles WHERE display_name='TASK08-P0 provisional U' AND linked_auth_user_id IS NULL AND is_active)<>1
 THEN RAISE EXCEPTION 'H10 fixture drift'; END IF;
 SELECT id INTO STRICT ua FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT ur FROM auth.users WHERE lower(email)='recipient@example.com';
 SELECT id INTO STRICT ux FROM auth.users WHERE lower(email)='outsider@example.com';
 SELECT id INTO STRICT pa FROM public.player_profiles WHERE linked_auth_user_id=ua AND is_active;
 SELECT id INTO STRICT pr FROM public.player_profiles WHERE linked_auth_user_id=ur AND is_active;
 SELECT id INTO STRICT pu FROM public.player_profiles WHERE display_name='TASK08-P0 provisional U' AND linked_auth_user_id IS NULL AND is_active;
 PERFORM set_config('task08.main',ua::text,true);
 PERFORM set_config('task08.rec',ur::text,true);
 PERFORM set_config('task08.outsider',ux::text,true);
 PERFORM set_config('task08.main_player',pa::text,true);
 PERFORM set_config('task08.rec_player',pr::text,true);
 PERFORM set_config('task08.unlinked',pu::text,true);
 PERFORM set_config('request.jwt.claim.sub',ua::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $owner$
DECLARE existing public.player_profiles;saved public.player_profiles;n int;
 expected jsonb;values jsonb;err text;direct_code text:='OK';stale_code text:='OK';
BEGIN
 SELECT * INTO STRICT existing FROM public.get_my_player_profiles();
 IF existing.id <> current_setting('task08.main_player')::uuid THEN RAISE EXCEPTION 'owner-only list mismatch'; END IF;
 SELECT count(*) INTO n FROM public.get_my_player_profiles();
 PERFORM set_config('task08.owner_only_list',(n=1 AND existing.linked_auth_user_id=auth.uid())::text,true);
 BEGIN PERFORM bio FROM public.player_profiles LIMIT 1;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS direct_code=RETURNED_SQLSTATE; END;
 PERFORM set_config('task08.raw_bio_denied',(direct_code='42501')::text,true);
 expected:=jsonb_build_object('display_name',existing.display_name,
   'bio',existing.bio,'play_level',existing.play_level,
   'dominant_hand',existing.dominant_hand,'preferred_position',existing.preferred_position,
   'activity_area',existing.activity_area);
 values:=jsonb_build_object('display_name','TASK08-H10-ROLLBACK',
   'bio','TASK08-H10-ROLLBACK-BIO','play_level','中級',
   'dominant_hand','右','preferred_position','左サイド','activity_area','埼玉県');
 saved:=public.save_my_player_profile(existing.id,values,expected);
 PERFORM set_config('task08.owner_update_ok',(
   saved.id=existing.id AND saved.linked_auth_user_id=auth.uid()
   AND saved.display_name='TASK08-H10-ROLLBACK'
   AND saved.bio='TASK08-H10-ROLLBACK-BIO'
   AND saved.play_level='中級'
   AND saved.dominant_hand='右'
   AND saved.preferred_position='左サイド'
   AND saved.activity_area='埼玉県'
 )::text,true);
 BEGIN
  PERFORM public.save_my_player_profile(existing.id,
   jsonb_build_object('display_name','TASK08-H10-STALE'),
   jsonb_build_object('display_name',existing.display_name));
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS stale_code=RETURNED_SQLSTATE; END;
 PERFORM set_config('task08.stale_rejected',(stale_code='P0001')::text,true);
END $owner$;
DO $unauthorized$
DECLARE code text;id_ uuid;n int; fullname text; saved public.player_profiles;
BEGIN
 -- Attempt to alter someone's linked account via the owner RPC.
 BEGIN
  saved:=public.save_my_player_profile(current_setting('task08.main_player')::uuid,
   jsonb_build_object('linked_auth_user_id',current_setting('task08.rec')),
   jsonb_build_object('linked_auth_user_id',current_setting('task08.main')));
  PERFORM set_config('task08.id_mutation_rejected','false',true);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  PERFORM set_config('task08.id_mutation_rejected',(code='P0001')::text,true);
 END;
 -- Main A can edit an active unlinked club member name.
 UPDATE public.player_profiles SET display_name='TASK08-H10-TEMP-U'
 WHERE id=current_setting('task08.unlinked')::uuid AND linked_auth_user_id IS NULL AND is_active
 RETURNING id,display_name INTO id_,fullname;
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM set_config('task08.manager_unlinked_name_ok',(n=1 AND fullname='TASK08-H10-TEMP-U')::text,true);
END $unauthorized$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $outsider$
DECLARE code text;out_id uuid;n int;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.outsider'),true);
 BEGIN
  PERFORM public.save_my_player_profile(current_setting('task08.main_player')::uuid,
   jsonb_build_object('display_name','TASK08-H10-FORBIDDEN'),
   jsonb_build_object('display_name','TASK08-H10-ROLLBACK'));
  PERFORM set_config('task08.other_owner_rejected','false',true);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  PERFORM set_config('task08.other_owner_rejected',(code='P0001' OR code='42501')::text,true);
 END;
 UPDATE public.player_profiles SET display_name='TASK08-H10-FORBIDDEN-U'
 WHERE id=current_setting('task08.unlinked')::uuid
 RETURNING id INTO out_id;
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM set_config('task08.outsider_unlinked_denied',(n=0)::text,true);
END $outsider$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'owner_only_list',current_setting('task08.owner_only_list')::boolean,
 'raw_bio_select_privacy_enforced',current_setting('task08.raw_bio_denied')::boolean,
 'owner_full_update_and_returning',current_setting('task08.owner_update_ok')::boolean,
 'stale_compare_and_swap_rejected',current_setting('task08.stale_rejected')::boolean,
 'linked_auth_mutation_rejected',current_setting('task08.id_mutation_rejected')::boolean,
 'manager_unlinked_name_returning',current_setting('task08.manager_unlinked_name_ok')::boolean,
 'outsider_other_owner_rejected',current_setting('task08.other_owner_rejected')::boolean,
 'outsider_unlinked_name_denied',current_setting('task08.outsider_unlinked_denied')::boolean
) AS report;
ROLLBACK;
