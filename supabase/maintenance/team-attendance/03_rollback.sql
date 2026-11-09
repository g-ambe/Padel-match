-- DB外バックアップを保存し、旧アプリへの切戻しを確認した管理者のみ。
-- 既定はROLLBACK。出欠データも戻したい場合はバックアップから隔離復元して照合する。
BEGIN;
DROP TRIGGER guard_team_side_group ON public.event_team_sides;
DROP TRIGGER guard_team_lineup_attendance ON public.event_team_matches;
DROP FUNCTION team_attendance_private.guard_side_group();
DROP FUNCTION team_attendance_private.guard_lineup();
DROP FUNCTION public.set_friendly_team_attendance(uuid,text,uuid,uuid,text);
DROP TABLE public.event_team_attendance;
DROP SCHEMA team_attendance_private;
ROLLBACK;
