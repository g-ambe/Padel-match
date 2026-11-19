/**
 * TASK-08 staging B0 HTTP smoke only. Never run against production.
 * No database writes; no secret/token/response-body logging.
 *
 * Run in a secure local/Codex environment with these process env values:
 * TASK08_STAGING_PUBLISHABLE_KEY
 * TASK08_STAGING_MAIN_A_PASSWORD
 * TASK08_STAGING_RECIPIENT_PASSWORD
 * TASK08_STAGING_OUTSIDER_PASSWORD
 *
 * Requires the project's existing @supabase/supabase-js dependency.
 * B0 observational tests are NOT B1/B2 acceptance or a security sign-off.
 */
import { createClient } from '@supabase/supabase-js';

const url = 'https://zzjwpresqkefnyjyisgd.supabase.co';
const refs = {
  mainA: ['main-A@example.com', 'TASK08_STAGING_MAIN_A_PASSWORD'],
  recipient: ['recipient@example.com', 'TASK08_STAGING_RECIPIENT_PASSWORD'],
  outsider: ['outsider@example.com', 'TASK08_STAGING_OUTSIDER_PASSWORD'],
};
const results = [];
function mark(id, actor, outcome, details = {}) {
  results.push({ id, actor, outcome, ...details });
}
function safeResult(response) {
  return {
    status: response.status ?? null,
    error_code: response.error?.code ?? null,
    row_count: Array.isArray(response.data) ? response.data.length : null,
  };
}
function makeClient(key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-task08-test': 'staging-b0' } },
  });
}
function oneId(response, description) {
  if (response.error || !Array.isArray(response.data) || response.data.length !== 1 ||
      typeof response.data[0].id !== 'string') {
    mark('setup', description, 'BLOCKED', safeResult(response));
    return null;
  }
  return response.data[0].id;
}
async function main() {
  const required = ['TASK08_STAGING_PUBLISHABLE_KEY',
    ...Object.values(refs).map(([, envName]) => envName)];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) {
    console.error('B0_NOT_RUN: missing environment variable names:', missing.join(', '));
    process.exitCode = 2;
    return;
  }
  const key = process.env.TASK08_STAGING_PUBLISHABLE_KEY;
  const clients = {};
  try {
    for (const [actor, [email, passName]] of Object.entries(refs)) {
      const client = makeClient(key);
      const signed = await client.auth.signInWithPassword({
        email, password: process.env[passName],
      });
      const token = signed.data?.session?.access_token;
      if (signed.error || !token || signed.data?.user?.email?.toLowerCase() !== email.toLowerCase()) {
        mark('H01', actor, 'BLOCKED', { error_code: signed.error?.code ?? null });
        process.exitCode = 1;
        return;
      }
      const userCheck = await client.auth.getUser();
      if (userCheck.error || userCheck.data?.user?.id !== signed.data.user.id) {
        mark('H01', actor, 'BLOCKED', { error_code: userCheck.error?.code ?? null });
        process.exitCode = 1;
        return;
      }
      clients[actor] = client;
      mark('H01', actor, 'PASS');
    }

    const anonymous = makeClient(key);
    const clubAQuery = await clients.mainA.from('clubs').select('id')
      .eq('name', 'TASK08-P0-20261119-A');
    const clubBQuery = await clients.recipient.from('clubs').select('id')
      .eq('name', 'TASK08-P0-20261119-B');
    const clubA = oneId(clubAQuery, 'club_A');
    const clubB = oneId(clubBQuery, 'club_B');
    if (!clubA || !clubB || clubA === clubB) {
      process.exitCode = 1;
      return;
    }

    for (const [actor, client] of Object.entries({ anonymous, ...clients })) {
      const direct = await client.from('club_members').select('id,club_id,role').eq('club_id', clubA);
      const count = Array.isArray(direct.data) ? direct.data.length : null;
      const expected = actor === 'mainA' ? count === 2 && !direct.error
        : !!direct.error || count === 0;
      mark('H02', actor, expected ? 'PASS' : 'FAIL', safeResult(direct));
    }
    for (const [actor, client] of Object.entries(clients)) {
      const roster = await client.rpc('get_club_roster', { p_club_id: clubA });
      const expected = actor === 'mainA'
        ? !roster.error && roster.data?.length === 2
        : !!roster.error;
      mark('H11', actor, expected ? 'PASS' : 'FAIL', safeResult(roster));
    }

    const roster = await clients.mainA.rpc('get_club_roster', { p_club_id: clubA });
    const provisional = !roster.error && Array.isArray(roster.data)
      ? roster.data.find(row => row.player_profiles?.display_name === 'TASK08-P0 provisional U')
      : undefined;
    if (!provisional?.id) {
      mark('H06', 'setup', 'BLOCKED', safeResult(roster));
    } else {
      const oldPreview = await clients.outsider.rpc('preview_profile_join', {
        p_club_id: clubA, p_member_id: provisional.id,
      });
      mark('H06', 'outsider', 'OBSERVED_NOT_ACCEPTED', {
        http_status: oldPreview.status ?? null,
        error_code: oldPreview.error?.code ?? null,
        returned_source: !!oldPreview.data?.source,
        returned_review_token: typeof oldPreview.data?.review_token === 'string',
        membership_count: Array.isArray(oldPreview.data?.memberships)
          ? oldPreview.data.memberships.length : null,
      });
    }

    for (const [actor, client] of Object.entries({ anonymous, outsider: clients.outsider })) {
      const listing = await client.rpc('get_public_club_directory', { p_club_id: clubA });
      const minimal = Array.isArray(listing.data) && listing.data.every(row =>
        Object.keys(row).every(k => ['reference','display_name','is_unlinked'].includes(k)));
      const expected = actor === 'anonymous' ? !!listing.error
        : !listing.error && listing.data.length === 2 && minimal;
      mark('H07', actor, expected ? 'PASS' : 'FAIL', {
        ...safeResult(listing), only_minimal_fields: minimal,
      });
    }

    const view = await anonymous.from('public_player_profiles').select('id,display_name');
    mark('H03', 'anonymous', 'OBSERVE_PRIVACY_RISK', {
      ...safeResult(view),
      fixture_names_visible: Array.isArray(view.data)
        ? view.data.filter(row => typeof row.display_name === 'string' &&
          row.display_name.startsWith('TASK08-P0 ')).length : null,
    });
    const failed = results.some(r => r.outcome === 'FAIL' || r.outcome === 'BLOCKED');
    if (failed) process.exitCode = 1;
  } finally {
    // Tokens are not printed; disable refresh/persistence and drop in-memory references.
    for (const client of Object.values(clients)) {
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  }
}
try {
  await main();
} catch {
  // Never print the HTTP request, response body, token, password, or user data.
  mark('runtime', 'staging', 'BLOCKED');
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify({
    project: 'padel-hub-staging',
    phase: 'B0-HTTP',
    writes_to_app_database: false,
    acceptance: 'P0_NOT_COMPLETE',
    results,
  }, null, 2));
}
