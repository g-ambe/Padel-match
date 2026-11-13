"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import { AppDialog } from "./app-dialog";
import { MatchShareButtons } from "./match-share-buttons";
import type { MatchShareEntry, MatchShareEvent } from "@/lib/match-share-text";

export function EventResultShare({ event, name, canManage, canCopy, onStart, onStop, onCopyUrl, onReissue, getMatches, feedback }: { event: MatchShareEvent; name: string; canManage: boolean; canCopy: boolean; onStart: () => Promise<unknown>; onStop: () => Promise<unknown>; onCopyUrl: () => Promise<unknown>; onReissue?: () => Promise<unknown>; getMatches: () => MatchShareEntry[]; feedback?: ReactNode }) {
  const statusId = useId();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), shared = event.share_enabled === true && !!event.share_token;
  const act = async (action: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); } catch { setError("操作に失敗しました。もう一度お試しください。"); } finally { lock.current = false; setBusy(false); }
  };
  return <>
    <button type="button" aria-label="結果を共有" aria-describedby={statusId} className="flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border border-zinc-700 bg-card p-3 text-left text-sm" onClick={() => setOpen(true)}><strong>結果を共有</strong><span id={statusId} className="text-xs text-accent">{shared ? "共有中" : "未共有"} ›</span></button>
    <AppDialog open={open} title="結果を共有" busy={busy} onClose={() => setOpen(false)}><div className="space-y-3 overflow-y-auto p-3">
      <p className="text-xs text-zinc-400">{shared ? "共有中" : "未共有"}</p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}{feedback}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={!canManage || busy} className="min-h-11 rounded-xl bg-accent px-2 text-sm font-bold text-black disabled:opacity-40" onClick={() => { if (!shared || window.confirm("共有を停止しますか？ このURLから結果を閲覧できなくなります。")) void act(shared ? onStop : onStart); }}>{shared ? "共有を停止" : "共有を開始"}</button>
        <button type="button" disabled={!shared || !canCopy || busy} className="min-h-11 rounded-xl border border-zinc-500 px-2 text-sm disabled:opacity-40" onClick={() => void act(onCopyUrl)}>URLコピー</button>
      </div>
      <fieldset disabled={busy}><MatchShareButtons event={event} eventName={name} kind="events" canShare={canCopy} getMatches={getMatches} allowUnsharedText compact /></fieldset>
      {onReissue && canManage && shared && <button type="button" disabled={busy} className="min-h-11 text-xs text-zinc-400 underline" onClick={() => { if (window.confirm("共有URLを再発行しますか？ 以前のURLは無効になります。")) void act(onReissue); }}>共有URLを再発行</button>}
    </div></AppDialog>
  </>;
}
