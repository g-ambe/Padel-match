# AGENTS.md

## Project rules

- Continue from the existing active branch whenever possible.
- Do not create duplicate pull requests.
- If an open PR already exists for this task, update that PR instead of opening a new one.
- Keep PRs small and focused.
- Do not change unrelated features.
- Do not rewrite large parts of the app unless explicitly asked.

## Deployment rules

- This project deploys to Cloudflare Workers / Pages using OpenNext.
- Do not use Vercel-specific features.
- Do not use `export const runtime = "edge"`.
- Keep Cloudflare compatibility.
- Avoid Node.js-only APIs such as `fs`, `child_process`, and server-side filesystem access.
- Prefer `fetch` and Supabase SDK.

## UI rules

- All visible frontend UI text must be Japanese.
- Keep the UI mobile-first.
- Use dark sports-app style.
- Prefer short Japanese labels.

## Tutorial and help synchronization

- When changing UI, routes, button labels, interactions, or feature behavior, check the related tutorial and 「使い方・ヘルプ」 for impact.
- If affected, update the relevant screens, interactions, and explanations in the same PR so they match the production UI. Check both the first-use tutorial and topic-specific manual.
- Update related content without an extra confirmation request unless the user's instructions require approval. Limit inspection and changes to the relevant parts to conserve Codex credits.
- Preserve isolated demo data; tutorial operations must not create or change real app data.
- Do not change unrelated content. Changes without UI or tutorial/help impact do not require tutorial edits.

## Product rules

- This is a realtime padel club operation app.
- It is not a tournament management app.
- Do not add timetable features.
- Focus on current round, next round generation, score input, rankings, and player stats.

## Verification

Before finishing, check:
- TypeScript build
- Cloudflare deployment compatibility
- No duplicate PR was created unnecessarily

# GitHub Task Management Rules

## Source of Truth

GitHub Issues and GitHub Projects are the single source of truth for development task management.

