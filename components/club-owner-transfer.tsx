"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { AppDialog } from "@/components/app-dialog";
import { getSupabaseClient } from "@/lib/supabase";
import { readMyMemberships } from "@/lib/group-read";
import { canAcceptOwnerTransfer, decideOwnerTransfer, ownerTransferLabel, readMyOwnerTransfers, readOwnerCandidates, requestOwnerTransfer,
  type OwnerCandidate, type OwnerMembership, type OwnerTransfer } from "@/lib/club-owner-transfer";

export type OwnerState = "owner" | "other" | "unknown";
export function ClubOwnerTransfer({ clubId, requestId, visible = true, linksOnly = false, onOwnerState, onGroupRefresh }: {
  clubId?: string; requestId?: string; visible?: boolean; linksOnly?: boolean; onOwnerState?: (state: OwnerState) => void; onGroupRefresh?: () => Promise<void>;
}) {
  const fieldId = useId(), inFlight = useRef(false), mounted = useRef(true), generation = useRef(0);
  const [rows, setRows] = useState<OwnerTransfer[]>([]), [memberships, setMemberships] = useState<OwnerMembership[]>([]);
  const [candidates, setCandidates] = useState<OwnerCandidate[] | null>(null), [owners, setOwners] = useState<Record<string, boolean>>({});
  const [verified, setVerified] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [open, setOpen] = useState(false), [activeId, setActiveId] = useState<string | null>(requestId ?? null);
  const [selected, setSelected] = useState(""), [selectedLabel, setSelectedLabel] = useState("");
  const [decision, setDecision] = useState<"accepted" | "declined" | "cancelled" | null>(null), [confirmed, setConfirmed] = useState(false);
  const [success, setSuccess] = useState("");
  const refresh = async (focusId = activeId) => {
    const s = getSupabaseClient(); if (!s) { setError("接続を確認できません。再読み込みしてください"); setVerified(false); return; }
    const version = generation.current;
    setBusy(true); setError(""); setVerified(false);
    try {
      const [requests, own] = await Promise.all([readMyOwnerTransfers(s), readMyMemberships(s)]);
      const focus = requests.find(r => r.id === focusId);
      const probeClub = clubId ?? (focus?.is_sender ? focus.club_id : undefined);
      const options = probeClub ? await readOwnerCandidates(s, probeClub) : null;
      if (!mounted.current || generation.current !== version) return;
      setRows(requests); setMemberships(own); setConfirmed(false); setVerified(true);
      if (probeClub) setOwners(previous => ({ ...previous, [probeClub]: options !== null }));
      if (clubId) { setCandidates(options); onOwnerState?.(options === null ? "other" : "owner"); }
    } catch (e) {
      if (mounted.current && generation.current === version) {
        setError(e instanceof Error ? e.message : "最新の申請を確認できません。選択は保持しています"); onOwnerState?.("unknown");
      }
    } finally { if (mounted.current && generation.current === version) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true; generation.current++; onOwnerState?.("unknown");
    if (requestId) setOpen(true);
    void refresh(requestId ?? null);
    return () => { mounted.current = false; generation.current++; };
  }, [clubId, requestId]);
  const request = rows.find(r => r.id === activeId), pending = rows.some(r => r.club_id === clubId && r.status === "pending");
  const isOwner = !!clubId && owners[clubId] === true;
  const candidateValid = candidates?.some(c => c.member_id === selected) === true;
  const canSend = verified && isOwner && candidateValid && !pending && confirmed;
  const canDecide = !!request && verified && confirmed && (decision === "accepted" ? canAcceptOwnerTransfer(request, memberships)
    : decision === "declined" ? request.status === "pending" && request.is_recipient
      : decision === "cancelled" && request.status === "pending" && request.is_sender && owners[request.club_id] === true);
  const submit = async () => {
    const s = getSupabaseClient(); if (!s || busy || inFlight.current || (!activeId ? !canSend : !canDecide)) return;
    const version = generation.current;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (!activeId && clubId) {
        await requestOwnerTransfer(s, clubId, selected, candidates, rows, confirmed);
        if (!mounted.current || version !== generation.current) return;
        setSuccess("引継ぎを依頼しました。候補者が引き受けるまで所有者は変わりません。");
      } else if (request && decision) {
        const status = await decideOwnerTransfer(s, request, decision, memberships, owners[request.club_id] === true, confirmed);
        if (!mounted.current || version !== generation.current) return;
        setRows(previous => previous.map(r => r.id === request.id ? { ...r, status } : r));
        setSuccess(status === "accepted" ? "引継ぎが完了しました。旧オーナーの役職・在籍はそのままです。" : status === "declined" ? "引継ぎを辞退しました。所有者は変わりません。" : "引継ぎ申請を取り消しました。");
      }
      await refresh();
      if (mounted.current && version === generation.current) await onGroupRefresh?.();
    } catch (e) {
      if (mounted.current && version === generation.current) {
        setError(e instanceof Error ? e.message : "処理結果を確認できません。再送せず再読み込みしてください"); setVerified(false);
      }
    } finally { inFlight.current = false; if (mounted.current && version === generation.current) setBusy(false); }
  };
  const openDetail = (r: OwnerTransfer) => {
    setActiveId(r.id); setDecision(null); setConfirmed(false); setSuccess(""); setError(""); setOpen(true); void refresh(r.id);
  };
  const close = () => { if (!busy) { setOpen(false); setSuccess(""); setDecision(null); setConfirmed(false); } };
  const shown = rows.filter(r => (!clubId || r.club_id === clubId) && (!requestId || r.id === requestId));
  if (!visible) return null;
  if (linksOnly) return <section aria-label="オーナー引継ぎ" className="space-y-2 text-sm">
    {shown.map(r => <Link key={r.id} href={`/groups/owner-transfers/${r.id}`} className="block min-h-11 break-words rounded-xl bg-zinc-800 p-3">{r.club_name} / {ownerTransferLabel[r.status]}<span className="block text-xs text-zinc-400">オーナー引継ぎを確認する</span></Link>)}
    {verified && !shown.length && <p className="text-xs text-zinc-400">引継ぎ申請はありません</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <button type="button" disabled={busy} className="min-h-11 text-xs underline" onClick={() => void refresh()}>引継ぎ状況を再読み込み</button>
  </section>;
  return <section aria-label="オーナー引継ぎ" className="space-y-3 text-sm">
    {clubId && isOwner && <button type="button" disabled={busy || !verified || pending} className="min-h-11 w-full rounded-xl border border-zinc-500 p-3 disabled:opacity-50"
      onClick={() => { setActiveId(null); setDecision(null); setConfirmed(false); setSuccess(""); setOpen(true); }}>オーナーを引き継ぐ</button>}
    {shown.map(r => <button key={r.id} type="button" disabled={busy} className="min-h-11 w-full rounded-xl bg-zinc-800 p-3 text-left" onClick={() => openDetail(r)}>
      <span className="block break-words font-semibold">{r.club_name}：{ownerTransferLabel[r.status]}</span><span className="block break-words text-xs text-zinc-400">{r.is_recipient ? "あなた宛の依頼" : `引継ぎ先：${r.target_display_name}`} / 内容を確認</span></button>)}
    {!clubId && shown.length === 0 && verified && <p className="text-xs text-zinc-400">{requestId ? "本人の確認可能な申請がありません。再読み込みして確認してください。" : "引継ぎ申請はありません"}</p>}
    {!open && error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <button type="button" disabled={busy} className="min-h-11 text-xs underline disabled:opacity-50" onClick={async () => { await refresh(); await onGroupRefresh?.(); }}>引継ぎ状況を再読み込み</button>
    <AppDialog open={open} title="オーナー引継ぎを確認" busy={busy} onClose={close}>
      <div className="space-y-4 overflow-y-auto p-4">
        {success ? <p role="status" className="break-words text-sm">{success}</p> : activeId ? request ? <>
          <p className="break-words font-semibold">{request.club_name}</p><p>{ownerTransferLabel[request.status]}</p>
          <p className="break-words">引継ぎ先：{request.target_display_name}</p>
          <p className="text-xs text-zinc-400">本人が引き受けるまで所有者は変わりません。引継ぎ後も旧オーナーは在籍と役職を維持し、退会は別の本人操作です。</p>
          {request.status === "pending" && <>
            {request.is_recipient && <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy || !verified || !canAcceptOwnerTransfer(request, memberships)} className="min-h-11 rounded-xl border border-zinc-500 p-3 disabled:opacity-50" onClick={() => { setDecision("accepted"); setConfirmed(false); }}>引き受ける</button>
              <button type="button" disabled={busy || !verified} className="min-h-11 rounded-xl border border-zinc-500 p-3 disabled:opacity-50" onClick={() => { setDecision("declined"); setConfirmed(false); }}>辞退する</button>
            </div>}
            {request.is_recipient && !canAcceptOwnerTransfer(request, memberships) && <p className="text-xs text-zinc-400">在籍・メイン管理者の条件を満たしていないため引き受けられません。辞退はできます。</p>}
            {request.is_sender && <button type="button" disabled={busy || !verified || owners[request.club_id] !== true} className="min-h-11 w-full rounded-xl border border-zinc-500 p-3 disabled:opacity-50" onClick={() => { setDecision("cancelled"); setConfirmed(false); }}>申請を取り消す</button>}
          </>}
          {decision && request.status === "pending" && <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>{decision === "accepted" ? "このグループのオーナーを引き受けます" : decision === "declined" ? "この引継ぎ依頼を辞退します" : "この引継ぎ申請を取り消します"}</span></label>}
        </> : <p>本人の確認可能な申請がありません。再読み込みしてください。</p> : <>
          <p className="text-sm">この人に引継ぎを依頼します。引き受けられるまでは所有者は変わりません。</p>
          <label htmlFor={fieldId} className="block text-sm">引継ぎ先</label>
          <select id={fieldId} disabled={busy} className="min-h-11 w-full min-w-0 rounded-xl bg-zinc-800 p-3 text-sm" value={selected} onChange={e => { setSelected(e.target.value); setSelectedLabel(candidates?.find(c => c.member_id === e.target.value)?.display_name ?? ""); setConfirmed(false); }}>
            <option value="">選択してください</option>
            {selected && !candidateValid && <option value={selected} disabled>{selectedLabel}（現在は選べません）</option>}
            {candidates?.map(c => <option key={c.member_id} value={c.member_id}>{c.display_name}</option>)}
          </select>
          {!candidates?.length && <p className="text-xs text-zinc-400">候補者には、メイン管理者への昇格と本人アカウント連携が必要です。自動では変更しません。</p>}
          {selected && !candidateValid && <p className="text-sm text-red-400">選択した候補は現在引き継げません。候補を選び直してください。</p>}
          {pending && <p>返答待ちの申請があります。新しい申請は送信できません。</p>}
          <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>選択した本人へオーナー引継ぎを依頼します</span></label>
        </>}
        {error && <p role="alert" className="break-words text-sm text-red-400">{error}</p>}
        <button type="button" disabled={busy} className="min-h-11 text-sm underline" onClick={() => void refresh()}>再読み込み</button>
        {!success && <p className="text-xs text-zinc-400">再読み込み後は内容を確認し直してください。自動で再送しません。</p>}
        {!success && ((!activeId) || decision) && <button type="button" disabled={busy || (!activeId ? !canSend : !canDecide)} className="min-h-11 w-full rounded-xl bg-accent p-3 font-semibold text-black disabled:opacity-50" onClick={() => void submit()}>{busy ? "処理中…" : !activeId ? "引継ぎを依頼する" : decision === "accepted" ? "引受を確定する" : decision === "declined" ? "辞退を確定する" : "取消を確定する"}</button>}
        <button type="button" disabled={busy} className="min-h-11 w-full rounded-xl border border-zinc-500 p-3" onClick={close}>閉じる</button>
        {request && <Link className="block min-h-11 py-3 text-center text-sm underline" href={`/groups/${request.club_id}`}>グループを確認する</Link>}
      </div>
    </AppDialog>
  </section>;
}
