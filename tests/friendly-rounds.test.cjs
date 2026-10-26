const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateFriendlyRound, scoredFriendlyMatches, friendlyFormScores, friendlyHistory, friendlyPairKey, balancePairPenalty, friendlyRivalContext, seededRandom, idsFor, card, neutralHistory } = require('./fixtures/friendly-round-helpers.cjs');
const { legacyFriendlyRound } = require('./fixtures/legacy-friendly-round.cjs');
const { readFriendlyRoundRows } = require('../lib/friendly-round-history.ts');
const ids = idsFor(4), known = new Set(ids);
const params = (extra = {}) => ({ eventId: 'event', participantIds: ids, knownParticipantIds: known, courtCount: 1, lastRound: 0, history: [], mode: 'normal', random: seededRandom(10), ...extra });

test('解放はイベント内の成立・完了・有効スコアだけを数え、0/9/10/11件を区別する', () => {
  for (const n of [0, 9, 10, 11]) {
    const history = Array.from({ length: n }, (_, i) => card(ids, i + 1));
    assert.equal(scoredFriendlyMatches('event', history, known).length, n);
    for (const mode of ['balance', 'rival']) {
      if (n < 10) assert.throws(() => generateFriendlyRound(params({ history, mode })), /10試合達成後/);
      else assert.equal(generateFriendlyRound(params({ history, mode })).matches.length, 1);
    }
  }
  const history = [card(ids, 1, { result: { score_a: 2, score_b: 2 } }), card(ids, 2, { result: { score_a: 0, score_b: 0 } }),
    ...[{ event_id: 'other' }, { completed: false }, { result: null }, { result: { score_a: -1, score_b: 2 } }, { result: { score_a: NaN, score_b: 2 } }, { result: { score_a: 1.5, score_b: 2 } }, { players: [] }, { players: card([ids[0], ids[0], ids[2], ids[3]]).players }, { players: card(['unknown', ...ids.slice(1)]).players }].map(extra => card(ids, 3, extra))];
  assert.equal(scoredFriendlyMatches('event', history, known).length, 2);
});

test('ペアと対戦の履歴を別々に集計し、順不同・4対戦・上限・直前加算を扱う', () => {
  const history = [card(ids, 1, { completed: false, result: null }), card([...ids].reverse(), 2, { completed: false, result: null })];
  const data = friendlyHistory('event', history, known, 2);
  assert.equal(data.pairs.size, 2); assert.equal(data.opponents.size, 4);
  assert.equal(data.pairs.get(friendlyPairKey(ids[0], ids[1])), 2);
  assert.equal(data.pairs.has(friendlyPairKey(ids[0], ids[2])), false);
  assert.equal(data.opponents.get(friendlyPairKey(ids[0], ids[2])), 2);
  assert.equal(data.lastOpponents.size, 4);
  assert.deepEqual([...friendlyFormScores('event', history, known).values()], [50, 50, 50, 50]);
  const malformed = [card([ids[0], ids[0], ids[2], ids[3]]), card(ids, 3, { players: card(ids).players.slice(0, 3) }), card(ids, 3, { event_id: 'other' })];
  assert.equal(friendlyHistory('event', malformed, known, 3).pairs.size, 0);
  // 全3パターンを複数回経験し、対戦回数は4回分までで飽和する。
  const saturated = generateFriendlyRound(params({ history: neutralHistory(ids), lastRound: 13, random: () => 0 }));
  assert.equal(saturated.opponent, 4 * 140);
  const recent = generateFriendlyRound(params({ history: Array.from({ length: 5 }, (_, i) => card(ids, i + 1)), lastRound: 5, random: () => 0 }));
  assert.equal(recent.opponent, 2 * (140 + 60));
});

test('好調度は補正勝率・引き分け・平均得失点差の制限を使用し、途中参加は50', () => {
  const form = friendlyFormScores('event', [card(ids, 1, { result: { score_a: 100, score_b: 0 } })], new Set([...ids, 'new-player']));
  assert.equal(form.get(ids[0]), 68); assert.equal(form.get(ids[2]), 32); assert.equal(form.get('new-player'), 50);
  const draw = friendlyFormScores('event', [card(ids, 1, { result: { score_a: 2, score_b: 2 } })], known);
  assert.equal(draw.get(ids[0]), 50);
  const foreign = friendlyFormScores('event', [card(ids, 1, { event_id: 'other' })], known);
  assert.equal(foreign.get(ids[0]), 50);
});

test('600回の休憩選定は従来方式と500シードで一致し、途中参加・途中退出でもモード間で変わらない', () => {
  const all = idsFor(12), history = [card(all.slice(0, 4), 1), card(all.slice(4, 8), 1), card(all.slice(4, 8), 2), card(all.slice(8, 12), 2)];
  for (let seed = 0; seed < 500; seed++) {
    const options = { ids: all, courtCount: 2, history, lastRound: 2 };
    const baseline = legacyFriendlyRound({ ...options, random: seededRandom(seed) });
    const generated = generateFriendlyRound(params({ participantIds: all, knownParticipantIds: new Set(all), courtCount: 2, history, lastRound: 2, random: seededRandom(seed) }));
    assert.deepEqual(generated.resters, baseline.resters);
  }
  const changed = [...all.slice(0, 9), 'new-player'];
  const scored = [...history, ...neutralHistory(all)];
  for (const mode of ['normal', 'balance', 'rival']) {
    const generated = generateFriendlyRound(params({ participantIds: changed, knownParticipantIds: new Set([...all, 'new-player']), courtCount: 2, history: scored, lastRound: 12, mode, random: seededRandom(5) }));
    const standard = generateFriendlyRound(params({ participantIds: changed, knownParticipantIds: new Set([...all, 'new-player']), courtCount: 2, history: scored, lastRound: 12, random: seededRandom(5) }));
    assert.deepEqual(generated.resters, standard.resters);
    assert(generated.matches.flatMap(m => [...m.teamA, ...m.teamB]).every(id => changed.includes(id)));
  }
});

