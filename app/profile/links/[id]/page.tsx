"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { ProfileMergeSummary } from "@/components/profile-merge-summary";
import { getSupabaseClient } from "@/lib/supabase";
import { profileErrorMessage } from "@/lib/player-profiles";
import { approveNamedPlayerProfileLink, hasRecipientLinkName, isValidProfileLinkDisplayName, linkStatusLabel, profileLinkRpc, reviewPlayerProfileLink, type ProfileLinkDetail, type ProfileMergePreview } from "@/lib/profile-links";

export default function ProfileLinkPage() {
  const { id } = useParams<{ id: string }>();
  const fieldId = useId(), generation = useRef(0), loadSequence = useRef(0), inFlight = useRef(false);
  const requestRef = useRef<ProfileLinkDetail | null>(null), draftInitialized = useRef(false);
  const [request, setRequest] = useState<ProfileLinkDetail | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false), [publicConfirmation, setPublicConfirmation] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const load = async () => {
    const s = getSupabaseClient();
    if (!s) { setError("接続情報を確認できません。入力は保持しています"); setLoading(false); return; }
    const ticket = ++loadSequence.current, version = generation.current;
    setLoading(true); setError("");
    try {
      const next = await profileLinkRpc<ProfileLinkDetail>(s, "get_player_profile_link_request", { p_request_id: id });
      if (version !== generation.current || ticket !== loadSequence.current) return;
      if (hasRecipientLinkName(next)) {
        if (!draftInitialized.current) {
          setName(next.group_display_name_suggestion); setConsent(false); setPublicConfirmation(true); draftInitialized.current = true;
        } else {
          const previous = requestRef.current;
          if (!previous || !hasRecipientLinkName(previous) || previous.review_token !== next.review_token
            || previous.group_display_name_current !== next.group_display_name_current || previous.group_visibility !== next.group_visibility) {
            // A manual reload may reveal different consent content. Retain the edited name,
            // but do not approve a new token with acknowledgements for an old snapshot.
            setConsent(false);
            setMessage("最新の内容を読み込みました。入力名は保持しています。引継ぎ内容と公開設定を再確認してください");
          }
        }
      }
      requestRef.current = next; setRequest(next);
    } catch (cause) {
      if (version === generation.current && ticket === loadSequence.current) setError(`${profileErrorMessage(cause)}。入力と確認は保持しています`);
    } finally { if (version === generation.current && ticket === loadSequence.current) setLoading(false); }
  };
  useEffect(() => {
    generation.current++; inFlight.current = false; requestRef.current = null; draftInitialized.current = false;
    setRequest(null); setName(""); setConsent(false); setPublicConfirmation(true); setBusy(false); setMessage("");
    void load();
    return () => { generation.current++; };
  }, [id]);
  const namedRecipient = request !== null && hasRecipientLinkName(request);
  const canApprove = namedRecipient && !!request.target_profile_id && !!request.review_token && isValidProfileLinkDisplayName(name)
    && Date.parse(request.expires_at) > Date.now()
    && consent;
  const review = async (decision: "approved" | "rejected" | "cancelled") => {
    const s = getSupabaseClient();
    if (!s || busy || loading || inFlight.current || !request || (!request.is_recipient && decision !== "cancelled") || (decision === "approved" && !canApprove)) return;
    const version = generation.current;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = decision === "approved"
        ? await approveNamedPlayerProfileLink(s, request, { name, inheritanceConsent: consent, publicConfirmation })
        : await reviewPlayerProfileLink(s, id, decision, request.is_recipient ? request.review_token : undefined);
      if (version !== generation.current) return;
      // A confirmed success must not become another approval attempt if the following read fails.
      const updated = { ...request, status: result.status } as ProfileLinkDetail;
      requestRef.current = updated; setRequest(updated);
      await load();
      if (version === generation.current) setMessage(result.status === "approved" ? "連携が完了しました" : result.status === "rejected" ? "連携を拒否しました" : linkStatusLabel[result.status]);
    } catch (cause) { if (version === generation.current) setError(profileErrorMessage(cause)); }
    finally { if (version === generation.current) { inFlight.current = false; setBusy(false); } }
  };
  const disabled = busy || loading;
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
    <Card title="選手プロフィールの連携確認">
      {loading && <p role="status" className="text-sm text-zinc-400">読み込み中...</p>}
      {request && <div className="space-y-4">
        <p className="text-sm">申請元：{request.club_name}</p><p className="text-sm text-amber-200">{linkStatusLabel[request.status]}</p>
        <p className="text-xs text-zinc-400">期限 {new Date(request.expires_at).toLocaleString("ja-JP")}</p>
        {request.is_recipient && request.status === "pending" && request.source && <>
          <ProfileMergeSummary groupAlias preview={request as ProfileLinkDetail & ProfileMergePreview} />
          {request.target_profile_id ? <>
            <div><label htmlFor={fieldId} className="mb-2 block text-sm">グループ内表示名</label>
              <input id={fieldId} value={name} disabled={disabled} autoComplete="off" className="min-h-11 w-full rounded-xl bg-zinc-800 p-3" onChange={e => setName(e.target.value)} />
              <p className="mt-1 text-xs text-zinc-400">120文字以内。このグループだけの名前です。本人プロフィール名は変更しません。</p></div>
            {!namedRecipient && <p className="text-sm text-red-400">表示名の確認情報を取得できません。再読み込みしてDBの適用状態を確認してください。</p>}
            {request.group_visibility === "public" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={publicConfirmation} disabled={disabled} onChange={e => setPublicConfirmation(e.target.checked)} /><span>承認後、グループ内表示名を未所属者にも公開する（OFFでも連携できます）</span></label>}
            {request.group_visibility === "private" && <p className="text-xs text-zinc-400">非公開グループでは公開確認を登録しません。</p>}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} disabled={disabled} onChange={e => setConsent(e.target.checked)} /><span>この仮登録選手が自分であり、表示された所属・戦績を引き継ぐことに同意します</span></label>
            <div className="flex gap-2"><button disabled={disabled || !canApprove} className="min-h-11 w-1/2 rounded-xl bg-accent py-3 text-black disabled:bg-zinc-600" onClick={() => void review("approved")}>承認</button><button disabled={disabled} className="min-h-11 w-1/2 rounded-xl border border-zinc-500 py-3" onClick={() => void review("rejected")}>拒否</button></div>
          </> : <div className="space-y-2"><p className="text-sm">本人の正規プロフィールを作成してから承認できます。</p><Link href="/profile" className="block rounded-xl bg-accent p-3 text-center text-black">プロフィールを作成する</Link><button disabled={disabled} onClick={() => void review("rejected")} className="w-full rounded-xl border border-zinc-500 py-3">拒否</button></div>}
        </>}
        {!request.is_recipient && <div className="space-y-3 text-sm">
          <p>対象選手：{request.source_display_name ?? "対象選手を確認できません"}</p>
          {request.group_membership && <p className="text-xs text-zinc-400">
            {({ main_admin: "メイン管理者", sub_admin: "サブ管理者", member: "メンバー" } as Record<string, string>)[request.group_membership.role] ?? request.group_membership.role}
            {" / "}{request.group_membership.is_active ? "在籍" : "退会・休止"}
          </p>}
          {request.status === "pending" && <button disabled={disabled} className="w-full rounded-xl border border-zinc-500 py-3" onClick={() => void review("cancelled")}>申請を取り消す</button>}
        </div>}
      </div>}
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-emerald-400">{message}</p>}
      {request?.is_recipient && request.status === "pending" && <p className="mt-3 text-xs text-zinc-400">再読み込みで内容が変わった場合、入力名を保持して同意を取り直します。</p>}
      <button disabled={disabled} onClick={() => void load()} className="mt-3 min-h-11 text-sm underline">再読み込み</button>
    </Card><Link href="/notifications" className="text-center text-sm underline">通知へ戻る</Link>
  </main>;
}
