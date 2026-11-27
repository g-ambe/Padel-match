# TASK-08-02 local Auth/PostgREST integration

Run only with authorization on a disposable local Docker host. Required pre-existing images: `postgres:17-alpine`, `ghcr.io/supabase/gotrue:v2.197.0`, `ghcr.io/supabase/postgrest:v16.5`, `ghcr.io/supabase/mailpit:v1.31.3`. No image is pulled.

```
python3 supabase/maintenance/club-invitations/isolated-http/run.py
```

The runner strips hosted credentials, fixes Docker to the local Unix socket, creates a uniquely named **internal** Docker network with no published host ports, uses tmpfs for PostgreSQL and sends synthetic messages only to local Mailpit. All passwords/JWT keys/addresses in these files are fake. GoTrue email confirmation is enabled; email verification is done using the received fake message and real GoTrue verification. Only test-created containers/network are removed, with cleanup verified. No repository or hosted DB is contacted.

The candidate is pinned to SHA256 `1c039a661628d229b25d1bd123946dda246233585e3e3901fc7614202429c7b6` (revision 06). The app schema is built from repository migrations using the same partial baseline and H51/H52 local-only preflight changes as `../isolated-evidence/README.md`; migrations 0040–43, 0053 and 0062–65 are not applied, dev RLS and synthetic Vault differ from production. The candidate's terminal ROLLBACK is changed to COMMIT in-memory and its send-off check is dropped only inside the disposable DB; delivery status is mocked. It is not a production migration or actual SMTP delivery test.

The runner tests real signup, Mailpit confirmation, GoTrue password JWT, unconfirmed login rejection, authenticated/anonymous/outsider PostgREST permissions, registered named approval, an unregistered invite through mocked service send and recipient acceptance, manager operation after demotion, revision-06 anonymous fixed windows and neutral quota response, a registered-approval scope change, existing public join/notification, and two concurrent same-recipient reservations. It does **not** cover all RLS, a full Supabase production-equivalent stack, real Gmail, all existing join/link/restore flows, all race conditions or ranking. Consult PR #273 and Issue #262 before release.
