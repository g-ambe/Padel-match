"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { clearGuestEvents, isGuestModeEnabled, listGuestEvents, resetGuestModeData, upsertGuestEvent, type EventMode, type GuestEvent } from "@/lib/guest-events";

type Group = { id: string; name: string };
type ClubRow = { id?: string | null; name?: string | null; is_active?: boolean | null; is_deleted?: boolean | null };
type EventRow = { id: string; name: string; court_count: number; club_id: string | null; club_name: string };

const logEventListError = (error: any) => {
  console.error("events list load failed", {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint
  });
};

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [courtCount, setCourtCount] = useState(2);
  const [eventMode, setEventMode] = useState<EventMode>("auto");
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [guestMode, setGuestModeState] = useState(false);

  const selectedGroupName = useMemo(() => groups.find((g) => g.id === selectedGroupId)?.name ?? "", [groups, selectedGroupId]);

  const loadHomeData = async () => {
    const showGuestHome = () => {
      setGuestModeState(true);
      const guestEvents = listGuestEvents();
      setGroups([]);
      setSelectedGroupId("");
      setEvents(
        guestEvents.map((e) => ({
          id: e.id,
          name: `${e.name}（ゲストモード・一時保存）`,
          court_count: e.court_count,
          club_id: null,
          club_name: "グループなし"
        }))
      );
    };

    const { getSupabaseClient, getSupabaseEnvErrorMessage } = await import("@/lib/supabase");
    const supabase = getSupabaseClient();
    if (!supabase) {
      if (isGuestModeEnabled()) {
        showGuestHome();
        return;
      }
      setError(getSupabaseEnvErrorMessage() ?? "Supabase初期化に失敗しました");
      return;
    }

    const { data: sessionRes } = await supabase.auth.getSession();
    if (sessionRes.session) {
      resetGuestModeData();
      setGuestModeState(false);
    } else if (isGuestModeEnabled()) {
      showGuestHome();
      return;
    }

    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) {
      setError("ログイン情報を確認できません");
      return;
    }

    const isMissingColumnError = (error: any, column: string) => {
      const message = `${error?.message ?? ""} ${error?.details ?? ""}`;
      return error?.code === "42703" || message.includes(column);
    };

    const isSuperUser = async () => {
      const { data } = await supabase
        .from("app_admins")
        .select("id")
        .eq("profile_id", userId)
        .eq("is_active", true)
        .maybeSingle();
      return !!data;
    };

    const loadActiveClubs = async (clubIds?: string[]): Promise<Group[]> => {
      const fetchClubs = async (select: string) => {
        let query: any = supabase.from("clubs").select(select).order("created_at", { ascending: true });
        if (clubIds) query = query.in("id", clubIds);
        return await query;
      };

      let { data, error } = await fetchClubs("id,name,is_active,is_deleted");
      if (error && isMissingColumnError(error, "is_deleted")) {
        const fallback = await fetchClubs("id,name,is_active");
        data = fallback.data;
        error = fallback.error;
      }
      if (error && isMissingColumnError(error, "is_active")) {
        const fallback = await fetchClubs("id,name");
        data = fallback.data;
        error = fallback.error;
      }
      if (error) {
        setError("グループ取得に失敗しました");
        return [];
      }

      return ((data ?? []) as ClubRow[])
        .filter((club) => club.is_active !== false && club.is_deleted !== true)
        .map((club): Group => ({ id: club.id ?? "", name: club.name ?? "" }))
        .filter((club): club is Group => Boolean(club.id && club.name));
    };

    const loadActiveMemberships = async (column: "player_profile_id" | "profile_id", ids: string[]) => {
      if (!ids.length) return [] as any[];

      const fetchMemberships = async (withStatus: boolean) => {
        let query: any = supabase
          .from("club_members")
          .select("club_id")
          .eq("is_active", true);
        query = ids.length === 1 ? query.eq(column, ids[0]) : query.in(column, ids);
        if (withStatus) query = query.eq("status", "active");
        return await query;
      };

      let { data, error } = await fetchMemberships(true);
      if (error && isMissingColumnError(error, "status")) {
        const fallback = await fetchMemberships(false);
        data = fallback.data;
        error = fallback.error;
      }
      if (error) {
        setError("所属グループ取得に失敗しました");
        return [] as any[];
      }
      return data ?? [];
    };

    const superUser = await isSuperUser();
    let groupRows: Group[] = [];
    if (superUser) {
      groupRows = await loadActiveClubs();
    } else {
      const { data: linkedProfiles } = await supabase
        .from("player_profiles")
        .select("id")
        .eq("linked_auth_user_id", userId);

      const linkedProfileIds = (linkedProfiles ?? []).map((p: any) => p.id).filter(Boolean);
      let memberships = await loadActiveMemberships("player_profile_id", linkedProfileIds);

      if (!memberships.length) {
        memberships = await loadActiveMemberships("profile_id", [userId]);
      }

      const groupIds: string[] = Array.from(
        new Set(
          memberships
            .map((m: any) => m.club_id)
            .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
        )
      );
      groupRows = groupIds.length ? await loadActiveClubs(groupIds) : [];
    }

    setGroups(groupRows);
    setSelectedGroupId((current) => (current && groupRows.some((g) => g.id === current) ? current : groupRows.length === 1 ? groupRows[0].id : ""));

    const groupIds = groupRows.map((g) => g.id);
    const clubNameById = new Map(groupRows.map((group) => [group.id, group.name]));
    const eventSelect = "id,name,court_count,club_id,clubs(name)";
    let eventQuery: any = supabase
      .from("events")
      .select(eventSelect)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(20);

    if (superUser) {
      // super_user は既存仕様どおり取得可能なイベントを全件表示します。
    } else if (groupIds.length > 0) {
      eventQuery = eventQuery.or(`club_id.in.(${groupIds.join(",")}),and(club_id.is.null,created_by_auth_user_id.eq.${userId})`);
    } else {
      eventQuery = eventQuery.is("club_id", null).eq("created_by_auth_user_id", userId);
    }

    const { data: ev, error: eventError } = await eventQuery;
    if (eventError) {
      logEventListError(eventError);
      setError("開催一覧の取得に失敗しました");
      setEvents([]);
      return;
    }

    setEvents(
      (ev ?? []).map((e: any) => ({
        id: e.id,
        name: e.name,
        court_count: e.court_count,
        club_id: e.club_id,
        club_name: e.clubs?.name ?? (e.club_id ? clubNameById.get(e.club_id) ?? "名称未設定" : "グループなし")
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
        event_mode: eventMode,
        stats_mode: eventMode === "manual" ? "undecided" : "official",
        participants: [],
        matches: [],
        created_at: new Date().toISOString()
      };
      upsertGuestEvent(event);
      setLoading(false);
      setName("");
      setCourtCount(2);
      setEventMode("auto");
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

    const { data: userResult } = await supabase.auth.getUser();
    const creatorUserId = userResult.user?.id;
    if (!creatorUserId) {
      setLoading(false);
      setError("ログイン情報を確認できません");
      return;
    }

    const { data, error: insertError } = await supabase
      .from("events")
      .insert({
        name: name.trim(),
        court_count: courtCount,
        category: "club",
        club_id: selectedGroupId || null,
        event_mode: eventMode,
        stats_mode: eventMode === "manual" ? "undecided" : "official",
        created_by_auth_user_id: creatorUserId
      })
      .select("id")
      .single();

    if (insertError || !data?.id) {
      setLoading(false);
      setError("開催の作成に失敗しました");
      return;
    }

    try {
      const { addCreatorToNoGroupEvent, addMissingClubMembersToEvent } = await import("@/lib/event-participants");
      if (selectedGroupId) {
        await addMissingClubMembersToEvent(supabase, data.id, selectedGroupId);
      } else {
        await addCreatorToNoGroupEvent(supabase, data.id, creatorUserId);
      }
    } catch {
      setLoading(false);
      setError(selectedGroupId ? "グループメンバーの参加者追加に失敗しました" : "作成者の参加者追加に失敗しました");
      return;
    }

    setLoading(false);
    setName("");
    setCourtCount(2);
    setEventMode("auto");
    router.push(`/events/${data.id}`);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">イベント作成・閲覧</h1>
      {guestMode && (
        <Card title="ゲストモード">
          <p className="text-sm text-zinc-300">ゲストモードではデータは一時保存です</p>
          <p className="mt-1 text-xs text-zinc-400">ログインするとイベントや戦績を保存できます</p>
        </Card>
      )}
      <div id="random-events"><Card title="フレンドリーマッチを作成">
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
          <label className="block space-y-1 text-sm">
            <span className="text-zinc-300">対戦作成方式</span>
            <select className="w-full rounded-xl bg-zinc-800 p-3" value={eventMode} onChange={(e) => setEventMode(e.target.value as EventMode)}>
              <option value="auto">自動生成</option>
              <option value="manual">手動作成</option>
            </select>
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" className="w-full rounded-xl bg-accent py-3 font-semibold text-black" disabled={loading}>
            {loading ? "作成中..." : "作成"}
          </button>
        </form>
      </Card></div>

      <Card title="フレンドリーマッチ一覧">
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
      {guestMode && (
        <Card title="終了">
          <p className="mb-2 text-xs text-amber-300">TOPへ戻るとゲストイベントの一時データは削除されます</p>
          <button
            type="button"
            className="w-full rounded-xl border border-zinc-600 py-3 text-sm"
            onClick={() => {
              clearGuestEvents();
              setName("");
              setCourtCount(2);
              setEventMode("auto");
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
