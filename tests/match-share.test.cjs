const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMatchShareText, getMatchShareUrls, storedTeamShareScore, buildLineShareUrl, isLineMobileDevice, MAX_LINE_SHARE_URL_LENGTH } = require('../lib/match-share-text.ts');
const { hasEnteredFriendlyMatchScore } = require('../lib/friendly-match-results.ts');
const { copyMatchShareText, openLineShare } = require('../lib/match-share-actions.ts');

const event = { status: 'closed', is_deleted: false, share_enabled: true, share_token: 'share-token_123' };
const match = { teamA: ['安倍', '瀧田'], teamB: ['篠原', '今野'], score: { a: 4, b: 2 }, youtubeUrl: 'https://youtu.be/E_f_A-FBni4' };
const params = { event, eventName: '261023 部活', origin: 'https://padel.example.org', kind: 'events', matches: [match] };

test('指定形式の全文・動画・ログインと登録URLを生成し、イベント名の日付を追加しない', () => {
  assert.equal(buildMatchShareText(params), [
    '▼261023 部活 安倍瀧田vs篠原今野', 'スコア：4-2', '動画URL：https://youtu.be/E_f_A-FBni4', '',
    '戦績詳細：', 'https://padel.example.org/share/events/share-token_123', '',
    'ログインして確認：', 'https://padel.example.org/login', '',
    'アカウント作成：', 'https://padel.example.org/login?mode=signup',
  ].join('\n'));
});

test('全試合の順序と個々の動画を保持し、動画のない行を省略する', () => {
  const text = buildMatchShareText({ ...params, matches: [match, { ...match, teamA: ['赤木', '青木'], score: { a: 2, b: 2 }, youtubeUrl: null }, { ...match, teamA: ['北沢', '蓮見'], score: null, youtubeUrl: 'https://youtu.be/second' }] });
  assert.match(text, /スコア：4-2\n動画URL：https:\/\/youtu.be\/E_f_A-FBni4\n\n▼261023 部活 赤木青木vs篠原今野\nスコア：2-2\n\n▼261023 部活 北沢蓮見vs篠原今野\nスコア：未入力\n動画URL：https:\/\/youtu.be\/second/);
  assert.equal((text.match(/動画URL：/g) ?? []).length, 2);
  assert.equal((text.match(/▼/g) ?? []).length, 3);
});

test('通常・チーム・公式のURLは実際のoriginから組み立てる', () => {
  for (const kind of ['events', 'official-events']) {
    assert.equal(getMatchShareUrls(event, 'https://production.padel.app', kind).detail, `https://production.padel.app/share/${kind}/share-token_123`);
    const text = buildMatchShareText({ ...params, kind, origin: 'http://127.0.0.1:4567', eventName: '公式大会' });
    assert.match(text, new RegExp(`/share/${kind}/share-token_123`));
    assert.match(text, /http:\/\/127.0.0.1:4567\/login\?mode=signup$/);
  }
});

test('開催中・削除・停止・トークン不正・origin不正は文章生成でも拒否する', () => {
  for (const patch of [{ status: 'active' }, { status: 'unknown' }, { is_deleted: true }, { share_enabled: false }, { share_enabled: null }, { share_token: null }, { share_token: '' }, { share_token: 'a/b?token' }, { share_token: ' token ' }]) {
    const nextEvent = { ...event, ...patch };
    assert.equal(getMatchShareUrls(nextEvent, params.origin, 'events'), null);
    assert.throws(() => buildMatchShareText({ ...params, event: nextEvent }), /共有リンクが有効/);
  }
  for (const origin of ['', 'invalid', 'javascript:alert(1)', 'file:///tmp/file']) assert.equal(getMatchShareUrls(event, origin, 'events'), null);
});

test('再発行したトークンだけを使用し、共有停止後は生成できない', () => {
  const text = buildMatchShareText({ ...params, event: { ...event, share_token: 'new-token' } });
  assert.match(text, /\/share\/events\/new-token/);
  assert(!text.includes('share-token_123'));
  assert.throws(() => buildMatchShareText({ ...params, event: { ...event, share_enabled: false, share_token: null } }));
});

test('下書き・空欄を補完せず、成立しているカードだけを出力する', () => {
  const invalid = [
    { ...match, teamA: [] }, { ...match, teamB: ['篠原'] }, { ...match, teamA: ['安倍', null] },
    { ...match, teamA: ['安倍', '  '] }, { ...match, teamB: ['a', 'b', 'c'] },
  ];
  const text = buildMatchShareText({ ...params, matches: [...invalid, match] });
  assert.equal((text.match(/▼/g) ?? []).length, 1);
  assert.throws(() => buildMatchShareText({ ...params, matches: invalid }), /共有できる試合がありません/);
  assert.throws(() => buildMatchShareText({ ...params, matches: [] }), /共有できる試合がありません/);
});

