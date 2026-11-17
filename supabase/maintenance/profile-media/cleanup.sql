-- 読み取り監視用。画像本体や氏名・オブジェクトキーは出力しない。
BEGIN READ ONLY;
SELECT state,count(*) AS objects FROM public.profile_media_objects GROUP BY state ORDER BY state;
SELECT count(*) AS overdue_unreferenced FROM public.profile_media_objects o WHERE state='garbage' AND collect_after<clock_timestamp()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM public.player_profile_private m WHERE m.avatar_key=o.object_key);
SELECT count(*) AS active_leases FROM public.profile_media_operations WHERE status='pending' AND expires_at>clock_timestamp();
ROLLBACK;
