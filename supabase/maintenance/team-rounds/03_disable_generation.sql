-- 障害時の安全な停止。既存のカード・スコア・動画は保持し、更新RPCを維持する。
BEGIN;
REVOKE EXECUTE ON FUNCTION public.create_friendly_team_round(uuid,uuid,text,text,integer,jsonb) FROM authenticated;
COMMIT;
