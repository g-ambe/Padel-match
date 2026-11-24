-- TASK-08 P0, staging-only metadata/shape probe. READ ONLY.
-- Never return profile ids, names, preview bodies, review tokens, or auth data.
-- This single-club sample cannot prove cross-club authorization.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
WITH sample AS (
 SELECT cm.club_id,pp.id AS player_id
 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE pp.linked_auth_user_id IS NULL AND pp.is_active AND cm.is_active
 ORDER BY cm.id LIMIT 1
), shapes AS (
 SELECT profile_link_private.preview(s.player_id,
         '00000000-0000-0000-0000-000000000001'::uuid) AS full_preview,
        profile_link_private.scoped_preview(s.player_id,
         '00000000-0000-0000-0000-000000000001'::uuid,s.club_id) AS scoped_preview
 FROM sample s
)
SELECT jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),
 'sample_available',EXISTS(SELECT 1 FROM sample),
 'same_top_level_keys',coalesce((SELECT
   (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(full_preview) k)
   = (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(scoped_preview) k)
   FROM shapes),false),
 'full_has_review_token',coalesce((SELECT full_preview ? 'review_token' FROM shapes),false),
 'scoped_has_review_token',coalesce((SELECT scoped_preview ? 'review_token' FROM shapes),false),
 'review_token_equal',coalesce((SELECT full_preview->>'review_token' = scoped_preview->>'review_token'
   FROM shapes),false),
 'full_memberships_count',(SELECT jsonb_array_length(coalesce(full_preview->'memberships','[]'::jsonb)) FROM shapes),
 'scoped_memberships_count',(SELECT jsonb_array_length(coalesce(scoped_preview->'memberships','[]'::jsonb)) FROM shapes)
) AS result;
ROLLBACK;
