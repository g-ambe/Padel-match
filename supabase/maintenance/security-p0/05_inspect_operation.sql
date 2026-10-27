-- 管理者による読み取り専用点検。認証情報やトークンを出力しない。
begin transaction read only;
-- 対象の操作監査UUIDを安全な管理接続で選択する。業務行はまだ変更しない。
select request_id,kind,created_at,restored_at from security_p0_history.operations order by created_at desc limit 30;
-- 実際の対象UUIDを指定して、テーブル別の変更件数・対象ID・変更理由を確認する。
-- select table_name,count(*) from security_private.operation_changes('対象操作UUID') group by table_name;
-- select table_name,row_id from security_private.operation_changes('対象操作UUID');
rollback;
