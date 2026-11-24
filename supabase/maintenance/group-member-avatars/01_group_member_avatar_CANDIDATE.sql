-- TASK-08-03 / #264, #241: candidate only, not approved for production.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $preflight$
BEGIN
  IF current_user <> 'postgres'
     OR to_regprocedure('group_read_private.member(uuid)') IS NULL
     OR to_regprocedure('profile_media_private.proof(text)') IS NULL
     OR to_regprocedure('public.get_group_member_avatar_for_worker(uuid,uuid,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'Group avatar RPC precondition changed; stop';
  END IF;
END $preflight$;

CREATE FUNCTION public.get_group_member_avatar_for_worker(
  p_club_id uuid, p_member_id uuid, p_proof text
)
RETURNS TABLE (
  profile_id uuid, avatar_key text, avatar_version bigint,
  avatar_focus_x double precision, avatar_focus_y double precision,
  avatar_zoom double precision, avatar_pose_version bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Authenticated user AND trusted Worker: never accept a caller-supplied viewer ID.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM profile_media_private.proof(p_proof);
  IF p_club_id IS NULL OR p_member_id IS NULL
     OR NOT group_read_private.member(p_club_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pp.id, m.avatar_key, m.avatar_version,
         m.avatar_focus_x, m.avatar_focus_y, m.avatar_zoom, m.avatar_pose_version
  FROM public.club_members cm
  JOIN public.player_profiles pp ON pp.id = cm.player_profile_id
  JOIN public.player_profile_private m ON m.profile_id = pp.id
  JOIN public.profile_media_objects o
    ON o.object_key = m.avatar_key AND o.profile_id = pp.id AND o.state = 'active'
  WHERE cm.club_id = p_club_id AND cm.id = p_member_id
    AND cm.is_active AND pp.is_active
    AND pp.linked_auth_user_id IS NOT NULL
    AND m.owner_id = pp.linked_auth_user_id
    AND m.avatar_key IS NOT NULL
    AND m.avatar_key ~ ('^profiles/' || pp.id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.webp$');
END $function$;

REVOKE ALL ON FUNCTION public.get_group_member_avatar_for_worker(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_group_member_avatar_for_worker(uuid,uuid,text)
  TO authenticated;

DO $postflight$
BEGIN
  IF has_function_privilege('anon','public.get_group_member_avatar_for_worker(uuid,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.get_group_member_avatar_for_worker(uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('service_role','public.get_group_member_avatar_for_worker(uuid,uuid,text)','EXECUTE')
  THEN RAISE EXCEPTION 'Unexpected group avatar RPC ACL';
  END IF;
END $postflight$;
COMMIT;
