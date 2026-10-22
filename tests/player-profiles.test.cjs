const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const {
  choosePlayerProfile, ensureAccountProfile, ensureLinkedPlayerProfile, fetchLinkedPlayerProfiles,
  fetchProfileUsage, saveLinkedPlayerProfile, setPlayerProfileAccountLink,
} = require('../lib/player-profiles.ts');

const userId = '11111111-1111-4111-8111-111111111111';
const detailId = '22222222-2222-4222-8222-222222222222';
const values = { display_name: '保存済みの選手', bio: '自己紹介', play_level: '中級', dominant_hand: '左', preferred_position: 'バック', activity_area: '東京都' };
const profile = (id = detailId, extra = {}) => ({ id, linked_auth_user_id: userId, display_name: '選手', bio: null, play_level: null, dominant_hand: null, preferred_position: null, activity_area: null, is_active: true, created_at: '2026-01-01T00:00:00Z', ...extra });
const emptyUsage = () => ({ groups: [], memberships: 0, participants: 0, teamMatches: 0, officialMatches: 0, joinRequests: 0 });

function client(handler, authUser = userId) {
  const calls = [];
  const supabase = createClient('https://profile-test.invalid', 'public-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const call = { table: url.pathname.split('/').at(-1), method: init.method ?? 'GET', url, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const result = await handler(call, calls);
      return new Response(JSON.stringify(result?.data ?? []), { status: result?.status ?? 200, headers: { 'Content-Type': 'application/json', ...result?.headers } });
    } },
  });
  supabase.auth.getUser = async () => ({ data: { user: authUser ? { id: authUser } : null }, error: null });
  return { supabase, calls };
}

test('54件を正常に読み取り、繰り返してもINSERTしない', async () => {
  const rows = Array.from({ length: 54 }, (_, index) => profile(`選手-${index}`));
  const { supabase, calls } = client(() => ({ data: rows }));
  for (let index = 0; index < 3; index++) assert.equal((await fetchLinkedPlayerProfiles(supabase, userId)).length, 54);
  assert(calls.every(call => call.method === 'GET'));
  assert(calls.every(call => call.url.searchParams.get('linked_auth_user_id') === `eq.${userId}`));
});

test('取得エラー時は未登録と判断せず作成を中止する', async () => {
  const { supabase, calls } = client(() => ({ status: 403, data: { code: '42501', message: '読取権限なし' } }));
  await assert.rejects(ensureLinkedPlayerProfile(supabase, userId, '名前'), /取得に失敗/);
  assert.deepEqual(calls.map(call => call.method), ['GET']);
});

test('不正な取得結果も0件と混同しない', async () => {
  const { supabase, calls } = client(() => ({ data: { message: '配列ではない応答' } }));
  await assert.rejects(ensureLinkedPlayerProfile(supabase, userId, '名前'), /取得に失敗/);
  assert(calls.every(call => call.method === 'GET'));
});

test('500件を超える候補もページングして取得する', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => profile(`選手-${index}`));
  const { supabase } = client(call => {
    const start = Number(call.url.searchParams.get('offset'));
    return { data: rows.slice(start, start + 500) };
  });
  assert.equal((await fetchLinkedPlayerProfiles(supabase, userId)).length, 501);
});

test('最新の空レコードより既存設定のあるレコードを読み込む', () => {
  const detailed = profile(detailId, values);
  const latest = profile('新しい空レコード', { created_at: '2026-10-22T00:00:00Z' });
  assert.equal(choosePlayerProfile([latest, detailed], new Map()).id, detailId);
});

test('設定済みレコードが複数ある場合は勝手に1件を選ばない', () => {
  assert.equal(choosePlayerProfile([profile(detailId, values), profile('別選手', { bio: '別の自己紹介' })], new Map()), null);
});

test('所属・参加・チーム戦の参照がある選手を空の新規レコードより優先する', () => {
  const existing = profile('履歴あり');
  const usage = new Map([['履歴あり', { ...emptyUsage(), teamMatches: 3 }]]);
  assert.equal(choosePlayerProfile([profile('空'), existing], usage).id, existing.id);
});

test('別グループの履歴を持つ2選手を参照数だけで統合・選択しない', () => {
  const usage = new Map([['選手A', { ...emptyUsage(), participants: 50 }], ['選手B', { ...emptyUsage(), memberships: 1 }]]);
  assert.equal(choosePlayerProfile([profile('選手A'), profile('選手B')], usage), null);
  assert.equal(choosePlayerProfile([profile('選手A'), profile('選手B')], usage, '選手B').id, '選手B');
});

