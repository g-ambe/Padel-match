// ローカルの匿名化済み履歴だけを使用する。ネットワーク接続・DB書込みは行わない。
const fs = require('node:fs');
const path = require('node:path');
const { generateFriendlyRound, friendlyHistory, friendlyPairKey, balancePairPenalty, friendlyRivalContext, seededRandom } = require('../tests/fixtures/friendly-round-helpers.cjs');

function compareModes(input, seeds = Array.from({ length: 128 }, (_, i) => i + 1)) {
  const known = new Set(input.knownParticipantIds), modes = ['normal', 'balance', 'rival'];
  const historical = friendlyHistory(input.eventId, input.history, known, input.lastRound);
  const outputs = Object.fromEntries(modes.map(mode => [mode, []]));
  const pairKeys = result => result.matches.flatMap(match => [friendlyPairKey(...match.teamA), friendlyPairKey(...match.teamB)]);
  for (const seed of seeds) for (const mode of modes) {
    const result = generateFriendlyRound({ ...input, knownParticipantIds: known, mode, random: seededRandom(seed) });
    const playing = result.matches.flatMap(match => [...match.teamA, ...match.teamB]);
    const rival = friendlyRivalContext(playing, result.form);
    const pairs = pairKeys(result), opponents = result.matches.flatMap(match => match.teamA.flatMap(a => match.teamB.map(b => friendlyPairKey(a, b))));
    const topOpposed = opponents.includes(rival.topPair), rivalWeight = opponents.reduce((total, key) => total + (rival.auxiliary.get(key) ?? 0), 0);
    const restTotals = input.participantIds.map(id => [...historical.roundPlayers].filter(([round, players]) => round > 0 && !players.has(id)).length + Number(result.resters.includes(id)));
    const average = numbers => numbers.reduce((a, b) => a + b, 0) / numbers.length;
    const form = id => result.form.get(id) ?? 50;
    const metrics = {
      teamGap: average(result.matches.map(m => Math.abs(m.teamA.reduce((sum, id) => sum + form(id), 0) - m.teamB.reduce((sum, id) => sum + form(id), 0)) / 2)),
      withinPairGap: average(result.matches.flatMap(m => [Math.abs(form(m.teamA[0]) - form(m.teamA[1])), Math.abs(form(m.teamB[0]) - form(m.teamB[1]))])),
      topOpposed: Number(topOpposed),
      topPaired: Number(pairs.includes(rival.topPair)),
      hotOpponents: opponents.filter(key => key === rival.topPair || rival.auxiliary.has(key)).length,
      repeatedPairs: pairs.filter(key => historical.pairs.has(key)).length,
      priorPairOccurrences: pairs.reduce((sum, key) => sum + (historical.pairs.get(key) ?? 0), 0),
      consecutivePairs: result.consecutive,
      priorOpponentOccurrences: opponents.reduce((sum, key) => sum + (historical.opponents.get(key) ?? 0), 0),
      restSpread: Math.max(...restTotals) - Math.min(...restTotals),
      balancePenalty: average(result.matches.map(match => balancePairPenalty(match, result.form))),
      rivalPenalty: Math.max(0, Math.min(100, 70 * Number(!topOpposed) + (rival.totalWeight ? 30 * (1 - rivalWeight / rival.totalWeight) : 0))),
      selectedModePenalty: result.modePenalty,
      pairPenalty: result.pair,
      opponentPenalty: result.opponent,
      final: result.final
    };
    outputs[mode].push({ seed, matches: result.matches, resters: result.resters, form: Object.fromEntries(result.form), metrics, diagnostics: result.diagnostics });
  }
  const summaries = Object.fromEntries(modes.map(mode => [mode, Object.fromEntries(Object.keys(outputs[mode][0].metrics).map(key => [key, outputs[mode].reduce((sum, row) => sum + row.metrics[key], 0) / seeds.length]))]));
  const sameResters = seeds.every((_, i) => modes.every(mode => JSON.stringify(outputs[mode][i].resters) === JSON.stringify(outputs.normal[i].resters)));
  const signature = row => pairKeys(row).sort().join('|');
  const matchupSignature = row => row.matches.map(m => [friendlyPairKey(...m.teamA),friendlyPairKey(...m.teamB)].sort().join(' vs ')).sort().join('|');
  const changedPairs = Object.fromEntries(modes.slice(1).map(mode => [mode, seeds.filter((_, i) => signature(outputs[mode][i]) !== signature(outputs.normal[i])).length]));
  const changedMatchups = Object.fromEntries(modes.slice(1).map(mode => [mode, seeds.filter((_, i) => matchupSignature(outputs[mode][i]) !== matchupSignature(outputs.normal[i])).length]));
  const exampleIndex = seeds.findIndex((_, i) => modes.slice(1).some(mode => matchupSignature(outputs[mode][i]) !== matchupSignature(outputs.normal[i])));
  return { read_at: input.read_at, seeds: seeds.length, summaries, sameResters, changedPairs, changedMatchups, forms: outputs.normal[0].form, example: Object.fromEntries(modes.map(mode => [mode, outputs[mode][Math.max(0, exampleIndex)]])), outputs };
}

if (require.main === module) {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/fixtures/friendly-mode-event-261029.json'), 'utf8'));
  const { outputs, ...report } = compareModes(fixture);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
module.exports = { compareModes };
