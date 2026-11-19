"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AppDialog } from "@/components/app-dialog";
import { ClubDisplayNameError, canEditClubDisplayName, requiresPublicNameConfirmation, type ClubNameContext, type ClubNameMember, type ClubNameResult } from "@/lib/club-display-name";

export function ClubDisplayNameDialog({ member, context, onClose, onSave, onRefresh, onSaved }: {
  member: ClubNameMember; context: ClubNameContext; onClose: () => void;
  onSave: (target: ClubNameMember, name: string, confirmation: boolean) => Promise<ClubNameResult>;
  onRefresh: () => Promise<ClubNameMember>;
  onSaved: (result: ClubNameResult) => void;
}) {
  const fieldId = useId(), inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [target, setTarget] = useState(member);
  // A NULL alias starts empty. The user must choose a name explicitly.
  const [name, setName] = useState(member.club_display_name ?? "");
  const [confirmation, setConfirmation] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [refreshed, setRefreshed] = useState(false);
  const publicConfirmation = requiresPublicNameConfirmation(target, context);
  const allowed = canEditClubDisplayName(target, context);
  const save = async () => {
    if (inFlight.current || !allowed || !name.trim() || (publicConfirmation && !confirmation)) return;
    inFlight.current = true; setBusy(true); setError("");
    try { const result = await onSave(target, name, confirmation); if (mounted.current) onSaved(result); }
    catch (cause) { if (mounted.current) setError(cause instanceof ClubDisplayNameError ? cause.message : "通信に失敗しました。入力は保持されています。最新の状態を確認してください"); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const latest = await onRefresh();
      if (!mounted.current) return;
      if (latest.id !== member.id || latest.club_id !== context.clubId) throw new Error("対象不一致");
      setTarget(latest); setConfirmation(false); setRefreshed(true);
      setError(canEditClubDisplayName(latest, context) ? "" : "所属・連携状態が変更されたため保存できません");
    } catch { if (mounted.current) setError("最新の状態を確認できませんでした。入力は保持されています"); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <AppDialog open title="グループ内表示名を編集" busy={busy} onClose={onClose}>
    <form className="space-y-4 overflow-y-auto p-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="break-words text-sm text-zinc-300">{target.linked_auth_user_id ? "本人プロフィール名" : "登録時の選手名"}：{target.profile_display_name}</p>
      <p className="text-xs text-zinc-400">このグループだけの表示名です。プロフィール名や他グループの表示名、過去の戦績は変更しません。</p>
      {refreshed && <p className="break-words text-sm">現在のグループ内表示名：{target.club_display_name ?? "未設定"}</p>}
      <div><label htmlFor={fieldId} className="mb-2 block text-sm">グループ内表示名</label>
        <input id={fieldId} value={name} disabled={busy} onChange={event => setName(event.target.value)} className="min-h-11 w-full rounded-xl bg-zinc-800 p-3" autoComplete="off" />
        <p className="mt-1 text-xs text-zinc-400">120文字以内</p></div>
      {publicConfirmation && <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.checked)} />
        <span>公開グループでは、この表示名がメンバー一覧に表示されます</span>
      </label>}
      {context.visibility === "private" && <p className="text-xs text-zinc-400">非公開グループでの保存では、公開確認済みにはなりません。</p>}
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-red-400">{error}</p>
        <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-zinc-500 px-3 text-sm" onClick={() => void refresh()}>最新の状態を確認</button></div>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-zinc-500 p-3" onClick={onClose}>キャンセル</button>
        <button type="submit" disabled={busy || !allowed || !name.trim() || (publicConfirmation && !confirmation)} className="min-h-11 rounded-xl bg-accent p-3 font-semibold text-black disabled:opacity-50">{busy ? "保存中…" : "保存"}</button>
      </div>
    </form>
  </AppDialog>;
}
