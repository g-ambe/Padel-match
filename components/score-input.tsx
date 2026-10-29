"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AppDialog } from "@/components/app-dialog";
import { GuestName, ResultBadge } from "@/components/match-ui";
import { useScoreSaves } from "@/components/score-save-provider";
import { scoreInputError, type ScoreInputKind, type ScorePair } from "@/lib/score-input";

type Props = {
  value: ScorePair;
  onChange?: (scores: ScorePair) => void;
  onCommit?: (scores: ScorePair) => Promise<void>;
  saved?: boolean;
  result?: "A" | "B" | "draw" | null;
  saveKey: string;
  names?: readonly [readonly { name: string; guest?: boolean }[], readonly { name: string; guest?: boolean }[]];
  labels?: readonly [string, string]; title?: string; disabled?: boolean; kind?: ScoreInputKind;
};
const numbers = Array.from({ length: 13 }, (_, score) => score);
const buttonClass = "min-h-12 rounded-xl border border-zinc-600 bg-zinc-800 px-2 py-1 font-bold disabled:opacity-40";
export function ScoreInput({ value, onChange, onCommit, saved = false, result, saveKey, names, labels = ["チームA", "チームB"], title = "スコア入力", disabled = false, kind = "non-negative-integer" }: Props) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<ScorePair>(value), [activeTeam, setActiveTeam] = useState<"a" | "b">("a"), [keyboard, setKeyboard] = useState(false);
  const [chosen, setChosen] = useState({ a: false, b: false });
  const { queue, snapshot } = useScoreSaves(), job = snapshot[saveKey], saving = job?.status === "saving";
  const inputRefs = useRef<Partial<Record<"a" | "b", HTMLInputElement | null>>>({}), statusId = useId();
  const teamLabel = (index: 0 | 1) => names?.[index].map(player => player.name.trim() || "選手名未設定").join(" / ") || labels[index];
  const teamNames = (index: 0 | 1) => names?.[index].length ? <span className="flex min-w-0 flex-col items-stretch gap-1">{names[index].map((player, i) => <GuestName key={i} name={player.name.trim() || "選手名未設定"} guest={player.guest} compact />)}</span> : labels[index];
  const error = scoreInputError(draft, kind), complete = draft.a.trim() !== "" && draft.b.trim() !== "";
  const close = () => setOpen(false);
  const commit = (scores: ScorePair) => {
    if (queue.getSnapshot()[saveKey]?.status === "saving" || disabled || scoreInputError(scores, kind) || (onCommit && (!scores.a.trim() || !scores.b.trim()))) return;
    if (saved && !job && Number(scores.a) === Number(value.a) && Number(scores.b) === Number(value.b)) { close(); return; }
    if (onCommit) { if (!queue.submit(saveKey, scores, onCommit)) return; }
    else onChange?.(scores);
    setOpen(false);
  };
  const begin = (team: "a" | "b") => {
    if (disabled || saving) return;
    setDraft({ ...(job?.scores ?? value) }); setChosen({ a: false, b: false }); setActiveTeam(team); setKeyboard(false); setOpen(true);
  };
  const choose = (score: string) => {
    if (queue.getSnapshot()[saveKey]?.status === "saving") return;
    const next = { ...draft, [activeTeam]: score }, selected = { ...chosen, [activeTeam]: true };
    setDraft(next); setChosen(selected);
    if (onCommit && !saved && selected.a && selected.b && next.a.trim() && next.b.trim()) commit(next);
    else if (!saved) setActiveTeam(activeTeam === "a" ? "b" : "a");
  };
  useEffect(() => { if (disabled || saving) setOpen(false); }, [disabled, saving]);
  useEffect(() => { if (open && keyboard) inputRefs.current[activeTeam]?.focus(); }, [open, keyboard, activeTeam]);
  return <div data-score-key={saveKey} className="min-w-0 flex-1" aria-busy={saving}>
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      {(["a", "b"] as const).map((team, index) => <div key={team} className="contents">{index === 1 && <span aria-hidden="true">:</span>}
        <button type="button" className={`${buttonClass} min-w-0 w-full ${result === (team === "a" ? "A" : "B") ? "score-winner" : ""}`} disabled={disabled || saving} aria-label={`${teamLabel(index as 0 | 1)}の得点を入力：${value[team] || "未入力"}`} aria-describedby={job ? statusId : undefined} aria-haspopup="dialog" onClick={() => begin(team)}>
          <span className="block min-w-0 text-xs font-normal text-zinc-300">{teamNames(index as 0 | 1)}</span><span className="flex flex-wrap items-center justify-center gap-1"><span className="text-2xl">{value[team] || "—"}</span><ResultBadge result={result} team={team === "a" ? "A" : "B"} /></span>
        </button>
      </div>)}
    </div>
    {job && <div id={statusId} className="mt-2 space-y-2 text-xs" role={saving ? "status" : "alert"}>
      <p className={saving ? "text-zinc-300" : "text-red-400"}>{saving ? "保存中…" : job.error}</p>
      <p className="text-zinc-400">未確定の入力：{job.scores.a} : {job.scores.b}</p>
      {!saving && <button type="button" className={`${buttonClass} w-full text-sm`} disabled={disabled} onClick={() => { if (onCommit) queue.submit(saveKey, job.scores, onCommit); else queue.retry(saveKey); }}>再試行</button>}
    </div>}
    <AppDialog open={open} title={title} busy={saving} onClose={close}>
      <div className="grid shrink-0 grid-cols-2 gap-3 border-b border-zinc-700 p-4">
        {(["a", "b"] as const).map((team, index) => <button key={team} type="button" disabled={saving} aria-pressed={activeTeam === team} className={`min-h-16 min-w-0 break-all rounded-xl border-2 p-2 ${activeTeam === team ? "border-accent bg-zinc-800" : "border-zinc-700"}`} onClick={() => setActiveTeam(team)}><span className="block text-xs">{teamNames(index as 0 | 1)}</span><span className="block break-all text-3xl font-black">{draft[team] || "—"}</span></button>)}
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4">
        <button type="button" disabled={saving} className="min-h-11 w-full rounded-xl border border-zinc-600 text-sm" onClick={() => setKeyboard(previous => !previous)}>{keyboard ? "数字ボタンで選ぶ" : "キーボードで入力"}</button>
        {keyboard ? <div className="grid grid-cols-2 gap-3">{(["a", "b"] as const).map((team, index) => <label key={team} className="min-w-0 break-all space-y-2 text-xs">{teamLabel(index as 0 | 1)}得点<input ref={el => { inputRefs.current[team] = el; }} type="text" inputMode={kind === "number" ? "decimal" : "numeric"} autoComplete="off" disabled={saving} aria-invalid={!!error} className="min-h-12 w-full rounded-xl border border-zinc-600 bg-zinc-800 px-3 text-base" value={draft[team]} onFocus={() => setActiveTeam(team)} onChange={e => setDraft(previous => ({ ...previous, [team]: e.target.value }))} /></label>)}</div>
          : <div className="grid grid-cols-5 gap-2" role="group" aria-label={`${teamLabel(activeTeam === "a" ? 0 : 1)}の得点を選択`}>{numbers.map(score => <button key={score} type="button" disabled={saving} className={`${buttonClass} text-lg ${draft[activeTeam] === String(score) ? "border-accent text-accent" : ""}`} aria-pressed={draft[activeTeam] === String(score)} onClick={() => choose(String(score))}>{score}</button>)}<button type="button" disabled={saving} className={`${buttonClass} col-span-2 text-xs`} onClick={() => { setDraft(previous => ({ ...previous, [activeTeam]: "" })); setChosen(previous => ({ ...previous, [activeTeam]: false })); }}>未入力に戻す</button></div>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </div>
      <div className="shrink-0 space-y-3 border-t border-zinc-700 p-4">
        <p role="status" className="text-xs text-zinc-400">{saving ? "保存中…" : !onCommit ? "決定で入力欄へ反映します" : saved || keyboard ? "完了すると保存します" : "両チームの得点を選ぶと自動保存します"}</p>
        <div className="flex gap-3"><button type="button" disabled={saving} className={`${buttonClass} flex-1`} onClick={close}>キャンセル</button>{(saved || keyboard || !onCommit) && <button type="button" className="min-h-12 flex-1 rounded-xl bg-accent px-3 py-2 font-bold text-black disabled:opacity-40" disabled={saving || !!error || (!!onCommit && !complete)} onClick={() => commit(draft)}>{onCommit ? "完了" : "決定"}</button>}</div>
      </div>
    </AppDialog>
  </div>;
}
