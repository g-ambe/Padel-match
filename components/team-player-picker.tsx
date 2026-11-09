"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppDialog } from "@/components/app-dialog";
import { GuestName } from "@/components/match-ui";

export type TeamPlayerChoice = { value: string; label: string; kind: "member" | "guest" };
type Slot = 0 | 1 | 2 | 3;
type Side = "team_a" | "team_b";
type Props = {
  teamNames: [string, string];
  choices: [TeamPlayerChoice[], TeamPlayerChoice[]];
  values: string[];
  labels: string[];
  disabled: boolean;
  onSelect: (slot: Slot, value: string) => void;
  onAddGuest: (side: Side, name: string) => Promise<unknown>;
  continuous?: boolean;
  onAdd?: () => void;
  onCancel?: () => void;
  saveDisabled?: boolean;
  saveError?: string;
  children?: ReactNode;
};

export function TeamPlayerPicker({ teamNames, choices, values, labels, disabled, onSelect, onAddGuest, continuous = false, onAdd, onCancel, saveDisabled = false, saveError, children }: Props) {
  const [slot, setSlot] = useState<Slot | null>(continuous ? 0 : null);
  const [guestDraft, setGuestDraft] = useState({ team_a: "", team_b: "" });
  const [guestOpen, setGuestOpen] = useState({ team_a: false, team_b: false });
  const [freeDraft, setFreeDraft] = useState<Record<number, string>>({});
  const [freeOpen, setFreeOpen] = useState<Record<number, boolean>>({});
  const [guestBusy, setGuestBusy] = useState(false), guestLock = useRef(false);
  const [error, setError] = useState("");
  const [recentGuest, setRecentGuest] = useState<{ side: Side; name: string } | null>(null);
  const candidateList = useRef<HTMLDivElement>(null), recentButton = useRef<HTMLButtonElement>(null);
  const team = slot !== null && slot >= 2 ? 1 : 0;
  const side: Side = team === 0 ? "team_a" : "team_b";
  const recentValue = recentGuest?.side === side ? `guest:${recentGuest.name}` : "";
  const recentAvailable = !!recentValue && choices[team].some(choice => choice.value === recentValue);
  const locked = disabled || guestBusy;
  const duplicate = (value: string) => values.some((selected, index) => index !== slot && selected === value);

  useEffect(() => { if (disabled && !continuous) setSlot(null); }, [disabled, continuous]);
  useEffect(() => {
    if (!continuous || slot === null) return;
    if (candidateList.current) candidateList.current.scrollTop = 0;
    candidateList.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [slot, continuous]);
  useEffect(() => {
    if (slot === null || !recentAvailable) return;
    if (candidateList.current) candidateList.current.scrollTop = 0;
    recentButton.current?.focus({ preventScroll: true });
  }, [slot, recentValue, recentAvailable]);

  const open = (next: Slot) => {
    if (disabled || guestLock.current) return;
    setFreeDraft(previous => previous[next] !== undefined ? previous : { ...previous, [next]: values[next].startsWith("guest:") ? values[next].slice(6) : "" });
    setError(""); setSlot(next);
  };
  const close = () => { if (!disabled && !guestLock.current) { if (continuous) onCancel?.(); else setSlot(null); } };
  const choose = (value: string) => {
    if (slot === null || disabled || guestLock.current || (value && duplicate(value))) return;
    onSelect(slot, value);
    if (!continuous) setSlot(null);
    else if (value) {
      const nextValues = values.map((previous, index) => index === slot ? value : previous);
      setSlot(nextValues.every(Boolean) ? null : slot < 3 ? (slot + 1) as Slot : nextValues.findIndex(previous => !previous) as Slot);
    }
  };
  const addGuest = async () => {
    const name = guestDraft[side].trim();
    if (!name || disabled || guestLock.current) return;
    guestLock.current = true; setGuestBusy(true); setError("");
    try {
      if (await onAddGuest(side, name) !== true) { setError("ゲストを追加できませんでした。入力を確認して再度お試しください。"); return; }
      setGuestDraft(previous => ({ ...previous, [side]: "" }));
      setGuestOpen(previous => ({ ...previous, [side]: false }));
      setRecentGuest({ side, name });
    } catch { setError("ゲストを追加できませんでした。再度お試しください。"); }
    finally { guestLock.current = false; setGuestBusy(false); }
  };
  const inputClass = "min-h-11 w-full min-w-0 rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-2 text-base";
  const options = [...choices[team]].sort((a, b) => Number(b.value === recentValue) - Number(a.value === recentValue));
  const freeName = slot === null ? "" : (freeDraft[slot] ?? "").trim();

  const selections = <div className="space-y-3">
      {([0, 1] as const).map(index => <section key={index} className={`team-player-picker team-side-${index === 0 ? "a" : "b"} min-w-0 space-y-1.5`}>
        <h4 className="team-player-heading flex min-w-0 items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="team-player-dot h-2 w-2 shrink-0 rounded-full" /><span className="min-w-0 break-words">{teamNames[index]}</span></h4>
        <div className="grid grid-cols-2 gap-2">{([0, 1] as const).map(position => {
          const key = (index * 2 + position) as Slot, value = values[key];
          return <button key={key} data-player-slot={key} data-active={continuous && slot === key} type="button" disabled={disabled || guestBusy} aria-haspopup={continuous ? undefined : "dialog"} aria-pressed={continuous ? slot === key : undefined} aria-label={`${teamNames[index]}の選手${position + 1}を選択：${value ? labels[key] : "未選択"}`} title={value ? labels[key] : undefined}
            data-selected={!!value} className="team-player-slot flex min-h-12 min-w-0 items-center rounded-xl border px-3 py-2 text-left text-sm disabled:opacity-40" onClick={() => open(key)}>
            <span className="min-w-0 flex-1">{value ? <GuestName name={labels[key]} guest={value.startsWith("guest:")} compact /> : "＋ 選手を選択"}</span>
          </button>;
        })}</div>
      </section>)}
    </div>;
  return <div className="min-w-0">
    {!continuous && selections}
    <AppDialog open={continuous || slot !== null} title={continuous ? "試合カードを追加" : teamNames[team]} busy={locked} onClose={close}>
      <div data-team-player-pop className={`team-player-picker team-side-${team === 0 ? "a" : "b"} flex min-h-0 flex-col`}>
        <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4">
          {continuous && <><p role="status" className="text-xs text-zinc-400">{values.filter(Boolean).length}/4名{slot === null ? " · 追加してください" : ""}</p>{selections}</>}
          {slot !== null && <>
          <p className="team-player-heading text-sm font-semibold">{continuous ? `${teamNames[team]} · 選手${slot % 2 + 1}を選択` : "選手を選択"}</p>
          <div ref={candidateList} data-player-candidates role="group" aria-label={`${teamNames[team]}の選手候補`} className={`grid ${continuous ? "max-h-[28dvh]" : "max-h-[40dvh]"} min-h-0 grid-cols-2 gap-2 overflow-y-auto overscroll-contain p-0.5`}>
            {options.map(choice => {
              const selected = values.includes(choice.value), blocked = duplicate(choice.value), current = slot !== null && values[slot] === choice.value;
              return <button ref={choice.value === recentValue ? recentButton : undefined} key={choice.value} type="button" disabled={locked || blocked} aria-pressed={selected}
                aria-label={`${teamNames[team]}の${choice.label}を選択`} data-selected={selected} title={blocked ? "他の枠で選択済み" : undefined}
                className="team-player-option flex min-h-12 min-w-0 flex-col items-start justify-center gap-1 rounded-xl border px-3 py-2 text-left text-sm disabled:opacity-40" onClick={() => choose(choice.value)}>
                <GuestName name={choice.label} guest={choice.kind === "guest"} />
                {selected ? <span className="text-[10px]">✓ {current ? "選択中" : "他の枠で選択済み"}</span> : choice.value === recentValue && <span className="text-[10px]">追加したゲスト</span>}
              </button>;
            })}
          </div>
          {!options.length && <p className="text-sm text-zinc-400">参加候補がありません</p>}
          <details open={guestOpen[side]} onToggle={e => { const expanded = e.currentTarget.open; setGuestOpen(previous => previous[side] === expanded ? previous : { ...previous, [side]: expanded }); }}>
            <summary className="team-player-heading flex min-h-11 cursor-pointer list-none items-center text-sm [&::-webkit-details-marker]:hidden">＋ ゲストを追加</summary>
            <div className="space-y-2"><input disabled={locked} className={inputClass} aria-label={`${teamNames[team]}のゲスト名`} placeholder="ゲスト名" value={guestDraft[side]} onChange={e => setGuestDraft(previous => ({ ...previous, [side]: e.target.value }))} />
              <button type="button" disabled={locked || !guestDraft[side].trim()} className="team-player-option min-h-11 w-full rounded-xl border px-3 text-sm disabled:opacity-40" onClick={() => void addGuest()}>{guestBusy ? "追加中…" : "候補に追加"}</button></div>
          </details>
          <details open={slot !== null && !!freeOpen[slot]} onToggle={e => { if (slot === null) return; const expanded = e.currentTarget.open; setFreeOpen(previous => previous[slot] === expanded ? previous : { ...previous, [slot]: expanded }); }}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs text-zinc-400 [&::-webkit-details-marker]:hidden">その他・既存の自由入力</summary>
            <div className="space-y-2"><input disabled={locked} className={inputClass} aria-label={`${teamNames[team]}の自由入力`} placeholder="自由入力" value={slot === null ? "" : freeDraft[slot] ?? ""} onChange={e => { if (slot !== null) setFreeDraft(previous => ({ ...previous, [slot]: e.target.value })); }} />
              {freeName && duplicate(`guest:${freeName}`) && <p role="status" className="text-xs text-amber-300">別の枠で選択済みです</p>}
              <button type="button" disabled={locked || !freeName || duplicate(`guest:${freeName}`)} className="team-player-option min-h-11 w-full rounded-xl border px-3 text-sm disabled:opacity-40" onClick={() => choose(`guest:${freeName}`)}>この名前を選択</button></div>
          </details>
          </>}
          {children}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          {saveError && <p role="alert" className="text-sm text-red-400">{saveError}</p>}
        </div>
        <div className="shrink-0 space-y-2 border-t border-zinc-700 p-3">{(!continuous || slot !== null) && <button type="button" disabled={locked || slot === null || !values[slot]} className="min-h-11 w-full rounded-xl border border-zinc-600 text-sm disabled:opacity-40" onClick={() => choose("")}>選択を解除</button>}
          {continuous && <div className="grid grid-cols-2 gap-2"><button type="button" disabled={locked || saveDisabled} className="min-h-11 rounded-xl bg-accent px-3 font-bold text-black disabled:opacity-40" onClick={onAdd}>{disabled ? "追加中…" : "追加"}</button><button type="button" disabled={locked} className="min-h-11 rounded-xl border border-zinc-600 px-3 text-sm disabled:opacity-40" onClick={close}>キャンセル</button></div>}
        </div>
      </div>
    </AppDialog>
  </div>;
}
