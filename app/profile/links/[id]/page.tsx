"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { ProfileMergeSummary } from "@/components/profile-merge-summary";
import { getSupabaseClient } from "@/lib/supabase";
import { profileErrorMessage } from "@/lib/player-profiles";
import { linkStatusLabel, profileLinkRpc, reviewPlayerProfileLink, type ProfileLinkDetail, type ProfileMergePreview } from "@/lib/profile-links";

export default function ProfileLinkPage() {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<ProfileLinkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = async () => {
    const s = getSupabaseClient(); if (!s) return;
    setLoading(true); setError(""); setRequest(null); setConsent(false);
    try { setRequest(await profileLinkRpc<ProfileLinkDetail>(s, "get_player_profile_link_request", { p_request_id: id })); }
    catch (cause) { setError(profileErrorMessage(cause)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id]);
  const review = async (decision: "approved" | "rejected" | "cancelled") => {
    const s = getSupabaseClient(); if (!s || busy || !request || (decision === "approved" && !consent)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await reviewPlayerProfileLink(s, id, decision, request.review_token);
      await load();
      setMessage(result.status === "approved" ? "連携が完了しました" : result.status === "rejected" ? "連携を拒否しました" : linkStatusLabel[result.status]);
    } catch (cause) { setError(profileErrorMessage(cause)); setConsent(false); }
    finally { setBusy(false); }
  };
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
    <Card title="選手プロフィールの連携確認">
      {loading ? <p className="text-sm text-zinc-400">読み込み中...</p> : request && <div className="space-y-4">
        <p className="text-sm">申請元：{request.club_name}</p><p className="text-sm text-amber-200">{linkStatusLabel[request.status]}</p>
        <p className="text-xs text-zinc-400">期限 {new Date(request.expires_at).toLocaleString("ja-JP")}</p>
        {request.status === "pending" && request.source && <>
          <ProfileMergeSummary preview={request as ProfileLinkDetail & ProfileMergePreview} />
          {request.is_recipient ? request.target_profile_id ? <>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} /><span>この仮登録選手が自分であり、表示された所属・戦績を引き継ぐことに同意します</span></label>
            <div className="flex gap-2"><button disabled={busy || !consent} className="w-1/2 rounded-xl bg-accent py-3 text-black disabled:bg-zinc-600" onClick={() => void review("approved")}>承認</button><button disabled={busy} className="w-1/2 rounded-xl border border-zinc-500 py-3" onClick={() => void review("rejected")}>拒否</button></div>
          </> : <div className="space-y-2"><p className="text-sm">本人の正規プロフィールを作成してから承認できます。</p><Link href="/profile" className="block rounded-xl bg-accent p-3 text-center text-black">プロフィールを作成する</Link><button disabled={busy} onClick={() => void review("rejected")} className="w-full rounded-xl border border-zinc-500 py-3">拒否</button></div>
            : <button disabled={busy} className="w-full rounded-xl border border-zinc-500 py-3" onClick={() => void review("cancelled")}>申請を取り消す</button>}
        </>}
      </div>}
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-emerald-400">{message}</p>}
      <button disabled={busy} onClick={() => void load()} className="mt-3 text-sm underline">再読み込み</button>
    </Card><Link href="/notifications" className="text-center text-sm underline">通知へ戻る</Link>
  </main>;
}
