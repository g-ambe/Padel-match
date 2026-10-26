require('node:module').registerHooks({ resolve(specifier, context, next) { return next(specifier === './friendly-match-results' ? specifier + '.ts' : specifier, context); } });
const rounds = require('../../lib/friendly-rounds.ts');
const seededRandom = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let n = Math.imul(seed ^ seed >>> 15, 1 | seed); n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n; return ((n ^ n >>> 14) >>> 0) / 4294967296; };
const idsFor = n => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
const card = (ids, round = 1, extra = {}) => ({ event_id: 'event', round_number: round, completed: true, result: { score_a: 4, score_b: 2 }, players: ids.map((id, i) => ({ participant_id: id, team: i < 2 ? 'A' : 'B' })), ...extra });
const neutralHistory = ids => Array.from({ length: 12 }, (_, i) => {
  const patterns = [[ids[0], ids[1], ids[2], ids[3]], [ids[0], ids[2], ids[1], ids[3]], [ids[0], ids[3], ids[1], ids[2]]];
  return card(patterns[i % 3], i + 1, { result: [{ score_a: 4, score_b: 0 }, { score_a: 4, score_b: 3 }, { score_a: 2, score_b: 2 }][i % 3] });
});
module.exports = { ...rounds, seededRandom, idsFor, card, neutralHistory };
