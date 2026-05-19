"use client";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

type NotificationFilter = "すべて" | "未読" | "既読";
type AppNotification = { id: string; title: string; body: string | null; is_read: boolean; created_at: string; };

export default function NotificationsPage() {
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [filter, setFilter] = useState<NotificationFilter>("すべて");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const s = getSupabaseClient();
    if (!s) return;
    setLoading(true);
    setError("");
    const { data, error: e } = await s.from("notifications").select("id,title,body,is_read,created_at").order("created_at", { ascending: false });
    if (e) setError("通知の取得に失敗しました");
    setRows((data ?? []) as AppNotification[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const unreadCount = useMemo(() => rows.filter((r) => !r.is_read).length, [rows]);
  const visible = useMemo(() => rows.filter((r) => filter === "すべて" ? true : filter === "未読" ? !r.is_read : r.is_read), [rows, filter]);

  const markOneRead = async (id: string) => {
    const s = getSupabaseClient();
    if (!s) return;
    const { error: e } = await s.from("notifications").update({ is_read: true }).eq("id", id).eq("is_read", false);
    if (e) return setError("既読更新に失敗しました");
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, is_read: true } : r));
  };

  const markAllRead = async () => {
    const s = getSupabaseClient();
    if (!s) return;
    const { error: e } = await s.from("notifications").update({ is_read: true }).eq("is_read", false);
    if (e) return setError("既読更新に失敗しました");
    setRows((prev) => prev.map((r) => ({ ...r, is_read: true })));
  };

  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4"><Card title="通知"><div className="space-y-3">{error && <p className="text-sm text-red-400">{error}</p>}{loading && <p className="text-xs text-zinc-400">読み込み中...</p>}<div className="flex gap-2 text-xs">{(["すべて", "未読", "既読"] as NotificationFilter[]).map((f) => <button key={f} className={`rounded-lg px-3 py-2 ${filter === f ? "bg-accent text-black" : "bg-zinc-800"}`} onClick={() => setFilter(f)}>{f}</button>)}</div><div className="flex items-center justify-between"><p className="text-xs text-zinc-300">未読 {unreadCount} 件</p><button disabled={unreadCount === 0} className="rounded-lg border border-zinc-600 px-3 py-2 text-xs disabled:text-zinc-500" onClick={() => void markAllRead()}>すべて既読にする</button></div><div className="space-y-2">{visible.length === 0 ? <p className="text-sm text-zinc-400">通知はありません</p> : visible.map((n) => <div key={n.id} className="rounded-xl bg-zinc-800 p-3"><div className="flex items-center justify-between gap-2"><p className="font-semibold">{n.title}</p><span className={`rounded-full px-2 py-0.5 text-[11px] ${n.is_read ? "bg-zinc-700 text-zinc-300" : "bg-emerald-700/40 text-emerald-300"}`}>{n.is_read ? "既読" : "未読"}</span></div>{n.body && <p className="mt-1 text-sm text-zinc-300">{n.body}</p>}<p className="mt-1 text-xs text-zinc-400">{new Date(n.created_at).toLocaleString("ja-JP")}</p>{!n.is_read && <button className="mt-2 rounded-lg border border-zinc-600 px-3 py-1 text-xs" onClick={() => void markOneRead(n.id)}>既読にする</button>}</div>)}</div></div></Card></main>;
}
