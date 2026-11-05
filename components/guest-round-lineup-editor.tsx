"use client";
import { useState } from "react";
import { AppDialog } from "./app-dialog";
import type { GuestEvent } from "@/lib/guest-events";
import { roundCards, sameLineups, swapRoundPlayers, type RoundCard } from "@/lib/guest-round-lineup";

export function GuestRoundLineupEditor({ event, round, target, busy, onClose, onSave }: { event: GuestEvent; round: number; target: string; busy: boolean; onClose: () => void; onSave: (cards: RoundCard[]) => Promise<void> }) {
  const [cards, setCards] = useState(() => roundCards(event, round));
  const [selected, setSelected] = useState<{ matchId: string; participantId: string } | null>(null);
  const [error, setError] = useState("");
  const name = (id: string) => event.participants.find(p => p.id === id)?.guest_name ?? "選手を確認してください";
  const positions = new Map(cards.flatMap(card => card.players.map(p => [p.participant_id, card] as const)));
  const save = async () => { setError(""); try { await onSave(cards); } catch (cause) { setError(cause instanceof Error ? cause.message : "保存に失敗しました。"); } };
  return <AppDialog open title={`Round ${round} のメンバー変更`} busy={busy} onClose={onClose}><div className="min-h-0 space-y-3 overflow-y-auto p-4">
    <p className="text-sm">変更する選手 → 入れ替え相手を選択し、最後に保存してください。</p>
    {cards.map(card => <section key={card.id} className={`rounded-xl border p-3 ${card.id === target ? "border-accent" : "border-zinc-600"}`}><h3 className="mb-2 text-sm font-bold">コート{event.matches.find(m => m.id === card.id)?.court_number}{card.completed || card.result != null ? "（スコア入力済み）" : ""}</h3><div className="grid grid-cols-2 gap-2">{(["A", "B"] as const).map(team => <div key={team}><p className="mb-1 text-xs">ペア{team}</p>{card.players.filter(p => p.team === team).map(p => <button key={p.participant_id} type="button" disabled={busy || card.completed || card.result != null} aria-pressed={selected?.participantId === p.participant_id} className="mb-1 min-h-11 w-full break-all rounded-xl border border-zinc-500 p-2 text-left text-sm disabled:opacity-40" onClick={() => { setSelected({ matchId: card.id, participantId: p.participant_id }); setError(""); }}>{name(p.participant_id)}</button>)}</div>)}</div></section>)}
    {selected && <section className="space-y-2"><h3 className="break-all text-sm font-bold">{name(selected.participantId)}の入れ替え相手</h3>{event.participants.filter(p => p.status === "active" && p.id !== selected.participantId).map(p => { const card = positions.get(p.id); return <button key={p.id} type="button" disabled={busy || !!card && (card.completed || card.result != null)} className="min-h-11 w-full break-all rounded-xl border border-zinc-500 p-3 text-left text-sm disabled:opacity-40" onClick={() => { try { setCards(swapRoundPlayers(cards, selected.matchId, selected.participantId, p.id)); setSelected(null); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "変更できませんでした"); } }}>{p.guest_name}<span className="ml-2 text-xs text-zinc-400">{card ? `コート${event.matches.find(m => m.id === card.id)?.court_number}` : "このRoundの休憩者"}</span></button>; })}</section>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <p className="text-xs text-zinc-400">保存前はカードを変更しません。変更した対戦は履歴に保存され、スコア・他のRoundは変更しません。</p>
  </div><div className="grid shrink-0 grid-cols-2 gap-3 border-t border-zinc-700 p-4"><button type="button" disabled={busy} className="min-h-12 rounded-xl border border-zinc-500" onClick={onClose}>キャンセル</button><button type="button" disabled={busy || sameLineups(roundCards(event, round), cards)} className="min-h-12 rounded-xl bg-accent font-bold text-black disabled:opacity-40" onClick={() => void save()}>{busy ? "保存中…" : "保存"}</button></div></AppDialog>;
}
