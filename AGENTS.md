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
