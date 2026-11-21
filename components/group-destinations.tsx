"use client";

import Link from "next/link";
import { GroupEntryLink, useGroupOriginRestore } from "@/components/group-entry-link";
import { useEffect, useState } from "react";
import { Card } from "./ui";
import { getSupabaseClient } from "@/lib/supabase";
import { getOfficialAccess } from "@/lib/official-matches";
import { readMemberGroups } from "@/lib/member-groups";
import { useSessionAccount } from "./use-session-account";

export function GroupDestinations({ ranking = false }: { ranking?: boolean }) {
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const account = useSessionAccount();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggedOut, setLoggedOut] = useState(false);
  useEffect(() => {
    let active = true;
    setGroups([]); setLoading(true); setError("");
    const s = getSupabaseClient();
    if (!s) { setLoading(false); setError("グループを取得できませんでした"); return; }
    void (ranking ? getOfficialAccess(s) : readMemberGroups(s)).then(access => { if (active) { setGroups(access.groups); setLoggedOut(!access.uid); } })
      .catch(() => { if (active) setError("グループを取得できませんでした"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ranking, account.id]);
  useGroupOriginRestore(account.id,!loading);
  return <Card title={ranking ? "グループ別ランキング" : "所属グループ"}><div className="space-y-3">
    {ranking && <p className="text-sm text-zinc-300">グループを選ぶと、既存の個人・ペア戦績を確認できます。全グループを合算したランキングではありません。</p>}
    {loading && <p role="status" className="text-sm text-zinc-400">グループを読み込み中…</p>}{error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {!loading && !error && !groups.length && (loggedOut ? <Link className="block min-h-12 p-3 text-sm underline" href="/login">ログインしてグループを確認する</Link> : <p className="rounded-xl bg-zinc-800 p-3 text-sm text-zinc-300">{ranking ? "表示できるグループがありません。" : "まだ所属グループがありません。グループを探すか、新しく作成できます。"}</p>)}
    {groups.map(group => <GroupEntryLink groupId={group.id} origin={ranking?"ranking":"profile"} stats={ranking} key={group.id} className="block min-h-12 rounded-xl border border-zinc-700 p-3"><span className="break-words font-semibold">{group.name}</span><span className="mt-1 block text-xs text-zinc-400">{ranking ? "個人・ペアの戦績を見る →" : "グループ詳細へ →"}</span></GroupEntryLink>)}
    {!ranking && account.ready && account.id && <div className="grid gap-2 border-t border-zinc-700 pt-3 text-sm"><p className="font-semibold">グループ関連アクション</p><Link href="/groups/discover" className="min-h-12 rounded-xl border border-zinc-600 p-3">グループを探す</Link><Link href="/groups/new" className="min-h-12 rounded-xl border border-accent p-3 text-accent">新しいグループを作成</Link></div>}
  </div></Card>;
}
