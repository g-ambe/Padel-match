BEGIN READ ONLY;
SELECT policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename='clubs' ORDER BY policyname;
COMMIT;
