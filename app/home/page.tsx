"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ActionButton } from "@/components/ui";
import { clearGuestEvents, isGuestModeEnabled, listGuestEvents, resetGuestModeData, upsertGuestEvent, type GuestEvent } from "@/lib/guest-events";

type Group = { id: string; name: string };
type EventRow = { id: string; name: string; court_count: number; club_id: string | null; club_name: string };

export default function HomePage() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [courtCount, setCourtCount] = useState(2);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [guestMode, setGuestModeState] = useState(false);

  const selectedGroupName = useMemo(() => groups.find((g) => g.id === selectedGroupId)?.name ?? "", [groups, selectedGroupId]);

  const loadHomeData = async () => {
    const { getSupabaseClient, getSupabaseEnvErrorMessage } = await import("@/lib/supabase");
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError(getSupabaseEnvErrorMessage() ?? "Supabase初期化に失敗しました");
      return;
    }
    const { data: sessionRes } = await supabase.auth.getSession();
    if (sessionRes.session) {
      resetGuestModeData();
      setGuestModeState(false);
    } else if (isGuestModeEnabled()) {
      setGuestModeState(true);
      const guestEvents = listGuestEvents();
      setGroups([]);
      setEvents(
        guestEvents.map((e) => ({
          id: e.id,
          name: `${e.name}（ゲストモード・一時保存）`,
          court_count: e.court_count,
          club_id: null,
          club_name: "グループなし"
        }))
      );
      return;
    }

    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) {
      setError("ログイン情報を確認できません");
      return;
    }

    const { data: linkedProfiles } = await supabase
      .from("player_profiles")
      .select("id")
      .eq("linked_auth_user_id", userId);

    const linkedProfileIds = (linkedProfiles ?? []).map((p: any) => p.id).filter(Boolean);

    let memberships: any[] = [];
    if (linkedProfileIds.length) {
      const { data } = await supabase
        .from("club_members")
        .select("club_id, clubs(id,name)")
        .in("player_profile_id", linkedProfileIds)
        .eq("is_active", true)
        .eq("clubs.is_active", true);
      memberships = data ?? [];
    }

    if (!memberships.length) {
      const { data } = await supabase
        .from("club_members")
        .select("club_id, clubs(id,name)")
        .eq("profile_id", userId)
        .eq("is_active", true)
        .eq("clubs.is_active", true);
      memberships = data ?? [];
    }

    const groupRows: Group[] = memberships
      .map((m: any) => ({ id: m.club_id as string, name: m.clubs?.name as string }))
      .filter((g) => g.id && g.name);

    setGroups(groupRows);
    if (groupRows.length === 1) setSelectedGroupId(groupRows[0].id);

    const groupIds = groupRows.map((g) => g.id);
    if (groupIds.length === 0) {
      setEvents([]);
      return;
    }

    const { data: ev } = await supabase
      .from("events")
      .select("id,name,court_count,club_id,clubs(name)")
      .in("club_id", groupIds)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(20);

    setEvents(
      (ev ?? []).map((e: any) => ({
        id: e.id,
        name: e.name,
        court_count: e.court_count,
        club_id: e.club_id,
        club_name: e.clubs?.name ?? "グループなし"
      }))
    );
  };

  useEffect(() => {
    void loadHomeData();
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      const { getSupabaseClient } = await import("@/lib/supabase");
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        resetGuestModeData();
        setGuestModeState(false);
        return;
      }
      if (!isGuestModeEnabled()) router.replace("/");
    };
    void checkAuth();
  }, [router]);

  const createEvent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (!name.trim() || courtCount < 1) {
      setError("開催名・コート数を入力してください");
      return;
    }

    setLoading(true);
    if (guestMode) {
      const event: GuestEvent = {
        id: `guest_${Date.now()}`,
        name: name.trim(),
        court_count: courtCount,
        status: "active",
        participants: [],
        matches: [],
        created_at: new Date().toISOString()
      };
      upsertGuestEvent(event);
      setLoading(false);
      setOpen(false);
      setName("");
      setCourtCount(2);
      router.push(`/events/${event.id}`);
      return;
    }
    const { getSupabaseClient, getSupabaseEnvErrorMessage } = await import("@/lib/supabase");
    const supabase = getSupabaseClient();

    if (!supabase) {
      setLoading(false);
      setError(getSupabaseEnvErrorMessage() ?? "Supabase初期化に失敗しました");
      return;
    }

    const { data, error: insertError } = await supabase
      .from("events")
      .insert({
        name: name.trim(),
        court_count: courtCount,
        category: "club",
        club_id: selectedGroupId || null
      })
      .select("id")
      .single();

    setLoading(false);

    if (insertError || !data?.id) {
      setError("開催の作成に失敗しました");
      return;
    }

    setOpen(false);
    setName("");
    setCourtCount(2);
    router.push(`/events/${data.id}`);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">イベント</h1>
      {guestMode && (
        <Card title="ゲストモード">
          <p className="text-sm text-zinc-300">ゲストモードではデータは一時保存です</p>
          <p className="mt-1 text-xs text-zinc-400">ログインするとイベントや戦績を保存できます</p>
        </Card>
      )}
      <ActionButton onClick={() => setOpen(true)}>イベント作成</ActionButton>

      {open && (
        <Card title="イベント作成フォーム">
          <form className="space-y-3" onSubmit={createEvent}>
            {!guestMode && (
              <>
                <select className="w-full rounded-xl bg-zinc-800 p-3" value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
                  <option value="">グループなし</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <p className="text-xs text-zinc-300">選択中グループ: {selectedGroupName || "グループなし"}</p>
              </>
            )}
            <input
              className="w-full rounded-xl bg-zinc-800 p-3"
              placeholder="開催名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select className="w-full rounded-xl bg-zinc-800 p-3" value={courtCount} onChange={(e) => setCourtCount(Number(e.target.value))}>
              {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}面</option>)}
            </select>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button type="button" className="w-1/2 rounded-xl border border-zinc-600 py-3" onClick={() => setOpen(false)}>
                キャンセル
              </button>
              <button type="submit" className="w-1/2 rounded-xl bg-accent py-3 font-semibold text-black" disabled={loading}>
                {loading ? "作成中..." : "作成"}
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card title="イベント一覧">
        <div className={`space-y-2 ${showAllEvents ? "max-h-80 overflow-y-auto pr-1" : ""}`}>
          {events.length === 0 ? (
            <p className="rounded-xl bg-zinc-800 p-3 text-sm text-zinc-300">開催がありません</p>
          ) : (
            (showAllEvents ? events : events.slice(0, 5)).map((ev) => (
              <Link key={ev.id} href={`/events/${ev.id}`} className="block rounded-xl bg-zinc-800 p-3">
                <p className="font-semibold">{ev.name}</p>
                <p className="text-xs text-zinc-300">{ev.club_name} / コート{ev.court_count}面</p>
              </Link>
            ))
          )}
        </div>
        {events.length > 5 && <div className="mt-3">{showAllEvents ? <button className="w-full rounded-xl border border-zinc-600 py-2 text-sm" onClick={() => setShowAllEvents(false)}>閉じる</button> : <button className="w-full rounded-xl border border-zinc-600 py-2 text-sm" onClick={() => setShowAllEvents(true)}>すべて表示</button>}</div>}
      </Card>
      {guestMode && !open && (
        <Card title="終了">
          <p className="mb-2 text-xs text-amber-300">TOPへ戻るとゲストイベントの一時データは削除されます</p>
          <button
            type="button"
            className="w-full rounded-xl border border-zinc-600 py-3 text-sm"
            onClick={() => {
              clearGuestEvents();
              setName("");
              setCourtCount(2);
              setOpen(false);
              router.push("/");
            }}
          >
            TOPへ戻る
          </button>
        </Card>
      )}
    </main>
  );
}