test('不正な数値は補完せず未入力として扱う', () => {
  for (const score of [null, { a: NaN, b: 1 }, { a: 1, b: Infinity }, { a: -1, b: 2 }, { a: 1.5, b: 2 }]) assert.match(buildMatchShareText({ ...params, matches: [{ ...match, score }] }), /スコア：未入力/);
  assert.match(buildMatchShareText({ ...params, matches: [{ ...match, score: { a: 0, b: 0 } }] }), /スコア：0-0/);
});

test('チーム戦・公式戦の未定0-0と明示的な引き分け0-0を区別する', () => {
  assert.equal(storedTeamShareScore(0, 0, 'undecided'), null);
  assert.deepEqual(storedTeamShareScore(0, 0, 'draw'), { a: 0, b: 0 });
  assert.deepEqual(storedTeamShareScore(2, 2, 'draw'), { a: 2, b: 2 });
  assert.deepEqual(storedTeamShareScore(4, 0, 'win'), { a: 4, b: 0 });
  for (const [a, b] of [[null, null], [null, 2], [2, null], [NaN, 2], [-1, 1]]) assert.equal(storedTeamShareScore(a, b, 'draw'), null);
});

test('通常試合の既存成立判定を維持し、未完了0-0を共有スコアにしない', () => {
  assert.equal(hasEnteredFriendlyMatchScore({ completed: false, result: { score_a: 0, score_b: 0 } }), false);
  assert.equal(hasEnteredFriendlyMatchScore({ completed: true, result: { score_a: 0, score_b: 0 } }), true);
  assert.equal(hasEnteredFriendlyMatchScore({ completed: true, result: null }), false);
});

test('LINEへ改行・記号・日本語・全文をエンコードし、長文も切り詰めない', () => {
  const text = buildMatchShareText({ ...params, eventName: '大会 & + # 🎾', matches: Array.from({ length: 100 }, () => match) });
  const url = buildLineShareUrl(text);
  assert(url.startsWith('https://line.me/R/share?text='));
  assert.equal(new URL(url).searchParams.get('text'), text);
  assert(url.length > MAX_LINE_SHARE_URL_LENGTH);
  assert(text.includes('\n\nアカウント作成：\n'));
});

test('PCはコピーへ、iPadのデスクトップUAを含むスマートフォンはLINEへ振り分ける', () => {
  assert.equal(isLineMobileDevice('Windows NT 10.0', 0), false);
  assert.equal(isLineMobileDevice('Macintosh Intel Mac OS X', 0), false);
  assert.equal(isLineMobileDevice('Macintosh Intel Mac OS X', 5), true);
  for (const ua of ['iPhone', 'iPad', 'Android', 'iPod']) assert.equal(isLineMobileDevice(ua, 1), true);
});

test('全文コピー・従来コピー・拒否時のエラーと後片付けを確認する', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let listener, copied, shouldFire = true, legacyAllowed = true;
  const document = {
    addEventListener(type, fn) { assert.equal(type, 'copy'); listener = fn; },
    removeEventListener(type, fn) { assert.equal(fn, listener); listener = null; },
    execCommand(type) { assert.equal(type, 'copy'); if (shouldFire) listener({ preventDefault() {}, clipboardData: { setData(format, text) { assert.equal(format, 'text/plain'); copied = text; } } }); return legacyAllowed; },
  };
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async writeText(text) { copied = text; } } } });
    const text = buildMatchShareText(params);
    await copyMatchShareText(text);
    assert.equal(copied, text);
    assert.equal(listener, undefined);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    copied = null;
    await copyMatchShareText(text);
    assert.equal(copied, text);
    assert.equal(listener, null);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async writeText() { throw new Error('拒否'); } } } });
    await copyMatchShareText(text);
    assert.equal(listener, null);
    legacyAllowed = false;
    await assert.rejects(copyMatchShareText(text), /コピーに失敗/);
    assert.equal(listener, null);
    legacyAllowed = true; shouldFire = false;
    await assert.rejects(copyMatchShareText(text), /コピーに失敗/);
    assert.equal(listener, null);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
  }
});

test('LINEウィンドウのopenerを切り、ブロック・開始失敗を検出する', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let popup, navigated, closed = false;
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { open(url, target) { assert.equal(url, ''); assert.equal(target, '_blank'); return popup; } } });
    popup = { opener: {}, location: { replace(url) { navigated = url; } } };
    const url = buildLineShareUrl(buildMatchShareText(params));
    assert.equal(openLineShare(url), true);
    assert.equal(popup.opener, null);
    assert.equal(navigated, url);
    popup = null;
    assert.equal(openLineShare(url), false);
    window.open = () => { throw new Error('起動拒否'); };
    assert.equal(openLineShare(url), false);
    window.open = () => popup;
    popup = { location: { replace() { throw new Error('開始失敗'); } }, close() { closed = true; } };
    assert.equal(openLineShare(url), false);
    assert.equal(closed, true);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window;
  }
});
