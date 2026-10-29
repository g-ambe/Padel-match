"use client";

import { useEffect, useRef, useState } from "react";
import { AppDialog } from "@/components/app-dialog";
import { ResultBadge } from "@/components/match-ui";
import { scoreInputError, type ScoreInputKind, type ScorePair } from "@/lib/score-input";

type Props = {
  value: ScorePair;
  onChange?: (scores: ScorePair) => void;
  onCommit?: (scores: ScorePair) => Promise<void>;
  saved?: boolean;
  result?: "A" | "B" | "draw" | null;
  labels?: readonly [string, string]; title?: string; disabled?: boolean; kind?: ScoreInputKind;
};
const numbers = Array.from({ length: 13 }, (_, score) => score);
const buttonClass = "min-h-12 rounded-xl border border-zinc-600 bg-zinc-800 px-2 py-1 font-bold disabled:opacity-40";
export function ScoreInput({ value, onChange, onCommit, saved = false, result, labels = ["チームA", "チームB"], title = "スコア入力", disabled = false, kind = "non-negative-integer" }: Props) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<ScorePair>(value), [activeTeam, setActiveTeam] = useState<"a" | "b">("a"), [keyboard, setKeyboard] = useState(false);
  const [chosen, setChosen] = useState({ a: false, b: false }), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState("");
  const inFlight = useRef(false), inputRefs = useRef<Partial<Record<"a" | "b", HTMLInputElement | null>>>({});
  const error = scoreInputError(draft, kind), complete = draft.a.trim() !== "" && draft.b.trim() !== "";
  const close = () => { if (!inFlight.current) setOpen(false); };
  const commit = async (scores: ScorePair) => {
    if (inFlight.current || disabled || scoreInputError(scores, kind) || (onCommit && (!scores.a.trim() || !scores.b.trim()))) return;
    if (saved && Number(scores.a) === Number(value.a) && Number(scores.b) === Number(value.b)) { close(); return; }
    inFlight.current = true; setSaving(true); setSaveError("");
    try { if (onCommit) await onCommit(scores); else onChange?.(scores); setOpen(false); }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : "保存に失敗しました。再試行してください"); }
    finally { inFlight.current = false; setSaving(false); }
  };
  const begin = (team: "a" | "b") => {
    if (disabled) return;
    setDraft({ ...value }); setChosen({ a: false, b: false }); setActiveTeam(team); setKeyboard(false); setSaveError(""); setOpen(true);
  };
  const choose = (score: string) => {
    if (inFlight.current) return;
    const next = { ...draft, [activeTeam]: score }, selected = { ...chosen, [activeTeam]: true };
    setDraft(next); setChosen(selected); setSaveError("");
    if (onCommit && !saved && selected.a && selected.b && next.a.trim() && next.b.trim()) void commit(next);
    else if (!saved) setActiveTeam(activeTeam === "a" ? "b" : "a");
  };
  useEffect(() => { if (disabled && !inFlight.current) setOpen(false); }, [disabled]);
  useEffect(() => { if (open && keyboard) inputRefs.current[activeTeam]?.focus(); }, [open, keyboard, activeTeam]);
  return <div className="min-w-0 flex-1">
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      {(["a", "b"] as const).map((team, index) => <div key={team} className="contents">{index === 1 && <span aria-hidden="true">:</span>}
        <button type="button" className={`${buttonClass} min-w-0 w-full ${result === (team === "a" ? "A" : "B") ? "score-winner" : ""}`} disabled={disabled} aria-label={`${labels[index]}の得点を入力：${value[team] || "未入力"}`} aria-haspopup="dialog" onClick={() => begin(team)}>
          <span className="flex flex-wrap items-center justify-center gap-1"><span className="text-[10px] font-normal text-zinc-400">{labels[index]}</span><ResultBadge result={result} team={team === "a" ? "A" : "B"} /></span><span className="block text-2xl">{value[team] || "—"}</span>
        </button>
      </div>)}
    </div>
    <AppDialog open={open} title={title} busy={saving} onClose={close}>
      <div className="grid shrink-0 grid-cols-2 gap-3 border-b border-zinc-700 p-4">
        {(["a", "b"] as const).map((team, index) => <button key={team} type="button" disabled={saving} aria-pressed={activeTeam === team} className={`min-h-16 min-w-0 rounded-xl border-2 p-2 ${activeTeam === team ? "border-accent bg-zinc-800" : "border-zinc-700"}`} onClick={() => setActiveTeam(team)}><span className="block text-xs">{labels[index]}</span><span className="block break-all text-3xl font-black">{draft[team] || "—"}</span></button>)}
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4">
        <button type="button" disabled={saving} className="min-h-11 w-full rounded-xl border border-zinc-600 text-sm" onClick={() => setKeyboard(previous => !previous)}>{keyboard ? "数字ボタンで選ぶ" : "キーボードで入力"}</button>
        {keyboard ? <div className="grid grid-cols-2 gap-3">{(["a", "b"] as const).map((team, index) => <label key={team} className="min-w-0 space-y-2 text-xs">{labels[index]}得点<input ref={el => { inputRefs.current[team] = el; }} type="text" inputMode={kind === "number" ? "decimal" : "numeric"} autoComplete="off" disabled={saving} aria-invalid={!!error} className="min-h-12 w-full rounded-xl border border-zinc-600 bg-zinc-800 px-3 text-base" value={draft[team]} onFocus={() => setActiveTeam(team)} onChange={e => { setDraft(previous => ({ ...previous, [team]: e.target.value })); setSaveError(""); }} /></label>)}</div>
          : <div className="grid grid-cols-5 gap-2" role="group" aria-label={`${labels[activeTeam === "a" ? 0 : 1]}の得点を選択`}>{numbers.map(score => <button key={score} type="button" disabled={saving} className={`${buttonClass} text-lg ${draft[activeTeam] === String(score) ? "border-accent text-accent" : ""}`} aria-pressed={draft[activeTeam] === String(score)} onClick={() => choose(String(score))}>{score}</button>)}<button type="button" disabled={saving} className={`${buttonClass} col-span-2 text-xs`} onClick={() => { setDraft(previous => ({ ...previous, [activeTeam]: "" })); setChosen(previous => ({ ...previous, [activeTeam]: false })); }}>未入力に戻す</button></div>}
        {(error || saveError) && <p role="alert" className="text-sm text-red-400">{error || saveError}</p>}
      </div>
      <div className="shrink-0 space-y-3 border-t border-zinc-700 p-4">
        <p role="status" className="text-xs text-zinc-400">{saving ? "保存中…" : !onCommit ? "決定で入力欄へ反映します" : saved || keyboard ? "完了すると保存します" : "両チームの得点を選ぶと自動保存します"}</p>
        <div className="flex gap-3"><button type="button" disabled={saving} className={`${buttonClass} flex-1`} onClick={close}>キャンセル</button>{(saved || keyboard || saveError || !onCommit) && <button type="button" className="min-h-12 flex-1 rounded-xl bg-accent px-3 py-2 font-bold text-black disabled:opacity-40" disabled={saving || !!error || (!!onCommit && !complete)} onClick={() => void commit(draft)}>{saveError ? "再試行" : onCommit ? "完了" : "決定"}</button>}</div>
      </div>
    </AppDialog>
  </div>;
}
