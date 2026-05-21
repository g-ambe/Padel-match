"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

export default function NewGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [error, setError] = useState("");

  const createGroup = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !name.trim()) return setError("グループ名を入力してください");
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return router.replace("/");

    const { data: club, error: clubErr } = await supabase
      .from("clubs")
      .insert({ name: name.trim(), description: description.trim() || null, owner_id: userId, is_active: true, visibility })
      .select("id")
      .single();
    if (clubErr || !club?.id) return setError("グループ作成に失敗しました");

    const { data: existingProfiles } = await supabase.from("player_profiles").select("id").eq("linked_auth_user_id", userId).order("created_at", { ascending: true }).limit(1);
    let playerProfileId = existingProfiles?.[0]?.id ?? null;
    if (!playerProfileId) {
      const fallbackName = userRes.user?.email?.split("@")[0] ?? "メンバー";
      const { data: createdProfile, error: profileErr } = await supabase.from("player_profiles").insert({ display_name: fallbackName, linked_auth_user_id: userId, is_active: true }).select("id").single();
      if (profileErr || !createdProfile?.id) return setError("作成者プロフィールの作成に失敗しました");
      playerProfileId = createdProfile.id;
    }
    await supabase.from("club_members").insert({ club_id: club.id, profile_id: userId, player_profile_id: playerProfileId, role: "main_admin", is_active: true });
    router.push(`/groups/${club.id}`);
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
          <button className="w-full rounded-xl bg-accent py-3 font-semibold text-black" onClick={() => void createGroup()}>作成</button>
        </div>
      </Card>
    </main>
  );
}
