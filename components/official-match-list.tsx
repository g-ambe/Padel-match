"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { createShareToken, getOfficialAccess, officialStatusLabel } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";

type OfficialEventRow = { id: string; club_id: string | null; title: string; event_date: string | null; status: string; is_deleted?: boolean | null; share_enabled?: boolean | null; share_token?: string | null };
type OfficialEvent = OfficialEventRow & { clubName: string };

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

async function fetchOfficialEvents(supabase: ReturnType<typeof getSupabaseClient>, clubIds: string[], clubNameById: Map<string, string>, uid: string, superUser: boolean) {
  if (!supabase || !uid) return { data: [] as OfficialEvent[], error: null as any };
  const applyScope = (query: any) => {
    if (superUser) return query;
    if (clubIds.length > 0) return query.or(`club_id.in.(${clubIds.join(",")}),and(club_id.is.null,created_by_auth_user_id.eq.${uid})`);
    return query.is("club_id", null).eq("created_by_auth_user_id", uid);
  };
  const run = async (select: string) => applyScope(supabase.from("official_events").select(select).eq("is_deleted", false).order("created_at", { ascending: false }));
  let { data, error } = await run("id,club_id,title,event_date,status,is_deleted,share_enabled,share_token");
  if (error && (missingColumn(error, "share_enabled") || missingColumn(error, "share_token"))) {
    ({ data, error } = await run("id,club_id,title,event_date,status"));
  }
  if (error) return { data: [] as OfficialEvent[], error };
  const rows = (data ?? []) as unknown as OfficialEventRow[];
  return {
    data: rows.map((event) => ({ ...event, clubName: event.club_id ? clubNameById.get(event.club_id) ?? "名称未設定" : "グループなし" })),
    error: null as any
  };
}

type OfficialMatchListProps = {
  showCreateLink?: boolean;
  showBackLink?: boolean;
};

export function OfficialMatchList({ showCreateLink = false, showBackLink = false }: OfficialMatchListProps) {
  const [events, setEvents] = useState<OfficialEvent[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manageableClubIds, setManageableClubIds] = useState<string[]>([]);

  useEffect(() => {
    void loadEvents();
  }, []);

  const loadEvents = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const access = await getOfficialAccess(supabase);
    const clubIds = access.groups.map((group) => group.id);
    const clubNameById = new Map(access.groups.map((group) => [group.id, group.name]));
    setCanCreate(!!access.uid);
    setManageableClubIds(access.superUser ? clubIds : access.groups.filter((group) => group.role === "main_admin" || group.role === "sub_admin").map((group) => group.id));
    const { data, error: loadError } = await fetchOfficialEvents(supabase, clubIds, clubNameById, access.uid, access.superUser);
    if (loadError) {
      logOfficialEventListError(loadError);
      setError("オフィシャルチームマッチ一覧の取得に失敗しました");
      return;
    }
    setError("");
    setEvents(data);
  };

  const shareUrl = (event: OfficialEvent) => event.share_enabled && event.share_token ? `${typeof window === "undefined" ? "" : window.location.origin}/share/official-events/${event.share_token}` : "";
  const canManageEvent = (event: OfficialEvent) => !!event.club_id && manageableClubIds.includes(event.club_id);
  const updateShare = async (event: OfficialEvent, action: "create" | "stop" | "rotate") => {
    setError(""); setNotice("");
    if (action !== "stop" && event.status !== "closed") return setError("終了済みのオフィシャルチームマッチのみ共有できます");
    if (!canManageEvent(event)) return setError("この操作を行う権限がありません");
    const supabase = getSupabaseClient(); if (!supabase) return;
    const patch = action === "stop" ? { share_enabled: false, share_token: null, share_token_updated_at: new Date().toISOString() } : { share_enabled: true, share_token: createShareToken(), share_token_updated_at: new Date().toISOString() };
    const { error: updateError } = await supabase.from("official_events").update(patch).eq("id", event.id);
    if (updateError) return setError("共有リンクの更新に失敗しました");
    setNotice(action === "stop" ? "共有を停止しました" : action === "rotate" ? "共有リンクを再発行しました" : "共有リンクを作成しました");
    await loadEvents();
  };

  const copyShare = async (event: OfficialEvent) => {
    setError(""); setNotice("");
    const url = shareUrl(event);
    if (!url) return setError("このオフィシャルチームマッチは共有されていません");
    await navigator.clipboard.writeText(url);
    setNotice("共有リンクをコピーしました");
  };

  return (
    <>
      {showCreateLink && canCreate && <Link href="/official-matches/new" className="rounded-xl bg-accent p-3 text-center font-bold text-black">オフィシャルチームマッチを作成</Link>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-300">{notice}</p>}
      <Card title="オフィシャルチームマッチ一覧">
        {events.length === 0 ? <p className="text-sm text-zinc-400">オフィシャルチームマッチはまだありません</p> : (
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="rounded-xl bg-zinc-800 p-3">
                <p className="font-semibold">{event.title}</p>
                <p className="mt-1 text-xs text-zinc-300">所属グループ名: {event.clubName}</p>
                <p className="text-xs text-zinc-300">開催日: {event.event_date ?? "未定"}</p>
                <p className="text-xs text-zinc-300">ステータス: {officialStatusLabel(event.status)}</p>
                <div className="mt-3 grid grid-cols-1 gap-2"><Link href={`/official-matches/${event.id}`} className="block rounded-xl border border-zinc-600 py-2 text-center text-sm">詳細</Link>{event.status === "closed" && !shareUrl(event) && canManageEvent(event) && <button className="rounded-xl border border-zinc-600 py-2 text-sm" onClick={() => void updateShare(event, "create")}>共有リンクを作成</button>}{shareUrl(event) && <button className="rounded-xl border border-zinc-600 py-2 text-sm" onClick={() => void copyShare(event)}>共有リンクをコピー</button>}{shareUrl(event) && canManageEvent(event) && <button className="rounded-xl border border-zinc-600 py-2 text-sm" onClick={() => void updateShare(event, "rotate")}>共有リンクを再発行</button>}{shareUrl(event) && canManageEvent(event) && <button className="rounded-xl border border-red-500/70 py-2 text-sm text-red-200" onClick={() => void updateShare(event, "stop")}>共有を停止</button>}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {showBackLink && <Link href="/home" className="text-center text-sm underline">イベント作成・閲覧へ戻る</Link>}
    </>
  );
}
