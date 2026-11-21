/**
 * TASK-08 H13, STAGING-ONLY controlled write test.
 * Creates TWO uniquely identified synthetic clubs and two owner memberships.
 * A separate guarded SQL cleanup MUST follow, even when this test fails.
 * This is NEVER a production or ordinary B0 read-only test.
 * Secrets, JWT, IDs, names, raw error messages and row bodies are never logged.
 */
import { createClient } from '@supabase/supabase-js';

const url = 'https://zzjwpresqkefnyjyisgd.supabase.co';
const names = {
  single: 'TASK08-H13-HTTP-20261119-SINGLE',
  race: 'TASK08-H13-HTTP-20261119-RACE',
};
const results = [];
function record(id, expected, actual, pass, detail = {}) {
  results.push({ id, expected, actual, outcome: pass ? 'PASS' : 'FAIL', ...detail });
  if (!pass) process.exitCode = 1;
}
function safe(response) {
  return {
    status: response?.status ?? null,
    error_code: response?.error?.code ?? null,
    rows: Array.isArray(response?.data) ? response.data.length : (response?.data ? 1 : 0),
  };
}
function clientWithKey(key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-task08-test': 'H13-staging-fixture' } },
  });
}
function expectedDenied(response, codes = ['42501']) {
  return response?.error && codes.includes(response.error.code) &&
    [400, 401, 403, 409].includes(response.status) && response.data === null;
}
async function run() {
  const envs = [
    'TASK08_STAGING_PUBLISHABLE_KEY',
    'TASK08_STAGING_MAIN_A_PASSWORD',
    'TASK08_STAGING_RECIPIENT_PASSWORD',
  ];
  if (process.env.TASK08_STAGE_H13_WRITE !== '1' ||
      envs.some(v => !process.env[v]) ||
      !process.env.TASK08_STAGING_PUBLISHABLE_KEY.startsWith('sb_publishable_')) {
    results.push({ id: 'H13_SETUP', expected: 'staging-only opt-in and secrets', actual: 'not configured', outcome: 'BLOCKED' });
    process.exitCode = 2;
    return;
  }
  const key = process.env.TASK08_STAGING_PUBLISHABLE_KEY;
  const main = clientWithKey(key), recipient = clientWithKey(key);
  try {
    const actors = [
      [main, 'main-A@example.com', process.env.TASK08_STAGING_MAIN_A_PASSWORD],
      [recipient, 'recipient@example.com', process.env.TASK08_STAGING_RECIPIENT_PASSWORD],
    ];
    const authIds = [];
    for (const [client, email, password] of actors) {
      const r = await client.auth.signInWithPassword({ email, password });
      if (r.error || !r.data?.session?.access_token || !r.data?.user?.id) {
        results.push({ id: 'H13_LOGIN', expected: 'valid staging account', actual: 'login failure', outcome: 'BLOCKED', ...safe(r) });
        process.exitCode = 1; return;
      }
      authIds.push(r.data.user.id);
    }
    record('H13_AUTH', 'two test-only logins succeed', 'both authenticated', true);
    const [mainId, recipientId] = authIds;
    const existing = await main.from('clubs').select('id').in('name', Object.values(names));
    if (existing.error || !Array.isArray(existing.data) || existing.data.length !== 0) {
      results.push({ id: 'H13_FIXTURE_GUARD', expected: 'no existing synthetic H13 clubs', actual: 'unsafe or already exists', outcome: 'BLOCKED', ...safe(existing) });
      process.exitCode = 1; return;
    }
    const getPlayer = async (client, uid) =>
      client.from('player_profiles').select('id,linked_auth_user_id')
        .eq('linked_auth_user_id', uid).eq('is_active', true);
    const [mainProfiles, recipientProfiles] = await Promise.all([
      getPlayer(main, mainId), getPlayer(recipient, recipientId),
    ]);
    if (mainProfiles.error || recipientProfiles.error ||
        mainProfiles.data?.length !== 1 || recipientProfiles.data?.length !== 1) {
      results.push({ id: 'H13_PROFILE_GUARD', expected: 'one linked active player per actor', actual: 'fixture mismatch', outcome: 'BLOCKED',
        mainRows: mainProfiles.data?.length ?? null, recipientRows: recipientProfiles.data?.length ?? null });
      process.exitCode = 1; return;
    }
    const playerId = mainProfiles.data[0].id, recipientPlayerId = recipientProfiles.data[0].id;
    const ownerClub = await main.from('clubs')
      .insert({ name: names.single, owner_id: mainId, is_active: true, visibility: 'private' })
      .select('id').single();
    if (ownerClub.error || typeof ownerClub.data?.id !== 'string') {
      record('H13_CREATE', 'owner creates private club (201)', 'creation failed', false, safe(ownerClub));
      return;
    }
    const clubId = ownerClub.data.id;
    record('H13_CREATE', 'owner creates private club (201)', 'owner club created', ownerClub.status === 201, safe(ownerClub));

    const wrongRole = await main.from('club_members').insert({
      club_id: clubId, profile_id: mainId, player_profile_id: playerId, role: 'member', is_active: true,
    });
    record('H13_ROLE', '仕様どおり拒否：初期所属はmain_adminのみ',
      expectedDenied(wrongRole) ? '42501 denied' : 'unexpected',
      expectedDenied(wrongRole), safe(wrongRole));
    const mismatch = await main.from('club_members').insert({
      club_id: clubId, profile_id: mainId, player_profile_id: recipientPlayerId, role: 'main_admin', is_active: true,
    });
    // Existing guard_reference trigger returns P0001; RLS can also return 42501.
    record('H13_PLAYER_MISMATCH', '仕様どおり拒否：他人の連携選手プロフィールは禁止',
      expectedDenied(mismatch,['42501','P0001']) ? 'permission/profile guard rejected' : 'unexpected',
      expectedDenied(mismatch,['42501','P0001']), safe(mismatch));

    const bootstrap = await main.from('club_members')
      .insert({ club_id: clubId, profile_id: mainId, player_profile_id: playerId, role: 'main_admin', is_active: true })
      .select('id,club_id,role').single();
    const bootstrapPass = !bootstrap.error && bootstrap.status === 201 &&
      typeof bootstrap.data?.id === 'string' && bootstrap.data.club_id === clubId &&
      bootstrap.data.role === 'main_admin';
    record('H13_BOOTSTRAP', '本人を初期main_adminに登録', bootstrapPass ? 'member created' : 'unexpected', bootstrapPass, safe(bootstrap));
    if (!bootstrapPass) return;

    const duplicate = await main.from('club_members').insert({
      club_id: clubId, profile_id: mainId, player_profile_id: playerId, role: 'main_admin', is_active: true,
    });
    record('H13_DUPLICATE', '仕様どおり拒否：初回所属の重複追加は禁止',
      expectedDenied(duplicate) ? '42501 denied' : 'unexpected',
      expectedDenied(duplicate), safe(duplicate));
    const outsider = await recipient.from('club_members').insert({
      club_id: clubId, profile_id: recipientId, player_profile_id: recipientPlayerId, role: 'main_admin', is_active: true,
    });
    record('H13_OTHER_ACTOR', '仕様どおり拒否：オーナー以外は初期main_adminを登録不可',
      expectedDenied(outsider) ? '42501 denied' : 'unexpected',
      expectedDenied(outsider), safe(outsider));
    const one = await main.from('club_members').select('id,role').eq('club_id', clubId);
    record('H13_BOOTSTRAP_COUNT', 'owner membership stays exactly one',
      !one.error && one.data?.length === 1 ? 'one row' : 'unexpected',
      !one.error && one.data?.length === 1, safe(one));

    // Second synthetic club has no members. Two REST requests are dispatched together:
    // each request is a separate server transaction under the real Auth session.
    const raceClub = await main.from('clubs')
      .insert({ name: names.race, owner_id: mainId, is_active: true, visibility: 'private' })
      .select('id').single();
    if (raceClub.error || !raceClub.data?.id || raceClub.status !== 201) {
      record('H13_RACE_CREATE', 'owner creates empty concurrency fixture',
        'unexpected', false, safe(raceClub));
      return;
    }
    record('H13_RACE_CREATE', 'owner creates empty concurrency fixture', 'created', true, safe(raceClub));
    const raceMember = () => main.from('club_members').insert({
      club_id: raceClub.data.id, profile_id: mainId, player_profile_id: playerId,
      role: 'main_admin', is_active: true,
    }).select('id');
    const pair = await Promise.all([raceMember(), raceMember()]);
    const successCount = pair.filter(r => !r.error && r.status === 201 && r.data?.length === 1).length;
    const expectedDeniedCount = pair.filter(r => expectedDenied(r)).length;
    const raceCount = await main.from('club_members').select('id').eq('club_id', raceClub.data.id);
    const pass = successCount === 1 && expectedDeniedCount === 1 &&
      !raceCount.error && raceCount.data?.length === 1;
    record('H13_CONCURRENT', '仕様どおり：並列2件→1件成功/1件拒否（42501）',
      pass ? 'one accepted, one denied, one stored' : 'unexpected',
      pass, { successes: successCount, expected_denials: expectedDeniedCount,
        members_after: raceCount.data?.length ?? null,
        statuses: pair.map(x=>x.status??null), error_codes: pair.map(x=>x.error?.code??null) });
  } finally {
    await main.auth.signOut({ scope: 'local' }).catch(() => {});
    await recipient.auth.signOut({ scope: 'local' }).catch(() => {});
  }
}
try { await run(); } catch {
  results.push({ id: 'H13_RUNTIME', expected: 'run safely', actual: 'unexpected runtime error', outcome: 'BLOCKED' });
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify({
    environment: 'padel-hub-staging', phase: 'H13-WRITE-HTTP',
    fixture_names: Object.values(names),
    cleanup_required: true,
    P0_accepted: false, results,
  }, null, 2));
}