test('連続ペアの最少と最良+400を全モードで守り、4人や5コートでも重複なく生成する', () => {
  for (const [n, courts] of [[4, 1], [8, 2], [10, 2], [12, 2], [20, 5]]) {
    const all = idsFor(n), history = neutralHistory(all);
    for (const mode of ['normal', 'balance', 'rival']) {
      const result = generateFriendlyRound(params({ participantIds: all, knownParticipantIds: new Set(all), courtCount: courts, history, lastRound: 12, mode, random: seededRandom(n) }));
      assert.equal(result.matches.length, courts);
      assert.deepEqual(result.matches.map(m => m.court).sort((a, b) => a - b), Array.from({ length: courts }, (_, i) => i + 1));
      const playing = result.matches.flatMap(m => [...m.teamA, ...m.teamB]);
      assert.equal(new Set(playing).size, courts * 4); assert.equal(playing.length + result.resters.length, n);
      assert(result.resters.every(id => !playing.includes(id)));
      assert.equal(result.consecutive, result.diagnostics.minConsecutive);
      assert(result.pair <= result.diagnostics.minPair + 400);
      assert(result.final >= result.opponent + 0.6 * result.modePenalty);
      assert(result.final < result.opponent + 0.6 * result.modePenalty + 5);
      assert(result.modePenalty >= 0 && result.modePenalty <= 100);
      if (n === 4) assert.equal(result.consecutive, 0);
    }
  }
});

test('同じ4人の3パターンを早期確定せず、バランスとライバルの評価を実際の選択へ反映する', () => {
  const history = neutralHistory(ids);
  const result = mode => generateFriendlyRound(params({ history, lastRound: 13, mode, random: () => 0 }));
  const normal = result('normal'), balance = result('balance'), rival = result('rival');
  assert.equal(normal.diagnostics.evaluated, 3);
  assert.equal(friendlyPairKey(...normal.matches[0].teamA), friendlyPairKey(ids[0], ids[1]));
  const form = friendlyFormScores('event', history, known);
  assert(balancePairPenalty(balance.matches[0], form) < balancePairPenalty(normal.matches[0], form));
  const top = friendlyRivalContext(ids, form).topPair;
  const opposed = match => match.teamA.some(a => match.teamB.some(b => friendlyPairKey(a, b) === top));
  assert.equal(opposed(normal.matches[0]), false); assert.equal(opposed(rival.matches[0]), true);
  const scores = new Map(ids.map((id, i) => [id, [90, 80, 40, 20][i]]));
  assert(balancePairPenalty({ teamA: [ids[0], ids[3]], teamB: [ids[1], ids[2]] }, scores) < balancePairPenalty({ teamA: [ids[0], ids[1]], teamB: [ids[2], ids[3]] }, scores));
  assert.equal(friendlyRivalContext([...ids].reverse(), new Map(ids.map(id => [id, 50]))).topPair, friendlyPairKey(ids[0], ids[1]));
});

test('入力履歴・参加者を変更せず、不足人数・不正モード・不正コート数を拒否する', () => {
  const history = neutralHistory(ids), snapshot = JSON.stringify(history), before = [...ids];
  generateFriendlyRound(params({ history, lastRound: 12 }));
  assert.equal(JSON.stringify(history), snapshot); assert.deepEqual(ids, before);
  assert.throws(() => generateFriendlyRound(params({ participantIds: ids.slice(0, 3) })), /4人未満/);
  assert.throws(() => generateFriendlyRound(params({ participantIds: [ids[0], ids[0], ids[2], ids[3]] })), /参加者情報/);
  assert.throws(() => generateFriendlyRound(params({ mode: 'unknown' })), /モードを確認/);
  assert.throws(() => generateFriendlyRound(params({ courtCount: 0 })), /コート数/);
});

test('500件ごとの履歴取得で1000件を超える履歴も読み、取得失敗を空履歴と混同しない', async () => {
  const rows = Array.from({ length: 1001 }, (_, id) => ({ id }));
  const calls = [];
  const result = await readFriendlyRoundRows(async (start, end) => { calls.push([start, end]); return { data: rows.slice(start, end + 1), error: null }; });
  assert.deepEqual(result.data, rows); assert.deepEqual(calls, [[0, 499], [500, 999], [1000, 1499]]);
  for (const response of [{ data: [], error: new Error('拒否') }, { data: null, error: null }]) {
    const failed = await readFriendlyRoundRows(async () => response);
    assert.equal(failed.data, null); assert.match(failed.error.message, /確認できません/);
  }
});
