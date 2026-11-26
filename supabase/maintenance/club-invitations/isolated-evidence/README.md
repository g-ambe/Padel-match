# TASK-08-02 synthetic PostgreSQL evidence

These scripts test candidate `04_integrated_review_candidate.sql` at SHA256 `10a191b43f10751c28f23cbf06210affb81438e8ff3d81bb93b85a0b9818526e`. They are not migrations, release tools, or evidence of production schema, real Auth, PostgREST or SMTP. Do not supply hosted credentials or production data.

On an authorized disposable Docker host with the already-present `postgres:17-alpine` image, run from the repository root:

```
python3 supabase/maintenance/club-invitations/isolated-evidence/run.py
```

The runner creates a uniquely named container with `--network none`, no published ports and tmpfs data, then removes that container in `finally`. Its fixed password and user/email fixtures are synthetic. It loads repository migrations 0001–0039, 0044–0052, 0054–0061 and 20261125032915 with the dependencies described in PR #273 comment 7187183664. Migrations 0040–0043, 0053, 0062–0064 are not applied. A local revoke of anon SELECT is used to satisfy 0056. Copies of H51/H52 skip only specified absent production-history/test-marker prerequisites; their source is never changed. This is not equivalent to the current production catalog or RLS/ACL.

For multi-session tests only, the candidate's final ROLLBACK is changed to COMMIT in memory. `fixtures.sql` drops the send-off CHECK in this disposable DB only and supplies fake Vault keys; all delivery results are mocked. Source SQL remains untouched. Tests include unregistered acceptance/notification/scores, selected DB role checks, retention 29/31 days, invalid key, rebind, two-direction score lock timeout/12-table snapshots and retry. SQLSTATE 55P03 is asserted with a *test-only* 500ms lock timeout; it is not a production latency estimate. Refer to Issue #262 and PR #273 for omissions and additional manually run evidence.