- Repository: g-ambe/Padel-match
- Project: [https://github.com/users/g-ambe/projects/2/views/1](https://github.com/users/g-ambe/projects/2/views/1)
- Existing task Issues: #215–#260
- Fixed parent tasks: TASK-01 through TASK-08
- Other tasks: OTHER-XX

Do not rename, merge, reorder, or repurpose the eight parent tasks without explicit user instructions.

Do not update the old Excel task ledger.

## Before Development

Before starting a development task:

1. Read AGENTS.md and the relevant Issue.
2. Search existing open and closed Issues.
3. Check existing branches and PRs.
4. Confirm the TASK-ID, approved requirements, scope, and acceptance criteria.
5. Reuse an existing working branch and PR whenever possible.
6. Never create duplicate Issues or PRs.
7. Do not create a new branch from main without explicit authorization.
8. Do not modify unrelated features.

If a task already has a corresponding Issue, update that Issue instead of creating another.

If no Issue exists, check the parent task and report the missing task record. Create a new Issue only when the required scope is clear and the action is authorized.

## During Development

Keep the related Issue updated at meaningful milestones:

- Development started
- Implementation completed
- Tests passed or failed
- PR created or updated
- Review changes completed
- PR merged
- Production deployed
- Verification completed
- Outstanding issues identified

Always distinguish implementation, testing, merging, deployment, and user acceptance.

Do not mark tests as passed unless actually executed.

Do not claim production deployment or user verification without evidence.

## Project Synchronization

The GitHub Project is configured to automatically add matching Issues.

When Project API access is available, read and update the corresponding Project item.

For GitHub CLI, project access may be checked with:

gh project item-list 2 --owner g-ambe --limit 100 --format json

Read access requires suitable project permissions.

Project updates require appropriate write permissions.

If Project field updates are unavailable, preserve all status information in the existing Issue and report that Project fields were not synchronized.

Never claim successful synchronization without verification.

## Pull Requests and Branches

- Follow the existing AGENTS.md rules.
- Reuse existing working branches and PRs where possible.
- Do not create duplicate PRs.
- Do not create new branches from main without authorization.
- Create a new PR only when necessary and authorized.
- Keep changes focused on the requested task.
- Do not change unrelated app features.
- Commit only the requested fix.

Always link relevant Issues and PRs.

Do not automatically close an Issue solely because a PR was merged if deployment, user testing, or other acceptance criteria remain incomplete.

## Verification and Cost Control

For UI-only modifications, run only the necessary lightweight related checks unless additional verification is required.

For logic, authentication, database, security, RLS, scoring, or data persistence changes, perform the relevant tests and safety checks.

Avoid unnecessary full test runs to conserve Codex credits.

Maintain existing Cloudflare compatibility and deployment protections.

Never modify production databases, credentials, or infrastructure without authorization.

## Reporting

At the end of each task, report:

- TASK-ID and Issue number
- Work completed
- Files changed
- Related PR and branch
- Tests performed and results
- Merge and deployment status
- Remaining issues or unverified items
- GitHub Issue and Project update status

Update the existing Issue with the final results.

If a task is blocked or not completed, preserve its pending status and clearly state why.

## Existing Product Requirements

Preserve existing application behavior and approved specifications.

Do not invent missing requirements.

Do not implement features outside the requested scope.

Keep tutorial and help content synchronized when relevant UI or behavior changes, according to the existing AGENTS.md rules.

# GitHub-Centered Development Collaboration

Approved operating policy (2026-11-24). Applies to ChatGPT, Codex, and subsequent conversations; it supplements the existing rules above without changing product scope.

## Authoritative Records and Resuming Work

- GitHub is the authoritative development record. The old Excel ledger is retired. Chat history, memory, and generated summaries are not authoritative progress records.
- At the start of every new task or resumed conversation, read the current main AGENTS.md, the active branch AGENTS.md (including applicable nested instructions), the relevant parent/child Issues and latest comments, Projects when accessible, approved design documents, active PR and exact HEAD, and relevant Actions results. Check actual source and deployment/migration state when material.
- Use approved Issues and versioned design documents for requirements; current PR/commit for implemented behavior; actual Actions results for tested behavior; actual deployed Worker version and Supabase migration/catalog state for production or staging behavior. GitHub records intent and evidence; it does not by itself prove live deployment or DB state.
- An old Issue body, stale Project status, earlier chat, or test on a different commit must not override newer verified evidence. Resolve conflicting requirements with the user; do not infer approval from a later implementation or comment.
- The existing Issue-number range above is historical, not a limit: discover subsequent Issues and use the fixed TASK-ID hierarchy. Preserve the eight parent tasks. Update existing records rather than duplicating them.
- If evidence or access is missing, mark the item unverified or blocked and state what is missing. Never reconstruct missing decisions by guessing. If the current branch has older rules, preserve and reconcile the latest main rules before work; honor user-approved pending rules recorded in the relevant Issue while their PR remains unmerged.

## ChatGPT and Codex Collaboration

- User / product owner: decides requirements, scope, priorities, trade-offs, acceptance and explicit production release authorization.
- ChatGPT: leads proposals, requirement clarification, UI/UX and technical design, impact analysis, acceptance criteria, DB schema/migration/RLS/ACL/RPC design, SQL preparation and validation strategy, and independent app/DB integration and safety review. With suitable access and authorization, ChatGPT may perform read-only DB checks, prepare versioned SQL and execute isolated or authorized staging SQL tests. Clearly distinguish recommendations, candidate SQL, executed tests and approved production migrations.
- Codex: leads concrete application implementation (Next.js/TypeScript, UI, API/RPC client integration), code-level investigation, relevant unit/integration/browser tests, Cloudflare-compatible build checks, commits and PR updates. Implement approved scope; raise design or DB-contract gaps before changing agreed behavior.
- Both agents may assist outside their primary scope if necessary and explicitly coordinated; neither silently changes the agreed design, takes over concurrent edits, bypasses review, or grants itself production authorization. For DB or security changes, obtain an independent review of the proposed migration and application contract before release. Agent labels are responsibility defaults, not proof of access or successful execution.
- Keep versioned SQL, migration candidates, test scripts and detailed evidence in the repository; keep the Issue as the concise coordination record linking that evidence. Never paste secrets, raw private production rows, tokens or sensitive backup contents into Issues, logs or commits.

## Work Coordination and Handoff

- Before editing, identify TASK-ID, parent/child Issue, approved scope, responsible agent, current branch/PR and exact HEAD, files or paths assigned, dependencies, planned test scope, and any active work by another agent. Record the work boundary in the relevant Issue/PR when coordination is needed.
- Prefer one active PR per task. Reuse it unless an explicitly authorized independent change needs a separate PR. Do not edit the same files concurrently. Check HEAD and file changes again before writing; if another agent has changed the target or contract, stop and reconcile rather than overwriting. Do not force-push or discard another agent's changes.
- Use the smallest necessary commits; separate SQL/DB work, app work and documentation where practical. Do not include unrelated changes. Check main rules and relevant dependencies again before integration.
- At each meaningful milestone and before handoff, record TASK-ID/Issue/PR, branch and commit SHA, changes, test commands or Actions run links and actual results (including failures/skipped/unverified tests), environment, changes to DB/deployment or none, risks/blockers, remaining work and the specific next action. Update the existing Issue and Project if permitted. Use PR comments or linked versioned reports for detailed evidence. Do not rely on a final chat summary.
- For interrupted work, preserve the last verified checkpoint and report the next uncompleted step; do not repeat already verified work without a reason (changed code, stale evidence, failed test or changed environment). Never mark an incomplete milestone complete merely because a conversation ended.
- If Project or repository writes are unavailable, state that explicitly, provide a precise proposed update and keep the status unverified until it is recorded. Do not revive the Excel ledger.

## Verification, Environments and Release Gates

- Use risk-based verification: lightweight relevant checks for UI-only/documentation changes; adequate regression, positive/negative permission, data-preservation and integration tests for logic, auth, SQL/RLS/RPC, scoring and persistence. Use the approved scope and avoid unnecessary full runs. Record the exact commit and environment tested; rerun relevant checks after changes that invalidate evidence.
- Prefer local/free isolated validation and approved staging; no paid environment or additional cost without explicit authorization. Do not treat a staging schema or an isolated partial data snapshot as equivalent to production. Distinguish synthetic tests, SQL-only checks, real Auth/HTTP, browser/device acceptance and actual production checks.
- Use read-only production inspection only when authorized and necessary. Do not perform production SQL/DDL/DML, credentials/infrastructure changes, production deployment, or merge/push to a branch that triggers production deployment without explicit user authorization for that action. A request to design, implement, test, or update progress is not release authorization. Check automatic deployment triggers before merging. Keep existing Draft/NO-GO status until all required gates and explicit release approval are satisfied.
- For risky DB or coordinated Worker changes, document tested migration ordering, compatibility of old/new app and DB, backup/restore scope, non-destructive recovery or limitations, stop conditions and post-release checks. Do not weaken RLS/ACL or restore broad access for compatibility. Do not claim no-loss rollback, full restore, or production readiness from limited tests.
- After authorized deployment, verify actual Worker version, DB migration history and relevant smoke/acceptance results separately. Close only the agreed task scope when its acceptance criteria are met; keep remaining child tasks visible.
