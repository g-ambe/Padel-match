"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";
import { ensureAccountProfile, ensureLinkedPlayerProfile, preferredPlayerProfileId, profileErrorMessage } from "@/lib/player-profiles";
import { useSessionAccount } from "@/components/use-session-account";
import { finishGroupCreation, matchFormReturnPath, readGroupCreation, type GroupCreationDraft } from "@/lib/match-group-drafts";

export default function NewGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const account = useSessionAccount();
  const [returnDraft, setReturnDraft] = useState<GroupCreationDraft | null>(null);
  const [returnError, setReturnError] = useState("");
  const [createdClubId, setCreatedClubId] = useState<string | null>(null);
  useEffect(() => {
    setReturnDraft(null); setReturnError("");
    setName(""); setDescription(""); setVisibility("private"); setCreatedClubId(null);
    if (!account.ready || !account.id) return;
    const token = new URLSearchParams(window.location.search).get("fromMatch");
    if (!token) return;
    try {
      const draft = readGroupCreation(sessionStorage, account.id, token);
      if (draft) setReturnDraft(draft);
      else setReturnError("試合作成への復帰情報が見つかりません。期限切れ・別アカウント・復元済みの場合は、通常のグループ作成として利用してください。");
    } catch { setReturnError("試合作成への復帰情報を読み込めませんでした。"); }
  }, [account.ready, account.id]);

  const cancel = () => {
    if (creating) return;
    if (!returnDraft || !account.id) { router.push("/groups"); return; }
    try { router.replace(finishGroupCreation(sessionStorage, account.id, returnDraft.token, null) ?? matchFormReturnPath(returnDraft)); }
    catch { router.replace(matchFormReturnPath(returnDraft)); }
  };

  const createGroup = async () => {
    if (creating || createdClubId || !account.id) return;
    const supabase = getSupabaseClient();
    if (!supabase || !name.trim()) return setError("グループ名を入力してください");
    setError("");
    setCreating(true);
    try {
      const { data: userRes, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const userId = userRes.user?.id;
      if (!userId) return router.replace("/");
      if (userId !== account.id) return setError("ログイン状態が変わっています。画面を再読み込みしてください。");

      // プロフィールを確認できるまでグループ自体を作成しない。
      const fallbackName = userRes.user?.user_metadata?.display_name || userRes.user?.email?.split("@")[0] || "メンバー";
      const profile = await ensureLinkedPlayerProfile(supabase, userId, fallbackName, preferredPlayerProfileId(userId));
      if (!profile.is_active) return setError("この選手は無効になっています。プロフィールの連携を管理者に確認してください");
      await ensureAccountProfile(supabase, userId, profile.display_name, userRes.user?.email ?? null);

      const { data: club, error: clubErr } = await supabase
        .from("clubs")
        .insert({ name: name.trim(), description: description.trim() || null, owner_id: userId, is_active: true, visibility })
        .select("id")
        .single();
      if (clubErr || !club?.id) return setError("グループ作成に失敗しました");
      setCreatedClubId(club.id);

      const { error: memberError } = await supabase.from("club_members").insert({ club_id: club.id, profile_id: userId, player_profile_id: profile.id, role: "main_admin", is_active: true });
      if (memberError) return setError("グループは作成されましたが、管理者の登録に失敗しました。再作成せず管理者に確認してください");
      if (returnDraft) {
        try {
          const path = finishGroupCreation(sessionStorage, userId, returnDraft.token, club.id);
          if (path) { router.replace(path); return; }
          setReturnError("グループは作成済みですが、有効な復帰情報がありません。試合画面でグループを選び直してください。");
        } catch {
          setReturnError("グループは作成済みですが、選択情報を一時保存できませんでした。「試合作成へ戻る」から入力を復元し、グループを選び直してください。");
          return;
        }
      }
      router.push(`/groups/${club.id}`);
    } catch (cause) {
      console.error("グループ作成時のプロフィール確認に失敗しました", cause);
      setError(profileErrorMessage(cause));
    } finally { setCreating(false); }
  };

  if (!account.ready) return <main className="mx-auto max-w-md p-4"><p role="status">ログイン状態を確認中…</p></main>;
  if (!account.id) return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4"><h1 className="text-xl font-bold">グループ作成</h1><Card title="アカウント登録のご案内"><p className="text-sm">グループの作成にはアカウント登録が必要です。</p><div className="mt-4 grid gap-3 text-sm"><Link href="/login?mode=signup" className="min-h-12 rounded-xl bg-accent p-3 text-center font-bold text-black">新規アカウント登録へ進む</Link><Link href="/login" className="min-h-12 rounded-xl border border-zinc-600 p-3 text-center">ログインする</Link><Link href="/home" className="min-h-12 p-3 text-center underline">試合画面へ戻る</Link></div></Card></main>;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="pr-14 text-xl font-bold">グループを作成する</h1>
      {returnDraft && <p className="text-sm text-zinc-300">作成後、入力途中の試合画面へ戻ります。{returnDraft.slot === "team_a" ? "チームA" : returnDraft.slot === "team_b" ? "チームB" : "作成先"}だけを新しいグループへ変更します。</p>}
      {returnError && <p role="alert" className="text-sm text-amber-300">{returnError}</p>}
      <Card title="グループ作成">
        <div className="space-y-2">
          <input aria-label="グループ名" className="w-full rounded-xl bg-zinc-800 p-3" placeholder="グループ名" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="w-full rounded-xl bg-zinc-800 p-3" placeholder="説明（任意）" value={description} onChange={(e) => setDescription(e.target.value)} />
          <select className="w-full rounded-xl bg-zinc-800 p-3" value={visibility} onChange={(e) => setVisibility(e.target.value as "private" | "public")}>
            <option value="private">非公開</option>
            <option value="public">公開</option>
          </select>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button disabled={creating || !!createdClubId} className="w-full rounded-xl bg-accent py-3 font-semibold text-black disabled:bg-zinc-600" onClick={() => void createGroup()}>{creating ? "作成中..." : createdClubId ? "作成済み" : "作成"}</button>
        </div>
      </Card>
      <button type="button" disabled={creating} className="min-h-12 rounded-xl border border-zinc-600 p-3 text-sm" onClick={cancel}>{createdClubId && returnDraft ? "試合作成へ戻る" : "キャンセル"}</button>
    </main>
  );
}
