# TASK-08-03 / #264 — Codex implementation and independent SQL review

2026-11-25. Branch: `codex/task-08-member-public-choice`.
Requirements/candidate HEAD: `9a56d46aa41cf0c7bb1be4bbe6141829e7c50408`.
Main checked at start and before PR: `19592bc79a94fe64ed52903ca317cad7fb025ec6`.
Application/build target: `b0e7e4aa3980ee33165516452df6918dd7048567`. The subsequent evidence commit only adds SQL tests and this report; exact final HEAD/Draft PR are recorded in Issue #264 and the PR.

## Status

Application implementation and scoped local checks completed. **SQL release approval pending: Medium lock-order finding returned to ChatGPT.** No formal Migration, hosted SQL, merge, deployment, infrastructure change or production-data copy. Candidates 01/02 and API_CONTRACT.md remain unchanged.

- 01 SHA256: `040ff7910c01783354f95cfe22dfa1df8cfa0389e82aa08c83596d9fc192bb26`
- 02 SHA256: `e6e84bcfe0b41de5a5cd62dfad8688e0694c0c82747109f48e1750e534fdc4e6`

## SQL independent review (one review, targeted verification)

| Area | Result and evidence |
| --- | --- |
| Baseline | All seven function-body MD5 preconditions matched. Unmodified candidate 01 applied in synthetic PGlite and disposable PostgreSQL 17. |
| Initialization | Valid linked memberships initialized; existing alias/legacy explicit confirmation and inactive rows preserved; membership IDs/roles/links, profile names and existing event/score/history/stat rows unchanged; initialization did not fabricate confirmation timestamps. |
| Authorization | Self-only linked edits; other accounts including administrators/superusers and anon refused. Direct protected INSERT/UPDATE and internal named EXECUTE refused. |
| Public boundary | Public directory retains only reference/display_name/is_unlinked; OFF omitted. Existing table ACL, RLS flags/policies and function owner/search_path/EXECUTE metadata unchanged in the fixture. Only the six intended existing function bodies changed. |
| CAS/choice | Raw NULL expected values, explicit OFF across rename, legacy edit refusal, old unnamed rejoin refusal and stale CAS checked. Real PostgreSQL two-session update waits, then rejects stale request with PT409 without overwriting the first result. |
| Joining/linking | Public named join OFF approved; recipient named OFF linked with original preview/token/merge path; final membership equals merge AFTER snapshot. |
| Restore 02 | Historical snapshots without the new key accept only a current NULL key difference. Actual later OFF or alias changes refused. Default ROLLBACK preserved and verified. No historical audit corrected. |
| Second apply | Rejected and rolled back; existing committed OFF retained. |
| Lock order | **Medium, reproduced 40P01; see below. Release review remains pending.** |

### Medium — DDL/global advisory lock order

`01_chatgpt_candidate.sql:24` takes an AccessExclusiveLock on `club_members` (subsequent DDL also locks request tables). The common advisory lock is acquired later at line 70. Existing linking operations and `save_club_member_field_v2` acquire that advisory lock before table access.

Reproduction in disposable local PostgreSQL:

1. A begins and acquires `profile_link_private.serialize_operations()`.
2. B begins and ALTERs `club_members`, acquiring AccessExclusiveLock.
3. B waits for the advisory lock; A reads `club_members` and waits for B.
4. PostgreSQL detects the cycle and aborts one participant with **40P01**. Both test transactions rolled back; the test column did not remain.

Impact: an overlapping application operation or release transaction can fail. This is not evidence of data corruption or an authorization bypass. Candidate transactionality and timeouts limit damage, but do not eliminate the reversed order.

**Return to ChatGPT:** review acquiring the common lock before any DDL, or require a verifiable operation stop/drain covering all writers. Do not silently patch the SQL. Re-review the revised SQL/plan and rerun only the affected checks before formalization. Issue finding: https://github.com/g-ambe/Padel-match/issues/264#issuecomment-7151437021 .

### Isolation limits

`tests/fixtures/member-public-choice-db.cjs` uses synthetic accounts/groups with actual historical migrations/functions, including H51/H52. Its owner-transfer table/history marker are minimal test prerequisites, not a replica of the production catalog/history. The seven exact function hashes are checked by candidate preflight; that does **not** establish whole-production schema/ACL equivalence. Auth claims are simulated. No real hosted Auth/PostgREST or production R2 test was performed. This is not a full permissions or owner-transfer regression certification.

## Application changes

