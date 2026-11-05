"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { loadFriendlyEventAccess } from "@/lib/friendly-event-access";
import { isGuestModeEnabled, resetGuestModeData, upsertGuestEvent, type EventMode, type GuestEvent } from "@/lib/guest-events";

type Group = { id: string; name: string };

export function FriendlyEventCreate() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [courtCount, setCourtCount] = useState(2);
  const [eventMode, setEventMode] = useState<EventMode>("auto");
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [guestMode, setGuestModeState] = useState(false);
  const [ready, setReady] = useState(false);

  const selectedGroupName = useMemo(() => groups.find((g) => g.id === selectedGroupId)?.name ?? "", [groups, selectedGroupId]);

  const loadHomeData = async () => {
    const showGuestHome = () => {
      setGuestModeState(true);
      setGroups([]);
      setSelectedGroupId("");
      setReady(true);
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

    try {
      const { groups: groupRows } = await loadFriendlyEventAccess(supabase);
      setGroups(groupRows);
      const query = new URLSearchParams(window.location.search);
      const candidate = query.get("group");
      setSelectedGroupId(candidate && groupRows.some(group => group.id === candidate) ? candidate : "");
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "グループ取得に失敗しました");
    }
  };

  useEffect(() => {
    setEventMode(new URLSearchParams(window.location.search).get("mode") === "manual" ? "manual" : "auto");
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

    if (!selectedGroupId) {
      try {
        const { preferredPlayerProfileId, resolveLinkedPlayerProfile } = await import("@/lib/player-profiles");
        await resolveLinkedPlayerProfile(supabase, creatorUserId, preferredPlayerProfileId(creatorUserId));
      } catch (cause) {
        const { profileErrorMessage } = await import("@/lib/player-profiles");
        setLoading(false);
        setError(profileErrorMessage(cause));
        return;
      }
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
      <h1 className="pr-14 text-xl font-bold">組み合わせ戦を作成</h1>
      <p className="text-sm text-zinc-300">開催情報と作成先を確認してください。</p>
      {guestMode && <p className="text-sm text-amber-300">ゲストの試合はこのブラウザに一時保存されます。</p>}
      <div id="random-events"><Card title="フレンドリーマッチを作成">
        <form className="space-y-3" onSubmit={event => { if (ready) void createEvent(event); else event.preventDefault(); }}>
          {!guestMode && (
            <>
              <select aria-label="作成先グループ" disabled={!ready || loading} className="w-full rounded-xl bg-zinc-800 p-3" value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
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
            aria-label="開催名"
            placeholder="開催名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select aria-label="コート数" className="w-full rounded-xl bg-zinc-800 p-3" value={courtCount} onChange={(e) => setCourtCount(Number(e.target.value))}>
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
          {!ready && error && <button type="button" className="min-h-11 w-full rounded-xl border border-zinc-600 p-3 text-sm" onClick={() => { setError(""); void loadHomeData(); }}>作成先を再読み込み</button>}
          <button type="submit" className="w-full rounded-xl bg-accent py-3 font-semibold text-black" disabled={loading || !ready}>
            {loading ? "作成中..." : !ready ? "作成先を確認中..." : "作成"}
          </button>
        </form>
      </Card></div>

      <button type="button" className="min-h-11 rounded-xl border border-zinc-600 p-3 text-sm" onClick={() => router.push("/home")}>試合トップへ戻る</button>
    </main>
  );
}
