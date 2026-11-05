"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";
import { readMemberGroups } from "@/lib/member-groups";

type Group = { id: string; name: string; description: string | null; is_active: boolean; visibility: "private" | "public" };

export default function GroupsPage() {
  const router = useRouter();
  const [memberGroups, setMemberGroups] = useState<Group[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const result = await readMemberGroups(supabase);
      if (!result.uid) { router.replace("/"); return; }
      setMemberGroups(result.groups);
    } catch { setError("所属グループを取得できませんでした"); }
  };

  useEffect(() => { void load(); }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">所属グループ閲覧・設定</h1>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <Card title="所属グループ">
        <div className="space-y-2">
          {memberGroups.length === 0 ? <p className="rounded-xl bg-zinc-800 p-3 text-sm text-zinc-300">{error ? "所属グループを確認できていません。再読み込みしてください。" : "所属グループがありません"}</p> : memberGroups.map((g) => (
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
