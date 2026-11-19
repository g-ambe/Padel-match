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
  // Reject legacy anon/JWT and service-role/secret keys before any authentication request.
  // This workflow uses the staging modern publishable key only.
  if (!key.startsWith('sb_publishable_')) {
    mark('H00', 'staging', 'BLOCKED', { reason: 'staging_publishable_key_required' });
    process.exitCode = 2;
    return;
  }
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
    // H12: permanent read-only stage regression. Bad tokens must return no data,
    // and anonymous REST access to raw event tables must remain forbidden.
    for (const kind of ['event','official']) {
      const invalid = await anonymous.rpc('get_shared_event', {
        p_token: 'TASK08-H12-NEVER-VALID-TOKEN', p_kind: kind,
      });
      mark(kind === 'event' ? 'H12_INVALID_FRIENDLY' : 'H12_INVALID_OFFICIAL',
        'anonymous', !invalid.error && invalid.data === null && invalid.status === 200
          ? 'PASS' : 'FAIL', safeResult(invalid));
    }
    for (const [table, test] of [
      ['events','H12_RAW_FRIENDLY_DENIED'],
      ['official_events','H12_RAW_OFFICIAL_DENIED'],
    ]) {
      const raw = await anonymous.from(table).select('id').limit(1);
      mark(test, 'anonymous',
        raw.error?.code === '42501' && [401,403].includes(raw.status) && raw.data === null
          ? 'PASS' : 'FAIL', safeResult(raw));
    }
    // Stage-only one-off positive HTTP cases: all names/tokens are synthetic.
    // Must run only while fixtures 51 are installed; run cleanup 52 immediately afterwards.
    if (process.env.TASK08_H12_TEST_POSITIVE === '1') {
      const fixtures = [
        ['H12_HTTP_FRIENDLY', 'TASK08H12HTTPFRIENDLYONLY', 'event', (d) =>
          d?.event?.name === 'TASK08-H12-HTTP-FRIENDLY-ONLY' &&
          d.participants?.length === 4 && d.matches?.length === 1 &&
          d.matches[0].result?.score_a === 4 && d.matches[0].result?.score_b === 2 &&
          d.matches[0].match_players?.length === 4 &&
          !('share_token' in d.event)],
        ['H12_HTTP_MIXED', 'TASK08H12HTTPMIXEDONLY', 'event', (d) => {
          const m = d?.team_matches?.[0];
          return d?.event?.event_mode === 'team' &&
            d.team_sides?.length === 2 && d.team_guests?.length === 4 &&
            d.team_matches?.length === 1 && m?.generation_mode === 'mixed' &&
            m.round_number === 1 && m.court_number === 1 && m.match_order === 1 &&
            m.pair_1_score === 4 && m.pair_2_score === 2 &&
            m.pair_result === 'win' && m.result === 'undecided' &&
            m.team_a_score === null && m.team_b_score === null &&
            m.team_a_player1_source_side === 'team_a' &&
            m.team_a_player2_source_side === 'team_b' &&
            m.team_b_player1_source_side === 'team_a' &&
            m.team_b_player2_source_side === 'team_b' &&
            typeof m.team_a_player1_guest_id === 'string' &&
            m.team_a_player1_guest_id.length === 32 &&
            d.team_guests.every(x => typeof x.id === 'string' && x.id.length === 32) &&
            !('share_token' in d.event) &&
            !JSON.stringify(d).includes('TASK08H12HTTPMIXEDONLY');
        }],
        ['H12_HTTP_OFFICIAL', 'TASK08H12HTTPOFFICIALONLY', 'official', (d) =>
          d?.event?.title === 'TASK08-H12-HTTP-OFFICIAL-ONLY' &&
          d.opponents?.length === 1 && d.matches?.length === 1 &&
          d.matches[0].our_score === 4 && d.matches[0].opponent_score === 2 &&
          !('share_token' in d.event)],
      ];
      for (const [id, token, kind, valid] of fixtures) {
        const res = await anonymous.rpc('get_shared_event', { p_token: token, p_kind: kind });
        const expected = !res.error && res.status === 200 && !!valid(res.data);
        mark(id, 'anonymous', expected ? 'PASS' : 'FAIL', {
          http_status: res.status ?? null, error_code: res.error?.code ?? null,
          dto_valid: !!expected,
        });
      }
      for (const [table, name] of [
        ['event_team_matches','H12_HTTP_RAW_TEAM_MATCHES_DENIED'],
        ['event_team_guests','H12_HTTP_RAW_TEAM_GUESTS_DENIED'],
        ['event_video_links','H12_HTTP_RAW_VIDEOS_DENIED'],
      ]) {
        const raw = await anonymous.from(table).select('id').limit(1);
        mark(name, 'anonymous',
          raw.error?.code === '42501' && [401,403].includes(raw.status) && raw.data === null
            ? 'PASS' : 'FAIL', safeResult(raw));
      }
    }

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
      const expectingClosed = process.env.TASK08_EXPECT_H06_CLOSED === '1';
      const blocked = oldPreview.error?.code === '42501' &&
        [401, 403].includes(oldPreview.status) && oldPreview.data === null;
      mark('H06', 'outsider',
        expectingClosed ? (blocked ? 'PASS' : 'FAIL') : 'OBSERVED_NOT_ACCEPTED', {
        http_status: oldPreview.status ?? null,
        error_code: oldPreview.error?.code ?? null,
        returned_source: !!oldPreview.data?.source,
        returned_review_token: typeof oldPreview.data?.review_token === 'string',
        membership_count: Array.isArray(oldPreview.data?.memberships)
          ? oldPreview.data.memberships.length : null,
      });
      if (process.env.TASK08_EXPECT_LEGACY_SUBMIT_CLOSED === '1') {
        // Invalid consent token is deliberate: this test must never create a join request
        // even if a future privilege regression re-exposes the legacy RPC.
        const legacySubmit = await clients.outsider.rpc('submit_profile_join_request', {
          p_club_id: clubA,
          p_member_id: provisional.id,
          p_message: null,
          p_review_token: 'TASK08-INTENTIONALLY-INVALID-CONSENT',
        });
        const denied = legacySubmit.error?.code === '42501' &&
          [401, 403].includes(legacySubmit.status) && legacySubmit.data === null;
        mark('LEGACY_SUBMIT_DIRECT', 'outsider', denied ? 'PASS' : 'FAIL', {
          http_status: legacySubmit.status ?? null,
          error_code: legacySubmit.error?.code ?? null,
          created_request: typeof legacySubmit.data === 'string',
        });
      }
      if (expectingClosed) {
        const directory = await clients.outsider.rpc('get_public_club_directory', { p_club_id: clubA });
        const ref = !directory.error && Array.isArray(directory.data)
          ? directory.data.find(row => row.display_name === 'TASK08-P0 provisional U' && row.is_unlinked)?.reference
          : null;
        if (typeof ref !== 'string') {
          mark('H06_SAFE', 'outsider', 'BLOCKED', safeResult(directory));
        } else {
          const safePreview = await clients.outsider.rpc('preview_public_club_claim', {
            p_club_id: clubA, p_reference: ref,
          });
          const allowed = new Set([
            'display_name', 'target_display_name', 'has_target', 'review_token',
            'membership_count', 'participant_count', 'match_count', 'result_count',
            'team_match_count', 'official_match_count',
          ]);
          const dtoOk = safePreview.data && !Array.isArray(safePreview.data) &&
            Object.keys(safePreview.data).length === 10 &&
            Object.keys(safePreview.data).every(key => allowed.has(key)) &&
            typeof safePreview.data.review_token === 'string' &&
            safePreview.data.display_name === 'TASK08-P0 provisional U' &&
            safePreview.data.membership_count === 1;
          mark('H06_SAFE', 'outsider',
            !safePreview.error && safePreview.status === 200 && dtoOk ? 'PASS' : 'FAIL', {
            http_status: safePreview.status ?? null,
            error_code: safePreview.error?.code ?? null,
            only_minimal_fields: !!dtoOk,
          });
        }
      }
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

    if (process.env.TASK08_EXPECT_LINK_DETAIL_FIXED === '1') {
      const listing = await clients.mainA.rpc('list_player_profile_link_requests', { p_club_id: clubA });
      const candidates = !listing.error && Array.isArray(listing.data)
        ? listing.data.filter(row => row.status === 'pending' &&
            row.club_id === clubA && row.source_display_name === 'TASK08-P0 provisional U')
        : [];
      if (candidates.length !== 1 || typeof candidates[0].id !== 'string') {
        mark('LINK_DETAIL_SETUP', 'mainA', 'BLOCKED', safeResult(listing));
      } else {
        const item = candidates[0];
        // Retain only the ID in memory; never log target/user/source UUIDs.
        const requestId = item.id;
        const listFieldsSafe = !('target_auth_user_id' in item) &&
          typeof item.source_player_profile_id === 'string';
        mark('LINK_LIST_PRIVACY', 'mainA', listFieldsSafe ? 'PASS' : 'FAIL', {
          exposes_target_auth_id: typeof item.target_auth_user_id === 'string',
          exposes_source_player_id: typeof item.source_player_profile_id === 'string',
        });
        const recipientList = await clients.recipient.rpc('list_player_profile_link_requests', {});
        const recipientListSafe = !recipientList.error &&
          Array.isArray(recipientList.data) && recipientList.data.length === 1 &&
          recipientList.data[0].id === requestId &&
          !('target_auth_user_id' in recipientList.data[0]);
        mark('LINK_LIST_RECIPIENT', 'recipient',
          recipientListSafe ? 'PASS' : 'FAIL', {
          ...safeResult(recipientList),
          no_target_auth_id: !!recipientListSafe,
        });
        const mgr = await clients.mainA.rpc('get_player_profile_link_request', {
          p_request_id: requestId,
        });
        const allowedManagerKeys = new Set([
          'id','club_id','club_name','status','created_at','expires_at',
          'is_recipient','detail_scope','source_display_name','group_membership',
        ]);
        const mgrValid = !mgr.error && mgr.status === 200 &&
          mgr.data && !Array.isArray(mgr.data) &&
          Object.keys(mgr.data).length === 10 &&
          Object.keys(mgr.data).every(key => allowedManagerKeys.has(key)) &&
          mgr.data.detail_scope === 'manager' && mgr.data.is_recipient === false &&
          mgr.data.source_display_name === 'TASK08-P0 provisional U' &&
          mgr.data.group_membership?.role === 'member' &&
          !JSON.stringify(mgr.data).includes('TASK08-P0-20261119-B');
        mark('LINK_DETAIL_MANAGER', 'mainA', mgrValid ? 'PASS' : 'FAIL', {
          http_status: mgr.status ?? null, error_code: mgr.error?.code ?? null,
          only_minimal_fields: !!mgrValid,
        });

        const receiver = await clients.recipient.rpc('get_player_profile_link_request', {
          p_request_id: requestId,
        });
        const recipientDirectory = await clients.recipient.rpc('get_public_club_directory', {
          p_club_id: clubA,
        });
        const reference = !recipientDirectory.error && Array.isArray(recipientDirectory.data)
          ? recipientDirectory.data.find(row =>
              row.display_name === 'TASK08-P0 provisional U' && row.is_unlinked)?.reference
          : null;
        const consent = typeof reference === 'string'
          ? await clients.recipient.rpc('preview_public_club_claim', {
              p_club_id: clubA, p_reference: reference,
            })
          : null;
        const receiverValid = !receiver.error && receiver.status === 200 &&
          receiver.data?.detail_scope === 'recipient' &&
          receiver.data?.is_recipient === true &&
          receiver.data?.source?.display_name === 'TASK08-P0 provisional U' &&
          Array.isArray(receiver.data?.memberships) &&
          receiver.data.memberships.length === 1 &&
          !JSON.stringify(receiver.data.memberships).includes('TASK08-P0-20261119-B') &&
          typeof receiver.data?.review_token === 'string' &&
          !consent?.error &&
          receiver.data.review_token === consent?.data?.review_token;
        mark('LINK_DETAIL_RECIPIENT', 'recipient',
          receiverValid ? 'PASS' : 'FAIL', {
          http_status: receiver.status ?? null,
          error_code: receiver.error?.code ?? null,
          preview_token_equal: !!receiverValid,
        });

        const unauthorized = await clients.outsider.rpc('get_player_profile_link_request', {
          p_request_id: requestId,
        });
        const outsiderDenied = !!unauthorized.error && unauthorized.data === null &&
          [400, 401, 403].includes(unauthorized.status);
        mark('LINK_DETAIL_OUTSIDER', 'outsider',
          outsiderDenied ? 'PASS' : 'FAIL', {
          http_status: unauthorized.status ?? null,
          error_code: unauthorized.error?.code ?? null,
          no_data: unauthorized.data === null,
        });
      }
    }

    if (process.env.TASK08_EXPECT_JOIN_REVIEW_GUARD === '1') {
      // One pending synthetic claim for the A+B source; do not log its internal IDs.
      const before = await clients.mainA.rpc('get_club_join_requests', { p_club_id: clubA });
      const requestCandidates = !before.error && Array.isArray(before.data)
        ? before.data.filter(item => item.status === 'pending' &&
          item.message === 'TASK08 isolated H08 negative HTTP review' &&
          item.club_id === clubA && item.consent_at)
        : [];
      if (requestCandidates.length !== 1 || typeof requestCandidates[0].id !== 'string') {
        mark('H08_JOIN_FIXTURE', 'mainA', 'BLOCKED', safeResult(before));
      } else {
        const id = requestCandidates[0].id;
        const approval = await clients.mainA.rpc('review_profile_join_request', {
          p_request_id: id, p_decision: 'approved',
        });
        const correctlyDenied = approval.error?.code === '42501' &&
          [401,403].includes(approval.status) && approval.data === null;
        mark('H08_JOIN_MANAGER_REVIEW', 'mainA',
          correctlyDenied ? 'PASS' : 'FAIL', {
            http_status: approval.status ?? null,
            error_code: approval.error?.code ?? null,
            no_merge_result: approval.data === null,
          });
        const after = await clients.mainA.rpc('get_club_join_requests', { p_club_id: clubA });
        const pending = !after.error && Array.isArray(after.data) &&
          after.data.filter(item => item.id === id && item.status === 'pending').length === 1;
        mark('H08_JOIN_PENDING_UNCHANGED', 'mainA',
          pending ? 'PASS' : 'FAIL', {
            http_status: after.status ?? null,
            error_code: after.error?.code ?? null,
            still_pending: !!pending,
          });
      }
    }

    if (process.env.TASK08_EXPECT_H08_SCOPE_GUARD === '1') {
      // Guarded stage-only SQL creates exactly one pending synthetic A->outsider request.
      // This HTTP test submits the real consent token; successful approval would be a FAIL.
      const reqList = await clients.mainA.rpc('list_player_profile_link_requests', {
        p_club_id: clubA,
      });
      const candidates = !reqList.error && Array.isArray(reqList.data)
        ? reqList.data.filter(item => item.status === 'pending' &&
            item.source_display_name === 'TASK08-P0 provisional U' &&
            item.club_id === clubA)
        : [];
      if (candidates.length !== 1 || typeof candidates[0].id !== 'string') {
        mark('H08_FIXTURE', 'mainA', 'BLOCKED', safeResult(reqList));
      } else {
        const requestId = candidates[0].id;
        const preview = await clients.outsider.rpc('get_player_profile_link_request', {
          p_request_id: requestId,
        });
        const previewOk = !preview.error && preview.status === 200 &&
          preview.data?.detail_scope === 'recipient' &&
          preview.data?.status === 'pending' &&
          typeof preview.data?.review_token === 'string' &&
          Array.isArray(preview.data?.memberships) &&
          preview.data.memberships.length === 1 &&
          !JSON.stringify(preview.data.memberships).includes('TASK08-P0-20261119-B');
        mark('H08_SCOPE_PREVIEW', 'outsider',
          previewOk ? 'PASS' : 'FAIL', {
          http_status: preview.status ?? null,
          error_code: preview.error?.code ?? null,
          only_selected_club_shown: !!previewOk,
        });
        if (previewOk) {
          const review = await clients.outsider.rpc('review_player_profile_link', {
            p_request_id: requestId,
            p_decision: 'approved',
            p_review_token: preview.data.review_token,
          });
          const guardDenied = review.error?.code === '42501' &&
            [401, 403].includes(review.status) && review.data === null;
          mark('H08_REVIEW_SCOPE', 'outsider',
            guardDenied ? 'PASS' : 'FAIL', {
            http_status: review.status ?? null,
            error_code: review.error?.code ?? null,
            no_merge_result: review.data === null,
          });
          const after = await clients.outsider.rpc('get_player_profile_link_request', {
            p_request_id: requestId,
          });
          const unchanged = !after.error && after.data?.status === 'pending' &&
            after.data?.detail_scope === 'recipient';
          mark('H08_PENDING_UNCHANGED', 'outsider',
            unchanged ? 'PASS' : 'FAIL', {
            http_status: after.status ?? null,
            error_code: after.error?.code ?? null,
            still_pending: !!unchanged,
          });
        }
      }
    }

    const view = await anonymous.from('public_player_profiles').select('id,display_name');
    const expectViewClosed = process.env.TASK08_EXPECT_H03_CLOSED === '1';
    const viewDenied = view.error?.code === '42501' &&
      [401, 403].includes(view.status) && view.data === null;
    mark('H03', 'anonymous',
      expectViewClosed ? (viewDenied ? 'PASS' : 'FAIL') : 'OBSERVE_PRIVACY_RISK', {
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
