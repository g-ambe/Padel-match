// 実行例: node tests/simulations/friendly-rounds.cjs --seeds=500 --rounds=12 --scenario=10人2面 --out=/tmp/rounds-10.json
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { generateFriendlyRound, friendlyFormScores, friendlyRivalContext, friendlyPairKey, seededRandom, idsFor, card } = require('../fixtures/friendly-round-helpers.cjs');
const { legacyFriendlyRound } = require('../fixtures/legacy-friendly-round.cjs');
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const seeds = Number(option('seeds', '500')), rounds = Number(option('rounds', '12'));
const scenarios = [{ name: '4人1面', n: 4, courts: 1 }, { name: '8人2面', n: 8, courts: 2 }, { name: '10人2面', n: 10, courts: 2 }, { name: '12人2面', n: 12, courts: 2 }, { name: '途中参加退出', n: 12, courts: 2, change: true }].filter(row => !option('scenario', '') || row.name === option('scenario', ''));
const algorithms = ['legacy', 'normal', 'balance', 'rival'];
const edges = (matches, opponent = false) => matches.flatMap(m => opponent ? m.teamA.flatMap(a => m.teamB.map(b => friendlyPairKey(a, b))) : [friendlyPairKey(...m.teamA), friendlyPairKey(...m.teamB)]);
const asMatches = history => history.map(m => ({ teamA: m.players.filter(p => p.team === 'A').map(p => p.participant_id), teamB: m.players.filter(p => p.team === 'B').map(p => p.participant_id) }));
const countsOf = list => { const map = new Map(); for (const key of list) map.set(key, (map.get(key) ?? 0) + 1); return map; };
const spread = rows => Math.max(...rows) - Math.min(...rows);
const resultCard = (match, round, index, strength) => {
  const delta = match.teamA.reduce((n, id) => n + strength.get(id), 0) - match.teamB.reduce((n, id) => n + strength.get(id), 0);
  const draw = Math.abs(delta) < 10 || index % 7 === 1, low = 3 - Math.min(3, Math.floor(Math.abs(delta) / 25));
  const scores = draw ? [2, 2] : delta > 0 ? [4, low] : [low, 4];
  return card([...match.teamA, ...match.teamB], round, { completed: index % 7 !== 0, result: index % 7 === 0 ? null : { score_a: scores[0], score_b: scores[1] } });
};
const rows = [];
for (const scenario of scenarios) {
  const all = idsFor(scenario.n), known = new Set(all);
  const totals = Object.fromEntries(algorithms.map(algorithm => [algorithm, { restGap: 0, playGap: 0, consecutiveRest: 0, consecutivePair: 0, pairRepeat: 0, newPair: 0, opponentRepeat: 0, consecutiveOpponent: 0, teamGap: 0, pairGap: 0, rivalMet: 0, matches: 0, success: 0, plays: all.map(() => 0), rests: all.map(() => 0) }]));
  for (let seed = 0; seed < seeds; seed++) {
    const activeAt = step => scenario.change ? (step < 6 ? all.slice(0, 10) : all.slice(2)) : all;
    const strength = new Map(all.map((id, i) => [id, 90 - i * 70 / (all.length - 1)]));
    const initial = [];
    const warmupRounds = Math.ceil(14 / scenario.courts);
    for (let round = 1; round <= warmupRounds; round++) {
      const generated = legacyFriendlyRound({ ids: activeAt(0), courtCount: scenario.courts, history: initial, lastRound: round - 1, random: seededRandom(seed * 100003 + round) });
      generated.matches.forEach((match, i) => initial.push(resultCard(match, round, (round - 1) * scenario.courts + i, strength)));
    }
    const state = Object.fromEntries(algorithms.map(algorithm => [algorithm, { history: [...initial], plays: all.map(() => 0), rests: all.map(() => 0), lastRest: new Set(activeAt(0).filter(id => !initial.filter(m => m.round_number === warmupRounds).some(m => m.players.some(p => p.participant_id === id)))), pairs: countsOf(edges(asMatches(initial))), opponents: countsOf(edges(asMatches(initial), true)), lastPairs: new Set(edges(asMatches(initial.filter(m => m.round_number === warmupRounds)))), lastOpponents: new Set(edges(asMatches(initial.filter(m => m.round_number === warmupRounds)), true)) }]));
    for (let step = 0; step < rounds; step++) {
      const active = activeAt(step), lastRound = warmupRounds + step;
      let expectedRest;
      for (const algorithm of algorithms) {
        const current = state[algorithm], total = totals[algorithm];
        const form = friendlyFormScores('event', current.history, known);
        const random = seededRandom(seed * 1000003 + step * 997 + 123);
        const generated = algorithm === 'legacy' ? legacyFriendlyRound({ ids: active, courtCount: scenario.courts, history: current.history, lastRound, random }) : generateFriendlyRound({ eventId: 'event', participantIds: active, knownParticipantIds: known, courtCount: scenario.courts, lastRound, history: current.history, mode: algorithm, random });
        if (expectedRest) assert.deepEqual(generated.resters, expectedRest); else expectedRest = generated.resters;
        const playing = generated.matches.flatMap(m => [...m.teamA, ...m.teamB]);
        assert.equal(new Set(playing).size, generated.matches.length * 4); assert(playing.every(id => active.includes(id))); assert(generated.resters.every(id => !playing.includes(id)));
        if (algorithm !== 'legacy') { assert.equal(generated.consecutive, generated.diagnostics.minConsecutive); assert(generated.pair <= generated.diagnostics.minPair + 400); }
        for (const id of active) {
          const i = all.indexOf(id);
          if (generated.resters.includes(id)) { current.rests[i]++; if (current.lastRest.has(id)) total.consecutiveRest++; } else current.plays[i]++;
        }
        const pairs = edges(generated.matches), opponents = edges(generated.matches, true);
        for (const key of pairs) { const count = current.pairs.get(key) ?? 0; total.pairRepeat += count; if (!count) total.newPair++; if (current.lastPairs.has(key)) total.consecutivePair++; current.pairs.set(key, count + 1); }
        for (const key of opponents) { const count = current.opponents.get(key) ?? 0; total.opponentRepeat += count; if (current.lastOpponents.has(key)) total.consecutiveOpponent++; current.opponents.set(key, count + 1); }
        const top = friendlyRivalContext(playing, form).topPair;
        if (opponents.includes(top)) total.rivalMet++;
        for (const match of generated.matches) {
          const [a, b] = [match.teamA, match.teamB].map(team => team.map(id => form.get(id)));
          total.teamGap += Math.abs(a[0] + a[1] - b[0] - b[1]);
          total.pairGap += (Math.abs(a[0] - a[1]) + Math.abs(b[0] - b[1])) / 2;
        }
        generated.matches.forEach((match, i) => current.history.push(resultCard(match, lastRound + 1, (lastRound * scenario.courts) + i, strength)));
        current.lastRest = new Set(generated.resters); current.lastPairs = new Set(pairs); current.lastOpponents = new Set(opponents);
        total.matches += generated.matches.length; total.success++;
      }
    }
    for (const algorithm of algorithms) {
      const current = state[algorithm], total = totals[algorithm];
      assert.deepEqual(current.plays, state.legacy.plays); assert.deepEqual(current.rests, state.legacy.rests);
      total.restGap += spread(current.rests); total.playGap += spread(current.plays);
      current.plays.forEach((n, i) => { total.plays[i] += n; total.rests[i] += current.rests[i]; });
    }
  }
  for (const algorithm of algorithms) {
    const t = totals[algorithm], round1 = value => Math.round(value * 100) / 100;
    rows.push({ scenario: scenario.name, algorithm, seeds, rounds, restGap: round1(t.restGap / seeds), playGap: round1(t.playGap / seeds), consecutiveRest: round1(t.consecutiveRest / seeds), consecutivePair: round1(t.consecutivePair / seeds), pairRepeat: round1(t.pairRepeat / seeds), newPair: round1(t.newPair / seeds), opponentRepeat: round1(t.opponentRepeat / seeds), consecutiveOpponent: round1(t.consecutiveOpponent / seeds), teamGap: round1(t.teamGap / t.matches), withinPairGap: round1(t.pairGap / t.matches), topRivalRate: round1(100 * t.rivalMet / (seeds * rounds)), successRate: round1(100 * t.success / (seeds * rounds)), plays: t.plays.map(n => round1(n / seeds)), rests: t.rests.map(n => round1(n / seeds)) });
  }
  process.stderr.write(`${scenario.name}: ${seeds}シード × ${rounds}Round × 4方式を完了\n`);
}
const output = { seeds, rounds, warmup: '共通の従来方式で14試合以上を事前生成。未入力と引き分けを含む。', rows };
const path = option('out', ''); if (path) fs.writeFileSync(path, JSON.stringify(output, null, 2) + '\n'); else process.stdout.write(JSON.stringify(output, null, 2) + '\n');
