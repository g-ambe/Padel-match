# TASK-08-02 local remaining checks

Base: `c812a0c0f742b36639e11e3ba2dfb51bd91485d0`. Candidate rev06 SHA256: `1c039a661628d229b25d1bd123946dda246233585e3e3901fc7614202429c7b6`.

`python3 supabase/maintenance/club-invitations/isolated-http/run.py` completed successfully. It uses an internal Docker network, PostgreSQL 17, GoTrue, PostgREST, Mailpit and synthetic accounts only. The runner removed and verified removal of its containers and network and removed its temporary synthetic state. No production or stage connection or external mail was used.

The baseline is synthetic: migrations 0040–0043, 0053 and 0062–0065 are omitted; H51/H52 preflight is adapted, development RLS and mock Vault are used. A disposable candidate copy commits and removes the send-off check; delivery is mocked. The restore script is the repository public-choice-compatible `04_restore_reviewed_merge.sql`, with the synthetic merge ID and COMMIT substituted only in the local execution string. These results do not establish production catalogue or Worker compatibility.

## Results

- PASS: direct and invitation merges restored source membership, active source profile, merge audit and restoration notification. Synthetic match-player ownership and scores were restored without changing scores. Editing an audited row blocked restore; restoring twice was rejected. Replaying the same invite operation after restore did not create another active merge.
- PASS: an active own-group invitation DTO was unchanged after a different group reserved the same recipient. Same-recipient cancel/expiry then reinvite produced a new invitation; old bearer was refused and all three attempts remained in the quota history.
- PASS: eight parallel database calls to the invitation fixed window resulted in three accepts and five denials. A valid bearer used the anonymous resend path through PostgREST, with a neutral denial after the limit. Other quota limits also apply; this is not a claim that three emails were delivered.
- PASS (existing integration fixture): real local signup, email confirmation, JWT, PostgREST invitation acceptance, ordinary join/notification and manager demotion denial. Restore and reinvite tests ran in the same disposable environment.
- NOT RUN: simultaneous merges from distinct requests, accept-winning concurrent cancellation with a complete before/after comparison of all audit, ticket and delivery rows, and an application ranking calculation before and after merge. Previous tests covered other concurrency cases but do not prove these scenarios. A dedicated two-request race fixture and a fixture using the existing ranking calculation are needed.
- OUT OF SCOPE: Worker trusted IP, production Vault/cron and production catalogue comparison. No production equivalence is claimed.

No new product defect was established by these checks. Formal SQL readiness remains NO-GO until the unrun concurrency and ranking checks and separately required release checks are completed; app implementation readiness is not asserted here. The PR must remain draft.
