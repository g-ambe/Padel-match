import type { GuestEvent } from "./guest-events";

export type RoundCard = { id: string; players: { participant_id: string; team: "A" | "B" }[]; completed: boolean; result?: unknown };
export const guestLineupSnapshot = (event: GuestEvent) => JSON.stringify(event);
export const roundCards = (event: GuestEvent, round: number): RoundCard[] => event.matches.filter(m => m.round_number === round).map(m => ({ id: m.id, players: m.players.map(p => ({ ...p })), completed: m.completed, result: m.result }));
export const sameLineups = (a: RoundCard[], b: RoundCard[]) => JSON.stringify(a.map(m => [m.id,[...m.players].sort((x,y)=>x.team.localeCompare(y.team)||x.participant_id.localeCompare(y.participant_id))]).sort()) === JSON.stringify(b.map(m => [m.id,[...m.players].sort((x,y)=>x.team.localeCompare(y.team)||x.participant_id.localeCompare(y.participant_id))]).sort());
const editable = (card: RoundCard) => !card.completed && card.result == null;

export function guestRoundEligibility(event: GuestEvent, round: number) {
  const cards = event.matches.filter(m => m.round_number === round);
  const known = cards[0]?.eligible_ids;
  if (!known || !cards.length || new Set(known).size !== known.length || cards.some(m => !m.eligible_ids || JSON.stringify([...m.eligible_ids].sort()) !== JSON.stringify([...known].sort()))) {
    return { eligible: [] as string[], blocked_reason: "生成時の参加可能者の記録がないため、このRoundはメンバー変更できません。過去の参加状態は推測しません。" };
  }
  return { eligible: event.participants.filter(p => p.status === "active" && known.includes(p.id)).map(p => p.id), blocked_reason: null };
}

export function swapRoundPlayers(cards: RoundCard[], matchId: string, outgoing: string, incoming: string): RoundCard[] {
  const source = cards.find(m => m.id === matchId && m.players.some(p => p.participant_id === outgoing));
  const destination = cards.find(m => m.players.some(p => p.participant_id === incoming));
  if (!source || !editable(source) || (destination && !editable(destination))) throw new Error("スコア入力済みのカードは変更できません。");
  if (incoming === outgoing) return cards;
  return cards.map(card => ({ ...card, players: card.players.map(p => p.participant_id === outgoing ? { ...p, participant_id: incoming } : destination && p.participant_id === incoming ? { ...p, participant_id: outgoing } : { ...p }) }));
}

export function revisedGuestRound(current: GuestEvent, expected: string, round: number, cards: RoundCard[]): GuestEvent {
  if (!current.id.startsWith("guest_") || current.event_mode !== "auto" || current.status !== "active") throw new Error("開催中のゲスト自動生成イベントのみ変更できます。");
  if (guestLineupSnapshot(current) !== expected) throw new Error("開催・スコア・参加状態が変更されています。閉じて最新のカードを確認してください。");
  const before = roundCards(current, round), ids = new Set(before.map(m => m.id));
  if (!before.length || cards.length !== before.length || new Set(cards.map(m => m.id)).size !== cards.length || cards.some(m => !ids.has(m.id))) throw new Error("Roundのカードが一致しません。");
  const eligibility = guestRoundEligibility(current, round);
  if (eligibility.blocked_reason) throw new Error(eligibility.blocked_reason);
  const active = new Set(eligibility.eligible), seen = new Set<string>();
  for (const card of cards) {
    const original = before.find(m => m.id === card.id)!;
    const changed = !sameLineups([original], [card]);
    if (changed && !editable(original)) throw new Error("スコア入力済みのカードは変更できません。");
    if (card.players.length !== 4 || ["A", "B"].some(team => card.players.filter(p => p.team === team).length !== 2)) throw new Error("各ペア2名、1試合4名を選択してください。");
    for (const p of card.players) {
      if (seen.has(p.participant_id)) throw new Error("同じRoundに同じ選手を複数出場させることはできません。");
      if (!current.participants.some(person => person.id === p.participant_id) || (changed && !active.has(p.participant_id))) throw new Error("変更するカードには参加中の選手を選択してください。");
      seen.add(p.participant_id);
    }
  }
  return { ...current, matches: current.matches.map(m => ids.has(m.id) ? { ...m, players: cards.find(c => c.id === m.id)!.players.map(p => ({ ...p })) } : m) };
}

// sessionStorageの1回の同期書込みでRound全体を保存。DBイベントには使用しない。
export function saveGuestRoundLineup(eventId: string, expected: string, round: number, cards: RoundCard[], store: { read: (id: string) => GuestEvent | null; write: (event: GuestEvent) => void }) {
  if (!eventId.startsWith("guest_")) throw new Error("ログインイベントの編集には専用の保存処理が必要です。");
  const current = store.read(eventId);
  if (!current || current.id !== eventId) throw new Error("ゲストイベントが見つかりません。");
  // 同期書込み後の確認だけが失敗した場合、再試行で二度書き込まない。
  const original = JSON.parse(expected) as GuestEvent;
  if (original.id !== eventId) throw new Error("ゲストイベントが一致しません。");
  const next = revisedGuestRound(original, expected, round, cards);
  if (guestLineupSnapshot(current) === guestLineupSnapshot(next)) return current;
  if (guestLineupSnapshot(current) !== expected) throw new Error("開催・スコア・参加状態が変更されています。閉じて最新のカードを確認してください。");
  try { store.write(next); }
  catch { throw new Error("一時保存に失敗しました。空き容量とブラウザの保存設定を確認してください。"); }
  const saved = store.read(eventId);
  if (!saved || guestLineupSnapshot(saved) !== guestLineupSnapshot(next)) throw new Error("保存結果を確認できません。画面を再読み込みしてください。");
  return saved;
}
