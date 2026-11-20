"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { AppDialog } from "@/components/app-dialog";
import { getSupabaseClient } from "@/lib/supabase";
import type { DirectoryMember } from "@/lib/group-read";
import { PublicClubJoinError, previewPublicJoin, submitNamedPublicJoin, type BoundClaimPreview, type NamedJoinContext } from "@/lib/public-club-join";

export function PublicClubJoinDialog({ context, candidates, onClose, onSubmitted }: {
  context: NamedJoinContext; candidates: DirectoryMember[]; onClose: () => void; onSubmitted: (id: string) => void;
}) {
  const inputId = useId(), inFlight = useRef(false), mounted = useRef(true);
  const [reference, setReference] = useState("");
  const [name, setName] = useState(""), [message, setMessage] = useState("");
  const [publicConfirmation, setPublicConfirmation] = useState(false), [inheritanceConsent, setInheritanceConsent] = useState(false);
  const [preview, setPreview] = useState<BoundClaimPreview | null>(null), [revision, setRevision] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selected = candidates.find(candidate => candidate.reference === reference && candidate.is_unlinked);
  useEffect(() => {
    let active = true;
    setPreview(null); setInheritanceConsent(false); setPublicConfirmation(false); setError("");
    if (!reference) { setPreviewLoading(false); return; }
    setPreviewLoading(true);
    const db = getSupabaseClient();
    if (!db || !selected) { setError("仮登録選手を確認できません。入力は保持されています"); setPreviewLoading(false); return; }
    void previewPublicJoin(db, context.clubId, reference)
      .then(value => { if (active) setPreview(value); })
      .catch(cause => { if (active) setError(cause instanceof PublicClubJoinError ? cause.message : "通信に失敗しました。入力は保持されています"); })
      .finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [context.clubId, reference, revision, selected]);
  const currentPreview = preview?.clubId === context.clubId && preview.reference === reference ? preview.value : null;
  const needsPreview = !!reference;
  const disabled = busy || previewLoading || !name.trim() || !publicConfirmation || !context.userId
    || context.isMember || context.hasPendingRequest || context.visibility !== "public"
    || (needsPreview && (!selected || !currentPreview?.has_target || !inheritanceConsent));
  const submit = async () => {
    if (disabled || inFlight.current) return;
    const db = getSupabaseClient();
    if (!db) { setError("接続情報を確認できません。入力は保持されています"); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      const request = await submitNamedPublicJoin(db, context, candidates, { reference: reference || null, name, message, publicConfirmation, inheritanceConsent, preview });
      if (mounted.current) onSubmitted(request);
    } catch (cause) { if (mounted.current) setError(cause instanceof PublicClubJoinError ? cause.message : "通信に失敗しました。入力は保持されています。再送する前に申請状況を確認してください"); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <AppDialog open title="加入申請を確認" busy={busy} onClose={onClose}>
    <form className="space-y-4 overflow-y-auto p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div><label htmlFor={`${inputId}-member`} className="mb-2 block text-sm">加入時に引き継ぐ仮登録選手</label>
        <select id={`${inputId}-member`} disabled={busy} value={reference} className="min-h-11 w-full rounded-xl bg-zinc-800 p-3" onChange={event => {
          const next = event.target.value;
          setReference(next); setName(candidates.find(candidate => candidate.reference === next && candidate.is_unlinked)?.display_name ?? "");
          setPreview(null); setInheritanceConsent(false); setPublicConfirmation(false); setError("");
        }}><option value="">選択しない（正規プロフィールで加入）</option>
          {candidates.filter(candidate => candidate.is_unlinked).map(candidate => <option key={candidate.reference} value={candidate.reference}>{candidate.display_name}</option>)}
        </select></div>
      {previewLoading && <p role="status" className="text-xs text-zinc-400">引き継ぐ内容を確認中…</p>}
      {needsPreview && currentPreview && <div className="space-y-2 text-sm">
        <p className="break-words">仮登録選手：{selected?.display_name}</p>
        <p>引き継ぐ所属 {currentPreview.membership_count}件・参加 {currentPreview.participant_count}件・通常試合 {currentPreview.match_count}件・チーム戦 {currentPreview.team_match_count}件・公式戦 {currentPreview.official_match_count}件</p>
        <p>本人プロフィール：{currentPreview.target_display_name ?? "未作成"}</p>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={inheritanceConsent} disabled={busy} onChange={event => setInheritanceConsent(event.target.checked)} />
          <span>この仮登録選手が自分であり、管理者の承認後に表示された所属・戦績を引き継ぐことに同意します</span></label>
      </div>}
      <div><label htmlFor={`${inputId}-name`} className="mb-2 block text-sm">グループ内表示名</label>
        <input id={`${inputId}-name`} value={name} disabled={busy} autoComplete="off" className="min-h-11 w-full rounded-xl bg-zinc-800 p-3" onChange={event => setName(event.target.value)} />
        <p className="mt-1 text-xs text-zinc-400">120文字以内。このグループだけで使う名前です。本人プロフィール名は変更しません。</p></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={publicConfirmation} disabled={busy} onChange={event => setPublicConfirmation(event.target.checked)} />
        <span>承認後この表示名がメンバー一覧に表示されます</span></label>
      <div><label htmlFor={`${inputId}-message`} className="mb-2 block text-sm">メッセージ（任意）</label>
        <textarea id={`${inputId}-message`} value={message} disabled={busy} className="w-full rounded-xl bg-zinc-800 p-3" onChange={event => setMessage(event.target.value)} /></div>
      <p className="text-xs text-zinc-400">正規プロフィールが未作成の場合は、<Link href="/profile" className="underline">プロフィール画面</Link>で作成してください。申請は7日で期限切れになります。承認されるまでは希望の表示名を公開しません。</p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {needsPreview && (error || !currentPreview) && !previewLoading && <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-zinc-500 px-3 text-sm" onClick={() => {
        setPreview(null); setInheritanceConsent(false); setPublicConfirmation(false); setRevision(value => value + 1);
      }}>引き継ぐ内容を再確認</button>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-zinc-500 p-3" onClick={onClose}>キャンセル</button>
        <button type="submit" disabled={disabled} className="min-h-11 rounded-xl bg-accent p-3 font-semibold text-black disabled:opacity-50">{busy ? "送信中…" : "申請する"}</button>
      </div>
    </form>
  </AppDialog>;
}
