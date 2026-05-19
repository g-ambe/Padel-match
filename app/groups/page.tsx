"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

type Group = { id: string; name: string; description: string | null; is_active: boolean; visibility: "private" | "public" };

export default function GroupsPage() {
  const [memberGroups, setMemberGroups] = useState<Group[]>([]);
  const [publicGroups, setPublicGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) { setMemberGroups([]); setPublicGroups([]); return; }

    const { data: adminRow } = await supabase.from("app_admins").select("id").eq("profile_id", userId).eq("is_active", true).maybeSingle();
    const isSuperUser = !!adminRow;

    if (isSuperUser) {
      const { data } = await supabase.from("clubs").select("id,name,description,is_active,visibility").order("created_at", { ascending: false });
      const all = (data ?? []) as Group[];
      const memberships = all.filter((g) => g.is_active);
      const publics = all.filter((g) => g.visibility === "public" && g.is_active);
      setMemberGroups(memberships);
      setPublicGroups(publics);
      return;
    }

    const { data: linkedProfiles } = await supabase
      .from("player_profiles")
      .select("id")
      .eq("linked_auth_user_id", userId);

    const linkedProfileIds = (linkedProfiles ?? []).map((p: any) => p.id).filter(Boolean);

    let memberRows: any[] = [];
    if (linkedProfileIds.length) {
      const { data } = await supabase
        .from("club_members")
        .select("clubs(id,name,description,is_active,visibility)")
        .in("player_profile_id", linkedProfileIds)
        .eq("is_active", true)
        .eq("clubs.is_active", true);
      memberRows = data ?? [];
      console.log("[groups] current auth user id:", userId);
      console.log("[groups] matched player_profile ids:", linkedProfileIds);
      console.log("[groups] loaded club_members count:", memberRows.length);
    }

    if (!memberRows.length) {
      const { data } = await supabase
        .from("club_members")
        .select("clubs(id,name,description,is_active,visibility)")
        .eq("profile_id", userId)
        .eq("is_active", true)
        .eq("clubs.is_active", true);
      memberRows = data ?? [];
    }

    const { data: publicClubs } = await supabase.from("clubs").select("id,name,description,is_active,visibility").eq("is_active", true).eq("visibility", "public");

    const ownedRows: Group[] = memberRows.map((r: any) => r.clubs).filter(Boolean);
    const memberMap = new Map<string, Group>();
    for (const g of ownedRows) memberMap.set(g.id, g);
    const memberRowsUnique = [...memberMap.values()];

    const publicOnly = ((publicClubs ?? []) as Group[]).filter((g) => !memberMap.has(g.id));

    console.log("[groups] loaded member groups count:", memberRowsUnique.length);
    console.log("[groups] loaded public groups count:", publicOnly.length);
    setMemberGroups(memberRowsUnique);
    setPublicGroups(publicOnly);
  };

  useEffect(() => { void load(); }, []);

  const createGroup = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !name.trim()) {
      setError("グループ名を入力してください");
      return;
    }
    setError("");
    setMessage("");

    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) {
      setError("ログイン情報を確認できません");
      return;
    }

    const { data: club, error: clubErr } = await supabase
      .from("clubs")
      .insert({ name: name.trim(), description: description.trim() || null, owner_id: userId, is_active: true })
      .select("id")
      .single();

    if (clubErr || !club?.id) {
      setError("グループ作成に失敗しました");
      return;
    }

    const { data: existingProfiles } = await supabase
      .from("player_profiles")
      .select("id")
      .eq("linked_auth_user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);

    let playerProfileId = existingProfiles?.[0]?.id ?? null;
    if (!playerProfileId) {
      const fallbackName = userRes.user?.email?.split("@")[0] ?? "メンバー";
      const { data: createdProfile, error: profileErr } = await supabase
        .from("player_profiles")
        .insert({ display_name: fallbackName, linked_auth_user_id: userId, is_active: true })
        .select("id")
        .single();

      if (profileErr || !createdProfile?.id) {
        setError("作成者プロフィールの作成に失敗しました");
        return;
      }
      playerProfileId = createdProfile.id;
    }

    await supabase.from("club_members").insert({
      club_id: club.id,
      profile_id: userId,
      player_profile_id: playerProfileId,
      role: "main_admin",
      is_active: true,
    });
    setName("");
    setDescription("");
    setMessage("更新しました");
    await load();
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">グループ管理</h1>
      <Card title="グループ作成">
        <div className="space-y-2">
          <input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="グループ名" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="w-full rounded-xl bg-zinc-800 p-3" placeholder="説明（任意）" value={description} onChange={(e) => setDescription(e.target.value)} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          {message && <p className="text-sm text-emerald-400">{message}</p>}
          <button className="w-full rounded-xl bg-accent py-3 font-semibold text-black" onClick={createGroup}>作成</button>
        </div>
      </Card>
      <Card title="所属グループ">
        <div className="space-y-2">
          {memberGroups.length === 0 ? <p className="rounded-xl bg-zinc-800 p-3 text-sm text-zinc-300">所属グループがありません</p> : memberGroups.map((g) => (
            <Link key={g.id} href={`/groups/${g.id}`} className="block rounded-xl bg-zinc-800 p-3">
              <p className="font-semibold">{g.name}{!g.is_active ? "（非表示）" : ""}</p>
              <p className="text-xs text-zinc-300">{g.description || "説明なし"}</p>
            </Link>
          ))}
        </div>
      </Card>
      <Card title="公開グループ">
        <div className="space-y-2">
          {publicGroups.length === 0 ? <p className="rounded-xl bg-zinc-800 p-3 text-sm text-zinc-300">公開グループはありません</p> : publicGroups.map((g) => (
            <Link key={g.id} href={`/groups/${g.id}`} className="block rounded-xl bg-zinc-800 p-3">
              <p className="font-semibold">{g.name}{!g.is_active ? "（非表示）" : ""}</p>
              <p className="text-xs text-zinc-300">{g.description || "説明なし"}</p>
            </Link>
          ))}
        </div>
      </Card>
    </main>
  );
}