test('設定レコードと履歴レコードが分かれている場合も本人の選択を求める', () => {
  const usage = new Map([['履歴あり', { ...emptyUsage(), memberships: 3, participants: 50 }]]);
  const rows = [profile(detailId, values), profile('履歴あり')];
  assert.equal(choosePlayerProfile(rows, usage), null);
  assert.equal(choosePlayerProfile(rows, usage, detailId).bio, values.bio);
});

test('関連情報の取得失敗でも新しいプロフィールを作らない', async () => {
  const { supabase, calls } = client(call => call.table === 'player_profiles'
    ? { data: [profile(detailId, values), profile('空')] }
    : { status: 500, data: { code: 'XX000', message: '関連情報の取得失敗' } });
  await assert.rejects(ensureLinkedPlayerProfile(supabase, userId, '別の名前'), /取得に失敗/);
  assert(calls.every(call => call.method === 'GET'));
});

test('既存設定を持つ54件から選び、表示名や詳細をINSERT・上書きしない', async () => {
  const detailed = profile(detailId, values);
  const rows = [detailed, ...Array.from({ length: 53 }, (_, index) => profile(`空-${index}`))];
  const { supabase, calls } = client(call => ({ data: call.table === 'player_profiles' ? rows : [] }));
  assert.deepEqual(await ensureLinkedPlayerProfile(supabase, userId, '登録フォームの別名'), detailed);
  assert(calls.every(call => call.method === 'GET'));
});

test('明示作成時の主キーは固定され、並行実行の23505から既存行を再取得する', async () => {
  let created = false;
  let posts = 0;
  const { supabase, calls } = client(async call => {
    if (call.method === 'GET') return { data: created ? [profile(userId)] : [] };
    assert.equal(call.body.id, userId);
    assert.equal(call.body.linked_auth_user_id, userId);
    posts += 1;
    if (posts === 1) { await new Promise(resolve => setTimeout(resolve, 5)); created = true; return { status: 201, data: profile(userId) }; }
    await new Promise(resolve => setTimeout(resolve, 10));
    return { status: 409, data: { code: '23505', message: '主キーが既に存在' } };
  });
  const results = await Promise.all([ensureLinkedPlayerProfile(supabase, userId, '選手'), ensureLinkedPlayerProfile(supabase, userId, '選手')]);
  assert(results.every(row => row.id === userId));
  assert(calls.filter(call => call.method === 'POST').every(call => call.body.id === userId));
  assert(!calls.some(call => call.method === 'PATCH'));
});

test('選択済みIDとの連携が失われている場合は別IDを作らない', async () => {
  const { supabase, calls } = client(() => ({ data: [] }));
  await assert.rejects(ensureLinkedPlayerProfile(supabase, userId, '選手', detailId), /連携が変わっています/);
  assert(calls.every(call => call.method === 'GET'));
});

test('アカウントIDと衝突する別行をupsertで上書きしない', async () => {
  const { supabase, calls } = client(call => call.method === 'GET' ? { data: [] } : { status: 409, data: { code: '23505', message: '既存ID' } });
  await assert.rejects(ensureLinkedPlayerProfile(supabase, userId, '選手'), /既存データは上書きしていません/);
  assert(!calls.some(call => call.method === 'PATCH'));
});

test('認証側プロフィールは同じ主キーを使い、既存の表示名や設定を上書きしない', async () => {
  const { supabase, calls } = client(() => ({ data: [] }));
  await ensureAccountProfile(supabase, userId, '初期表示名', 'test@example.invalid');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, 'profiles');
  assert.equal(calls[0].body.id, userId);
  assert.match(calls[0].headers.get('prefer'), /resolution=ignore-duplicates/);
});

test('保存では選手IDとアカウントIDを限定し、更新1件と再取得内容を確認する', async () => {
  const saved = profile(detailId, values);
  const { supabase, calls } = client(call => ({ data: call.method === 'PATCH' ? [saved] : saved, headers: call.method === 'PATCH' ? { 'Content-Range': '0-0/1' } : {} }));
  assert.deepEqual(await saveLinkedPlayerProfile(supabase, userId, detailId, values, profile()), saved);
  assert.deepEqual(calls.map(call => call.method), ['PATCH', 'GET']);
  for (const call of calls) {
    assert.equal(call.url.searchParams.get('id'), `eq.${detailId}`);
    assert.equal(call.url.searchParams.get('linked_auth_user_id'), `eq.${userId}`);
  }
});

