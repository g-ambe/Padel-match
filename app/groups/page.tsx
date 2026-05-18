"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

type Group = { id: string; name: string; description: string | null; is_active: boolean };

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;

    const { data: adminRow } = await supabase.from("app_admins").select("id").eq("profile_id", userId).eq("is_active", true).maybeSingle();
    const isSuperUser = !!adminRow;

    if (isSuperUser) {
      const { data } = await supabase.from("clubs").select("id,name,description,is_active").order("created_at", { ascending: false });
      setGroups((data ?? []) as Group[]);
      return;
    }

    const { data } = await supabase
      .from("club_members")
      .select("clubs(id,name,description,is_active)")
      .eq("profile_id", userId)
      .eq("is_active", true)
      .eq("clubs.is_active", true);

    const rows: Group[] = (data ?? []).map((r: any) => r.clubs).filter(Boolean);
    setGroups(rows);
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

    await supabase.from("club_members").insert({ club_id: club.id, profile_id: userId, role: "main_admin", is_active: true });
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
          {groups.length === 0 ? <p className="rounded-xl bg-zinc-800 p-3 text-sm text-zinc-300">所属グループがありません</p> : groups.map((g) => (
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
