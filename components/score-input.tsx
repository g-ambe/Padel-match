"use client";

import { useEffect, useId, useRef, useState } from "react";
import { scoreInputError, type ScoreInputKind, type ScorePair } from "@/lib/score-input";

type Props = {
  value: ScorePair;
  onChange: (scores: ScorePair) => void;
  labels?: readonly [string, string];
  title?: string;
  disabled?: boolean;
  kind?: ScoreInputKind;
};

const numbers = Array.from({ length: 13 }, (_, score) => score);
const buttonClass = "min-h-12 rounded-xl border border-zinc-600 bg-zinc-800 px-2 py-2 font-bold disabled:opacity-40";

export function ScoreInput({ value, onChange, labels = ["チームA", "チームB"], title = "スコア入力", disabled = false, kind = "non-negative-integer" }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ScorePair>(value);
  const [activeTeam, setActiveTeam] = useState<"a" | "b">("a");
  const [keyboard, setKeyboard] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const teamRefs = useRef<Partial<Record<"a" | "b", HTMLButtonElement | null>>>({});
  const inputRefs = useRef<Partial<Record<"a" | "b", HTMLInputElement | null>>>({});
  const openingTeam = useRef<"a" | "b">("a");
  const id = useId();
  const error = scoreInputError(draft, kind);

  const begin = (team: "a" | "b") => {
    if (disabled) return;
    setDraft({ ...value });
    openingTeam.current = team;
    setActiveTeam(team);
    setKeyboard(false);
    setOpen(true);
  };

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body, root = document.documentElement;
    const x = window.scrollX, y = window.scrollY;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow, rootOverflow: root.style.overflow };
    Object.assign(body.style, { position: "fixed", top: `${-y}px`, left: `${-x}px`, width: "100%", overflow: "hidden" });
    root.style.overflow = "hidden";
    dialog.showModal();
    teamRefs.current[openingTeam.current]?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      Object.assign(body.style, { position: previous.position, top: previous.top, left: previous.left, width: previous.width, overflow: previous.overflow });
      root.style.overflow = previous.rootOverflow;
      const behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(x, y);
      root.style.scrollBehavior = behavior;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    // 開閉時だけフォーカス・スクロールを復元する。チーム切替では再実行しない。
  }, [open]);

  useEffect(() => {
    if (open && keyboard) inputRefs.current[activeTeam]?.focus();
  }, [open, keyboard, activeTeam]);

  return <div className="min-w-0 flex-1">
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      {(["a", "b"] as const).map((team, index) => <div key={team} className="contents">
        {index === 1 && <span aria-hidden="true">−</span>}
        <button type="button" className={`${buttonClass} min-w-0 w-full`} disabled={disabled} aria-label={`${labels[index]}の得点を入力：${value[team] || "未入力"}`} aria-haspopup="dialog" aria-controls={`${id}-dialog`} onClick={() => begin(team)}>
          <span className="block text-[10px] font-normal text-zinc-400">{labels[index]}</span>
          <span className="block text-xl">{value[team] || "—"}</span>
        </button>
      </div>)}
    </div>
    {open && <dialog ref={dialogRef} id={`${id}-dialog`} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`}
      className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-sm overflow-hidden rounded-2xl border border-zinc-700 bg-card p-0 text-zinc-100 shadow-xl backdrop:bg-black/70"
      onTouchStart={event => event.stopPropagation()} onTouchMove={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); setOpen(false); }}
      onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="flex max-h-[calc(100dvh_-_2rem)] flex-col">
        <div className="shrink-0 space-y-3 border-b border-zinc-700 p-4">
          <div className="flex items-center justify-between gap-2"><h2 id={`${id}-title`} className="text-lg font-bold">{title}</h2><button type="button" className="min-h-11 min-w-11 rounded-xl border border-zinc-600" aria-label="スコア入力を閉じる" onClick={() => setOpen(false)}>×</button></div>
          <div className="grid grid-cols-2 gap-3">
            {(["a", "b"] as const).map((team, index) => <button key={team} ref={element => { teamRefs.current[team] = element; }} type="button" aria-pressed={activeTeam === team}
              className={`min-h-16 min-w-0 rounded-xl border-2 px-2 py-2 ${activeTeam === team ? "border-accent bg-zinc-800" : "border-zinc-700"}`} onClick={() => setActiveTeam(team)}>
              <span className="block text-xs">{labels[index]}</span><span className="block break-all text-3xl font-black">{draft[team] || "—"}</span>
            </button>)}
          </div>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4">
          <button type="button" className="min-h-11 w-full rounded-xl border border-zinc-600 text-sm" onClick={() => setKeyboard(previous => !previous)}>{keyboard ? "数字ボタンで選ぶ" : "キーボードで入力"}</button>
          {keyboard ? <div className="grid grid-cols-2 gap-3">
            {(["a", "b"] as const).map((team, index) => <label key={team} className="min-w-0 space-y-2 text-xs">{labels[index]}得点
              <input ref={element => { inputRefs.current[team] = element; }} type="text" inputMode={kind === "non-negative-integer" ? "numeric" : "decimal"} autoComplete="off" aria-invalid={!!error}
                className="min-h-12 w-full rounded-xl border border-zinc-600 bg-zinc-800 px-3 text-base" value={draft[team]} onFocus={() => setActiveTeam(team)} onChange={event => setDraft(previous => ({ ...previous, [team]: event.target.value }))} />
            </label>)}
          </div> : <div className="grid grid-cols-5 gap-2" role="group" aria-label={`${labels[activeTeam === "a" ? 0 : 1]}の得点を選択`}>
            {numbers.map(score => <button key={score} type="button" className={`${buttonClass} text-lg ${draft[activeTeam] === String(score) ? "border-accent text-accent" : ""}`} aria-pressed={draft[activeTeam] === String(score)} onClick={() => setDraft(previous => ({ ...previous, [activeTeam]: String(score) }))}>{score}</button>)}
            <button type="button" className={`${buttonClass} col-span-2 text-xs`} onClick={() => setDraft(previous => ({ ...previous, [activeTeam]: "" }))}>未入力に戻す</button>
          </div>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </div>
        <div className="shrink-0 space-y-3 border-t border-zinc-700 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p id={`${id}-hint`} className="text-xs text-zinc-400">決定後、画面の保存ボタンで保存してください。</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className={buttonClass} onClick={() => setOpen(false)}>キャンセル</button>
            <button type="button" className="min-h-12 rounded-xl bg-accent px-3 py-2 font-bold text-black disabled:opacity-40" disabled={!!error || disabled} onClick={() => { if (!error && !disabled) { onChange({ ...draft }); setOpen(false); } }}>決定</button>
          </div>
        </div>
      </div>
    </dialog>}
  </div>;
}
