"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";
import { clearGuestEvents, isGuestModeEnabled, listGuestEvents, resetGuestModeData } from "@/lib/guest-events";
import { loadFriendlyEventAccess } from "@/lib/friendly-event-access";
import { getOfficialAccess } from "@/lib/official-matches";
import { loadOrdinaryMatches, loadFriendlyTeamMatches, loadOfficialTeamMatches, matchTopEntries, type MatchTopEntry } from "@/lib/match-top";
import { readMatchGroupFilter, saveMatchGroupFilter, discardGuestCreationDraft } from "@/lib/match-group-drafts";

export default function HomePage() {
  const router = useRouter();
  const [entries, setEntries] = useState<MatchTopEntry[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [group, setGroup] = useState("all");
  const [pastFilter, setPastFilter] = useState<"all" | "friendly" | "official">("all");
  const [expanded, setExpanded] = useState(false);
  const [guest, setGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const version = useRef(0);
  const filterOwner = useRef("");
  const [ownerId, setOwnerId] = useState<string | null>(null);

  const load = async () => {
    const request = ++version.current;
    setLoading(true); setError(""); setEntries([]);
    try {
      const s = getSupabaseClient();
      const session = s ? (await s.auth.getSession()).data.session : null;
      if (request !== version.current) return;
      if (!session && isGuestModeEnabled()) {
        setOwnerId(null);
        setGuest(true); setGroups([]);
        setEntries(listGuestEvents().map(event => ({ id: event.id, kind: "guest", title: event.name, status: event.status,
          createdAt: event.created_at, href: `/events/${event.id}`, groupIds: [], groupLabel: "ゲストモード・一時保存",
          formatLabel: `フレンドリー・組み合わせ戦（${event.event_mode === "manual" ? "手動" : "自動"}）` })));
        return;
      }
      if (!session) { router.replace("/"); return; }
      if (!s) throw new Error("設定を確認できません");
      resetGuestModeData(); setGuest(false);
      setOwnerId(session.user.id);
      try { discardGuestCreationDraft(sessionStorage); } catch { /* 既存のログイン後消去に合わせる。 */ }
      // 形式ごとの既存の所属・権限判定を維持し、部分的な取得失敗も明示する。
      const [ordinaryAccess, officialAccess] = await Promise.allSettled([loadFriendlyEventAccess(s), getOfficialAccess(s)]);
      const ordinary = ordinaryAccess.status === "fulfilled" ? ordinaryAccess.value : null;
      const official = officialAccess.status === "fulfilled" ? officialAccess.value : null;
      if (request !== version.current) return;
      const availableGroups = [...new Map([...(ordinary?.groups ?? []), ...(official?.groups ?? [])].map(item => [item.id, item])).values()];
      setGroups(availableGroups);
      if (filterOwner.current !== session.user.id) {
        filterOwner.current = session.user.id;
        try { setGroup(readMatchGroupFilter(sessionStorage, session.user.id, availableGroups.map(item => item.id))); } catch { setGroup("all"); }
      } else setGroup(current => current === "all" || current === "none" || availableGroups.some(item => item.id === current) ? current : "all");
      const lists = await Promise.allSettled([
        ordinary ? loadOrdinaryMatches(s, ordinary) : Promise.reject(new Error("通常フレンドリーの所属を確認できません")),
        official ? loadFriendlyTeamMatches(s, official) : Promise.reject(new Error("チーム戦の所属を確認できません")),
        official ? loadOfficialTeamMatches(s, official) : Promise.reject(new Error("公式戦の所属を確認できません"))
      ]);
      if (request !== version.current) return;
      setEntries(lists.flatMap(result => result.status === "fulfilled" ? result.value : []));
      const failed = lists.flatMap((result, index) => result.status === "rejected" ? [(["組み合わせ戦", "フレンドリーチーム戦", "オフィシャルチーム戦"] as const)[index]] : []);
      if (failed.length) setError(`${failed.join("・")}を取得できませんでした。再読み込みしてください。`);
    } catch (cause) {
      if (request === version.current) setError(cause instanceof Error ? cause.message : "試合を取得できませんでした");
    } finally { if (request === version.current) setLoading(false); }
  };
  useEffect(() => { void load(); return () => { version.current++; }; }, []);
  const { active, past } = useMemo(() => matchTopEntries(entries, group, pastFilter), [entries, group, pastFilter]);
  const createHref = `/matches/new${group !== "all" && group !== "none" ? `?group=${encodeURIComponent(group)}` : ""}`;

  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 p-4">
    <header className="min-h-11 pr-14"><p className="text-xs font-semibold tracking-wider text-accent">PADEL MATCH</p><h1 className="text-2xl font-bold">試合</h1></header>
    <div className="space-y-2 text-sm"><div className="flex items-center justify-between gap-3"><label htmlFor="match-group-filter" className="font-semibold">表示対象グループ</label>{!guest && ownerId && <Link href="/groups" className="flex min-h-11 items-center text-accent underline">グループ管理</Link>}</div><select id="match-group-filter" aria-label="表示対象グループ" className="min-h-12 w-full rounded-xl border border-zinc-700 bg-card p-3" value={group} onChange={event => { setGroup(event.target.value); setExpanded(false); if (ownerId) { try { saveMatchGroupFilter(sessionStorage, ownerId, event.target.value); } catch { /* 表示は維持する。 */ } } }}>
      <option value="all">すべての閲覧可能な試合</option><option value="none">グループなし</option>{groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></div>
    {guest && <p className="rounded-xl border border-amber-500/50 p-3 text-sm text-amber-300">ゲストの試合はこのブラウザに一時保存されます。通常の画面移動では削除されません。</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <section aria-labelledby="active-matches-title" className="space-y-3"><div className="flex items-center justify-between"><h2 id="active-matches-title" className="text-lg font-bold">開催中の試合{!loading && `（${active.length}）`}</h2><button type="button" disabled={loading} className="min-h-11 px-2 text-sm underline disabled:opacity-50" onClick={() => void load()}>再読み込み</button></div>
      {loading ? <p role="status" className="text-sm text-zinc-400">試合を読み込み中…</p> : active.length ? (expanded ? active : active.slice(0, 2)).map(entry => <Link key={`${entry.kind}:${entry.id}`} href={entry.href} className="block space-y-3 rounded-2xl border border-accent bg-card p-4 shadow-lg" data-active-match>
        <div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-accent px-2 py-1 font-bold text-black">開催中</span><span className="py-1 text-zinc-300">{entry.formatLabel}</span></div>
        <h3 className="break-words text-xl font-bold">{entry.title}</h3><p className="break-words text-sm text-zinc-300">{entry.groupLabel}</p><p className="text-right text-sm font-semibold text-accent">試合を開く →</p>
      </Link>) : <p className="rounded-xl bg-card p-4 text-sm text-zinc-400">開催中の試合はありません。</p>}
      {!loading && active.length > 2 && <button type="button" aria-expanded={expanded} className="min-h-11 w-full rounded-xl border border-zinc-600 p-3 text-sm" onClick={() => setExpanded(value => !value)}>{expanded ? "閉じる" : `残り${active.length - 2}件を表示`}</button>}
    </section>
    <Link href={createHref} className="block min-h-14 rounded-2xl bg-accent p-4 text-center font-bold text-black">＋ 新しいイベントを作成</Link>
    <Card title="過去の試合"><div className="space-y-3"><div className="grid grid-cols-3 gap-2" role="group" aria-label="過去の試合の形式">{([ ["all", "すべて"], ["friendly", "フレンドリー"], ["official", "オフィシャル"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={pastFilter === value} className={`min-h-11 rounded-xl border px-1 text-xs ${pastFilter === value ? "border-accent bg-accent font-bold text-black" : "border-zinc-700"}`} onClick={() => setPastFilter(value)}>{label}</button>)}</div>
      {!loading && !past.length && <p className="text-sm text-zinc-400">過去の試合はありません。</p>}
      {past.map(entry => <Link key={`${entry.kind}:${entry.id}`} href={entry.href} className="block rounded-xl border border-zinc-700 px-3 py-3" data-past-match><p className="break-words font-semibold">{entry.title}</p><p className="mt-1 text-xs text-zinc-400">{entry.formatLabel}</p><p className="mt-1 break-words text-xs text-zinc-400">{entry.groupLabel} / {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString("ja-JP") : "日付未設定"}</p></Link>)}
    </div></Card>
    {guest && <Card title="ゲスト利用を終了"><p className="text-xs text-amber-300">TOPへ戻るとゲストイベントの一時データは削除されます。</p><button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-zinc-600 p-3 text-sm" onClick={() => { clearGuestEvents(); try { discardGuestCreationDraft(sessionStorage); } catch { /* 保存設定によらず終了できる。 */ } router.push("/"); }}>TOPへ戻る</button></Card>}
  </main>;
}