- `lib/club-member-fields.ts`, `components/club-member-fields.tsx`, group roster DTO/page: field-specific v2 RPC, raw CAS, self-only name/public control. No base-table/old RPC fallback. Missing choice DTO fails closed.
- Pencil inline name editing saves on Enter/blur, not during IME composition. Name/public operations serialize per open member; OFF is saved before a pending initial name. The first-name default ON is shown as applying after name initialization. Confirmed responses show a small green circle-check for 2.5 seconds.
- Errors/unknown responses retain input, disable blind resubmission and offer an explicit latest-state read. Reload preserves draft and updates current visibility. Component unmount prevents stale completion from updating another member/group.
- Role pencil/list uses existing `saveClubMemberRole` authorization/CAS and automatically saves. Deactivate/self-leave remains confirmed and owner-protected at the bottom; existing linking search and owner handover retained.
- Named join and recipient link accept explicit OFF; separate inheritance consent/token checks retained. Choice is not silently reset to ON during preview/error refresh.
- Quiet group settings successes; meaningful submission/error notices retained. Group back/settings/detail/expand/all-items icons unified; recent-events all-items action at card header; pt explanation has an icon/text and 44px target. Profile all-items/detail icons synchronized.
- Only the match-top group-management shortcut removed. Common PADEL MATCH label added to normal match screens. SHUFFLE MATCH / CUSTOM MATCH / TEAM MATCH titles and approved descriptions; full-width bordered format-page back link. Routes, creation/storage and score/stat algorithms unchanged.
- Relevant tutorial demo and common help wording synchronized; demo data isolation unchanged. Card title type widened to ReactNode only to support the requested header action; rendered wrapper unchanged.

## Executed checks

- `node --test --test-isolation=none tests/club-member-fields.test.cjs tests/public-club-join.test.cjs tests/recipient-profile-link.test.cjs tests/club-display-name.test.cjs tests/member-public-choice-db.test.cjs`: **42 passed**.
- `tests/member-public-choice-concurrency.cjs`: real local PostgreSQL CAS positive/negative PASS; DDL lock-order **finding 40P01 reproduced**, not a release PASS.
- `tests/browser/club-display-name.cjs`: **320/375px, light/dark PASS**; inline/IME, OFF-first ordering, in-flight serialization, conflict/input preservation/reload, linked-other restriction, role auto-save, bottom removal action, group operation popup, tap targets/overflow. Synthetic API.
- `tests/browser/public-club-join.cjs`: **375px light/dark PASS**; plain join OFF, separate inheritance consent, preview refresh, error/input preservation, no legacy fallback. Synthetic API.
- `tests/browser/recipient-profile-link.cjs`: **375px light/dark PASS**; OFF selectable without removing inheritance consent, error/CAS/reload/network recovery, private-group/reject/cancel behavior. Synthetic Auth/API.
- `NAVIGATION_TEST_URL=http://127.0.0.1:3070 node tests/browser/event-create-flow.cjs`: **PASS**; three renamed formats/info popups, existing auto/manual/team/guest flows and draft navigation, 320/375/390px overflow checks in both themes. Synthetic API.
- TypeScript: `npx tsc --noEmit` PASS (also checked by final Next build).
- Cloudflare: `npm run cf:build` PASS; Worker bundle generated locally, no deploy. Synthetic loopback Supabase configuration, no hosted credentials supplied.
- `git diff --check` PASS; candidate SQL unchanged.

Initial fixture checks exposed missing existing H52 media-FK guard; the fixture was completed with the existing H52 SQL. A timestamp comparison was corrected to compare PostgreSQL JSON against PostgreSQL JSON. Browser mocks/expectations were updated for the approved OFF behavior and existing popup restoration. No application/SQL assertion was disabled to force a pass.

For the optional real PostgreSQL script, use a new disposable database named `member_public_review` on `127.0.0.1`, install `pg` outside the repository, and set `MEMBER_PUBLIC_TEST_DB_URL` explicitly. The script rejects other hosts/database names. The one-off Docker instance used tmpfs storage and was removed after the test. No new dependency or lockfile change.

## Remaining gates

1. ChatGPT resolves the Medium lock-order finding in SQL/verified apply plan; original candidates remain untouched here.
2. Independent final DB/release approval, formal Migration numbering and live preflight/backups/recovery scope require the separately approved release process.
3. New UI/v2 RPC require coordinated DB/app release: old clients editing linked aliases receive intentional PT409; new UI refuses incomplete old DTO. This PR is not ready to deploy against the old DB.
4. Real Auth/PostgREST, physical iPhone acceptance, production counts/current data and hosted integration remain unverified. Screenshot comparison/full unrelated regression and tutorial-menu browser suite were not run.
5. Existing workerd compatibility-date and Node module-type warnings remain; no config/package changes made for them.
6. GitHub Project #2 returned `Resource not accessible by integration (user.projectV2)`; fields not synchronized. Issue #264/PR are the written progress record. Issue stays open, PR stays Draft.
