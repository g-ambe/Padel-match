"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "./ui";
import { getSupabaseClient } from "@/lib/supabase";
import { getOfficialAccess, type OfficialGroup } from "@/lib/official-matches";

export function GroupDestinations({ ranking = false }: { ranking?: boolean }) {
  const [groups, setGroups] = useState<OfficialGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggedOut, setLoggedOut] = useState(false);
  useEffect(() => {
    let active = true;
    const s = getSupabaseClient();
    if (!s) { setLoading(false); setError("グループを取得できませんでした"); return; }
    void getOfficialAccess(s).then(access => { if (active) { setGroups(access.groups); setLoggedOut(!access.uid); } })
      .catch(() => { if (active) setError("グループを取得できませんでした"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <Card title={ranking ? "グループ別ランキング" : "グループの戦績・管理"}><div className="space-y-3">
    {ranking && <p className="text-sm text-zinc-300">グループを選ぶと、既存の個人・ペア戦績を確認できます。全グループを合算したランキングではありません。</p>}
    {loading && <p role="status" className="text-sm text-zinc-400">グループを読み込み中…</p>}{error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {!loading && !error && !groups.length && (loggedOut ? <Link className="block min-h-12 p-3 text-sm underline" href="/login">ログインしてグループを確認する</Link> : <p className="text-sm text-zinc-400">表示できるグループがありません。</p>)}
    {groups.map(group => <Link key={group.id} href={`/groups/${group.id}${ranking ? "?tab=stats" : ""}`} className="block min-h-12 rounded-xl border border-zinc-700 p-3"><span className="break-words font-semibold">{group.name}</span><span className="mt-1 block text-xs text-zinc-400">{ranking ? "個人・ペアの戦績を見る →" : group.role === "member" ? "グループ詳細・戦績へ →" : "グループ詳細・メンバー管理へ →"}</span></Link>)}
    {!ranking && <div className="grid gap-2 text-sm"><Link href="/groups" className="min-h-11 p-2 underline">所属グループ閲覧・設定</Link><Link href="/groups/discover" className="min-h-11 p-2 underline">グループを探す</Link><Link href="/groups/new" className="min-h-11 p-2 underline">グループを作成する</Link></div>}
  </div></Card>;
}
