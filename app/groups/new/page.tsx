"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";
import { ensureAccountProfile, ensureLinkedPlayerProfile, preferredPlayerProfileId, profileErrorMessage } from "@/lib/player-profiles";

export default function NewGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const pendingCreate = useRef<{ signature: string; request: string } | null>(null);

  const createGroup = async () => {
    if (creating) return;
    const supabase = getSupabaseClient();
    if (!supabase || !name.trim()) return setError("グループ名を入力してください");
    setError("");
    setCreating(true);
    try {
      const { data: userRes, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const userId = userRes.user?.id;
      if (!userId) return router.replace("/");

      // プロフィールを確認できるまでグループ自体を作成しない。
      const fallbackName = userRes.user?.user_metadata?.display_name || userRes.user?.email?.split("@")[0] || "メンバー";
      const profile = await ensureLinkedPlayerProfile(supabase, userId, fallbackName, preferredPlayerProfileId(userId));
      if (!profile.is_active) return setError("この選手は無効になっています。プロフィールの連携を管理者に確認してください");
      await ensureAccountProfile(supabase, userId, profile.display_name, userRes.user?.email ?? null);

      const signature = JSON.stringify([name.trim(), description.trim(), visibility]);
      if (pendingCreate.current?.signature !== signature) pendingCreate.current = { signature, request: crypto.randomUUID() };
      const { data: club, error: clubErr } = await supabase.rpc("create_friendly_group", {
        p_request: pendingCreate.current.request, p_name: name.trim(), p_description: description.trim() || null, p_visibility: visibility
      });
      if (clubErr || !club?.club_id) return setError(clubErr?.code === "P0001" ? clubErr.message : "グループと管理者の登録に失敗しました。再試行してください");
      pendingCreate.current = null;
      router.push(`/groups/${club.club_id}`);
    } catch (cause) {
      console.error("グループ作成時のプロフィール確認に失敗しました", cause);
      setError(profileErrorMessage(cause));
    } finally { setCreating(false); }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">グループを作成する</h1>
      <Card title="グループ作成">
        <div className="space-y-2">
          <input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="グループ名" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="w-full rounded-xl bg-zinc-800 p-3" placeholder="説明（任意）" value={description} onChange={(e) => setDescription(e.target.value)} />
          <select className="w-full rounded-xl bg-zinc-800 p-3" value={visibility} onChange={(e) => setVisibility(e.target.value as "private" | "public")}>
            <option value="private">非公開</option>
            <option value="public">公開</option>
          </select>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button disabled={creating} className="w-full rounded-xl bg-accent py-3 font-semibold text-black disabled:bg-zinc-600" onClick={() => void createGroup()}>{creating ? "作成中..." : "作成"}</button>
        </div>
      </Card>
    </main>
  );
}
