"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { createShareToken, getOfficialAccess, officialStatusLabel } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";

type OfficialEvent = { id: string; club_id: string; clubName: string; title: string; event_date: string | null; status: string; share_enabled?: boolean | null; share_token?: string | null };

const missingColumn = (error: any, column: string) =>
  error?.code === "42703" || `${error?.message ?? ""} ${error?.details ?? ""}`.includes(column);

const logOfficialEventListError = (error: any) => {
  console.error("official_events list load failed", {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint
  });
};

async function fetchOfficialEvents(supabase: ReturnType<typeof getSupabaseClient>, clubIds: string[], clubNameById: Map<string, string>) {
  if (!supabase || !clubIds.length) return { data: [] as OfficialEvent[], error: null as any };
  const run = async (select: string) => await supabase.from("official_events").select(select).in("club_id", clubIds).order("created_at", { ascending: false });
  let { data, error } = await run("id,club_id,title,event_date,status,share_enabled,share_token");
  if (error && (missingColumn(error, "share_enabled") || missingColumn(error, "share_token"))) {
    ({ data, error } = await run("id,club_id,title,event_date,status"));
  }
  if (error) return { data: [] as OfficialEvent[], error };
  return {
    data: ((data ?? []) as Omit<OfficialEvent, "clubName">[]).map((event) => ({ ...event, clubName: clubNameById.get(event.club_id) ?? "名称未設定" })),
    error: null as any
  };
}

export default function OfficialMatchListPage() {
  const [events, setEvents] = useState<OfficialEvent[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manageableClubIds, setManageableClubIds] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const access = await getOfficialAccess(supabase);
      const clubIds = access.groups.map((group) => group.id);
      const clubNameById = new Map(access.groups.map((group) => [group.id, group.name]));
      setCanCreate(access.superUser || access.groups.some((group) => group.role !== "member"));
      setManageableClubIds(access.superUser ? clubIds : access.groups.filter((group) => group.role === "main_admin" || group.role === "sub_admin").map((group) => group.id));
      if (!clubIds.length) return;

      const { data, error: loadError } = await fetchOfficialEvents(supabase, clubIds, clubNameById);
      if (loadError) {
        logOfficialEventListError(loadError);
        setError("公式試合一覧の取得に失敗しました");
        return;
      }
      setError("");
      setEvents(data);
    })();
  }, []);


  const reloadEvents = async () => {
    const supabase = getSupabaseClient(); if (!supabase) return;
    const access = await getOfficialAccess(supabase);
    const clubIds = access.groups.map((group) => group.id);
    const clubNameById = new Map(access.groups.map((group) => [group.id, group.name]));
    if (!clubIds.length) return;
    const { data, error: loadError } = await fetchOfficialEvents(supabase, clubIds, clubNameById);
    if (loadError) {
      logOfficialEventListError(loadError);
      setError("公式試合一覧の取得に失敗しました");
      return;
    }
    setError("");
    setEvents(data);
  };

  const shareUrl = (event: OfficialEvent) => event.share_enabled && event.share_token ? `${typeof window === "undefined" ? "" : window.location.origin}/share/official-events/${event.share_token}` : "";
  const updateShare = async (event: OfficialEvent, action: "create" | "stop" | "rotate") => {
    setError(""); setNotice("");
    if (action !== "stop" && event.status !== "closed") return setError("終了済みの公式試合のみ共有できます");
    if (!manageableClubIds.includes(event.club_id)) return setError("この操作を行う権限がありません");
    const supabase = getSupabaseClient(); if (!supabase) return;
    const patch = action === "stop" ? { share_enabled: false, share_token: null, share_token_updated_at: new Date().toISOString() } : { share_enabled: true, share_token: createShareToken(), share_token_updated_at: new Date().toISOString() };
    const { error: updateError } = await supabase.from("official_events").update(patch).eq("id", event.id);
    if (updateError) return setError("共有リンクの更新に失敗しました");
    setNotice(action === "stop" ? "共有を停止しました" : action === "rotate" ? "共有リンクを再発行しました" : "共有リンクを作成しました");
    await reloadEvents();
  };

  const copyShare = async (event: OfficialEvent) => {
    setError(""); setNotice("");
    const url = shareUrl(event);
    if (!url) return setError("この公式試合は共有されていません");
    await navigator.clipboard.writeText(url);
    setNotice("共有リンクをコピーしました");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">公式試合一覧</h1>
      {canCreate && <Link href="/official-matches/new" className="rounded-xl bg-accent p-3 text-center font-bold text-black">公式試合を作成</Link>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-300">{notice}</p>}
      <Card title="公式試合">
        {events.length === 0 ? <p className="text-sm text-zinc-400">公式試合はまだありません</p> : (
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="rounded-xl bg-zinc-800 p-3">
                <p className="font-semibold">{event.title}</p>
                <p className="mt-1 text-xs text-zinc-300">所属グループ: {event.clubName}</p>
                <p className="text-xs text-zinc-300">開催日: {event.event_date ?? "未定"}</p>
                <p className="text-xs text-zinc-300">ステータス: {officialStatusLabel(event.status)}</p>
                <div className="mt-3 grid grid-cols-1 gap-2"><Link href={`/official-matches/${event.id}`} className="block rounded-xl border border-zinc-600 py-2 text-center text-sm">詳細</Link>{event.status === "closed" && !shareUrl(event) && manageableClubIds.includes(event.club_id) && <button className="rounded-xl border border-zinc-600 py-2 text-sm" onClick={() => void updateShare(event, "create")}>共有リンクを作成</button>}{shareUrl(event) && <button className="rounded-xl border border-zinc-600 py-2 text-sm" onClick={() => void copyShare(event)}>共有リンクをコピー</button>}{shareUrl(event) && manageableClubIds.includes(event.club_id) && <button className="rounded-xl border border-zinc-600 py-2 text-sm" onClick={() => void updateShare(event, "rotate")}>共有リンクを再発行</button>}{shareUrl(event) && manageableClubIds.includes(event.club_id) && <button className="rounded-xl border border-red-500/70 py-2 text-sm text-red-200" onClick={() => void updateShare(event, "stop")}>共有を停止</button>}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Link href="/home" className="text-center text-sm underline">イベント作成・閲覧へ戻る</Link>
    </main>
  );
}
