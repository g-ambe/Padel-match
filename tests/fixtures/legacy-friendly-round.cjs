// 比較専用。PR #156時点の画面内の600回／700回探索を保持する。本番からは読み込まない。
function legacyFriendlyRound({ ids, courtCount, history, lastRound, random }) {
  const active = ids.map(id => ({ id }));
  const maxMatches = Math.min(courtCount, Math.floor(active.length / 4));
  const slots = maxMatches * 4, restNeeded = active.length - slots;
  const lastRoundNumber = lastRound, historyMatches = history;
  const pairKey = (a, b) => [a, b].sort().join('|');
    const pairCounts = new Map();
    const uniquePartners = new Map();
    const restCounts = new Map();
    const activeIds = new Set(active.map((p) => p.id));
    for (const p of active) {
      uniquePartners.set(p.id, new Set());
      restCounts.set(p.id, 0);
    }

    const roundPlayerMap = new Map();
    for (const m of historyMatches) {
      if (!roundPlayerMap.has(m.round_number)) roundPlayerMap.set(m.round_number, new Set());
      const set = roundPlayerMap.get(m.round_number);
      const teamA = m.players.filter((x) => x.team === "A").map((x) => x.participant_id);
      const teamB = m.players.filter((x) => x.team === "B").map((x) => x.participant_id);
      for (const pid of [...teamA, ...teamB]) set.add(pid);
      if (teamA.length === 2) {
        const k = pairKey(teamA[0], teamA[1]);
        pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
        if (activeIds.has(teamA[0]) && activeIds.has(teamA[1])) {
          uniquePartners.get(teamA[0])?.add(teamA[1]);
          uniquePartners.get(teamA[1])?.add(teamA[0]);
        }
      }
      if (teamB.length === 2) {
        const k = pairKey(teamB[0], teamB[1]);
        pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
        if (activeIds.has(teamB[0]) && activeIds.has(teamB[1])) {
          uniquePartners.get(teamB[0])?.add(teamB[1]);
          uniquePartners.get(teamB[1])?.add(teamB[0]);
        }
      }
    }

    for (const [rn, playersInRound] of roundPlayerMap) {
      if (rn <= 0) continue;
      for (const p of active) {
        if (!playersInRound.has(p.id)) restCounts.set(p.id, (restCounts.get(p.id) ?? 0) + 1);
      }
    }

    const lastRoundPlayers = roundPlayerMap.get(lastRoundNumber) ?? new Set();
    const lastRoundRest = new Set(active.filter((p) => !lastRoundPlayers.has(p.id)).map((p) => p.id));

    const chooseResters = () => {
      if (restNeeded <= 0) return [];
      const ids = active.map((p) => p.id);
      let best = null;
      const tries = 600;
      for (let t = 0; t < tries; t++) {
        const shuffled = [...ids].sort(() => random() - 0.5);
        const resters = shuffled.slice(0, restNeeded);
        const restSet = new Set(resters);
        let score = 0;
        for (const rid of resters) {
          if (lastRoundRest.has(rid)) score += 10000;
          score += (restCounts.get(rid) ?? 0) * 300;
        }
        for (const prevRest of lastRoundRest) {
          if (!restSet.has(prevRest)) score -= 300;
          else score += 5000;
        }
        score += random() * 50;
        if (!best || score < best.score) best = { ids: resters, score };
      }
      return best?.ids ?? [];
    };

    const resters = chooseResters();
    const playPool = active.filter((p) => !resters.includes(p.id));

    const scorePair = (a, b) => {
      const k = pairKey(a, b);
      const repeat = pairCounts.get(k) ?? 0;
      let s = 0;
      if (lastRoundNumber > 0) {
        for (const hm of historyMatches) {
          if (hm.round_number !== lastRoundNumber) continue;
          const ta = hm.players.filter((x) => x.team === "A").map((x) => x.participant_id);
          const tb = hm.players.filter((x) => x.team === "B").map((x) => x.participant_id);
          if ((ta.includes(a) && ta.includes(b)) || (tb.includes(a) && tb.includes(b))) s += 5000;
        }
      }
      const hasPartnered = uniquePartners.get(a)?.has(b) || uniquePartners.get(b)?.has(a);
      const possibleNewA = playPool.some((p) => p.id !== a && !(uniquePartners.get(a)?.has(p.id)));
      const possibleNewB = playPool.some((p) => p.id !== b && !(uniquePartners.get(b)?.has(p.id)));
      if (hasPartnered && (possibleNewA || possibleNewB)) s += 4000;
      if (hasPartnered) s += 800 * repeat;
      return s;
    };

    let bestMatches = [];
    let bestScore = Number.POSITIVE_INFINITY;
    for (let trial = 0; trial < 700; trial++) {
      const shuffled = [...playPool.map((p) => p.id)].sort(() => random() - 0.5);
      const use = shuffled.slice(0, slots);
      const candidate = [];
      let score = 0;
      for (let c = 0; c < maxMatches; c++) {
        const group = use.slice(c * 4, c * 4 + 4);
        if (group.length < 4) break;
        const patterns = [
          [[group[0], group[1]], [group[2], group[3]]],
          [[group[0], group[2]], [group[1], group[3]]],
          [[group[0], group[3]], [group[1], group[2]]]
        ];
        let bestLocal = patterns[0];
        let bestLocalScore = Number.POSITIVE_INFINITY;
        for (const ptn of patterns) {
          const ps = scorePair(ptn[0][0], ptn[0][1]) + scorePair(ptn[1][0], ptn[1][1]);
          if (ps < bestLocalScore) {
            bestLocalScore = ps;
            bestLocal = ptn;
          }
        }
        score += bestLocalScore;
        candidate.push({ teamA: bestLocal[0], teamB: bestLocal[1], court: c + 1 });
      }
      score += random() * 50;
      if (score < bestScore) {
        bestScore = score;
        bestMatches = candidate;
      }
    }

  return { matches: bestMatches, resters };
}
module.exports = { legacyFriendlyRound };