test('RLSなどで更新0件の場合は成功を返さない', async () => {
  const { supabase, calls } = client(() => ({ data: [], headers: { 'Content-Range': '*/0' } }));
  await assert.rejects(saveLinkedPlayerProfile(supabase, userId, detailId, values, profile()), /更新対象を確認できません/);
  assert.deepEqual(calls.map(call => call.method), ['PATCH']);
});

test('編集前の値も更新条件に含め、他画面で変更済みの設定を上書きしない', async () => {
  const current = profile(detailId, { bio: '別の画面で保存された自己紹介' });
  const { supabase, calls } = client(call => {
    assert.equal(call.url.searchParams.get('bio'), 'is.null');
    assert.equal(call.url.searchParams.get('display_name'), 'eq.選手');
    return { data: [], headers: { 'Content-Range': '*/0' } };
  });
  await assert.rejects(saveLinkedPlayerProfile(supabase, userId, detailId, values, profile()), /別の画面で変更/);
  assert.equal(current.bio, '別の画面で保存された自己紹介');
  assert.deepEqual(calls.map(call => call.method), ['PATCH']);
});

test('更新エラー・保存後の取得エラー・保存内容不一致は成功を返さない', async t => {
  for (const mode of ['更新エラー', '再取得エラー', '内容不一致']) await t.test(mode, async () => {
    const saved = profile(detailId, values);
    const { supabase } = client(call => {
      if ((mode === '更新エラー' && call.method === 'PATCH') || (mode === '再取得エラー' && call.method === 'GET')) return { status: 403, data: { code: '42501', message: 'アクセス拒否' } };
      return { data: call.method === 'PATCH' ? [saved] : { ...saved, ...(mode === '内容不一致' ? { bio: '保存されていない' } : {}) } };
    });
    await assert.rejects(saveLinkedPlayerProfile(supabase, userId, detailId, values, profile()));
  });
});

test('ログインアカウントが切り替わっていたら更新リクエストを送らない', async () => {
  const { supabase, calls } = client(() => ({ data: [] }), '別アカウント');
  await assert.rejects(saveLinkedPlayerProfile(supabase, userId, detailId, values, profile()), /ログイン情報が変わりました/);
  assert.equal(calls.length, 0);
});

test('アカウント連携も更新0件を成功にせず、既存の連携先を条件にする', async () => {
  const { supabase, calls } = client(() => ({ data: [] }));
  await assert.rejects(setPlayerProfileAccountLink(supabase, detailId, userId, null), /連携の更新を確認できません/);
  assert.equal(calls[0].url.searchParams.get('linked_auth_user_id'), 'is.null');
});

test('別グループの異なる選手を同じアカウントに連携できる設計を保持する', async () => {
  const { supabase } = client(call => ({ data: [{ id: call.url.searchParams.get('id').slice(3), linked_auth_user_id: userId }] }));
  await setPlayerProfileAccountLink(supabase, detailId, userId, null);
  await setPlayerProfileAccountLink(supabase, '別グループの選手', userId, null);
});

test('所属・参加・フレンドリーチーム戦・公式戦・申請の参照を選手ごとに集計する', async () => {
  const { supabase } = client(call => {
    if (call.table === 'club_members') return { data: [{ id: '所属', player_profile_id: detailId, is_active: true, clubs: { name: '所属グループ', is_active: true } }] };
    if (call.table === 'event_participants') return { data: [{ id: '参加', player_profile_id: detailId }] };
    if (call.table === 'join_requests') return { data: [{ id: '申請', requester_player_profile_id: detailId }] };
    if (call.table === 'event_team_matches' && call.url.searchParams.has('team_b_player2_profile_id')) return { data: [{ id: 'チーム戦', team_b_player2_profile_id: detailId }] };
    if (call.table === 'official_matches' && call.url.searchParams.has('our_player1_profile_id')) return { data: [{ id: '公式戦', our_player1_profile_id: detailId }] };
    return { data: [] };
  });
  const usage = await fetchProfileUsage(supabase, [profile()]);
  assert.deepEqual(usage.get(detailId), { groups: ['所属グループ'], memberships: 1, participants: 1, teamMatches: 1, officialMatches: 1, joinRequests: 1 });
});
