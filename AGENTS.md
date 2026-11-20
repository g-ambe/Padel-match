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
