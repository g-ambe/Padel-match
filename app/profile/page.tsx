"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { ProfileLinkRequests } from "@/components/profile-link-requests";
import { hasEnteredFriendlyMatchScore } from "@/lib/friendly-match-results";
import { fetchCountedFriendlyEvents, readStatsRows } from "@/lib/stats-history";
import type { SupabaseClient } from "@supabase/supabase-js";
import { choosePlayerProfile, ensureLinkedPlayerProfile, fetchLinkedPlayerProfiles, fetchProfileUsage, preferredPlayerProfileId, profileDetailCount, profileErrorMessage, rememberPlayerProfile, saveLinkedPlayerProfile, type PlayerProfile, type ProfileUsage } from "@/lib/player-profiles";

const PLAY_LEVEL_OPTIONS = ["初級", "初中級", "中級", "中上級", "上級"] as const;
const DOMINANT_HAND_OPTIONS = ["右", "左"] as const;
const PREFERRED_POSITION_OPTIONS = ["フォア", "バック", "両方"] as const;

type ProfileForm = {
  display_name: string;
  bio: string;
  play_level: string;
  dominant_hand: string;
  preferred_position: string;
  activity_area: string;
};

type ProfileStats = {
  matches: number;
  wins: number;
  winRate: number;
  avgScored: number;
  avgConceded: number;
};

const emptyForm: ProfileForm = {
  display_name: "",
  bio: "",
  play_level: "",
  dominant_hand: "",
  preferred_position: "",
  activity_area: ""
};

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [draft, setDraft] = useState<ProfileForm>(emptyForm);
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [stats, setStats] = useState<ProfileStats | null>(null);

  const hasGroup = useMemo(() => groupNames.length > 0, [groupNames]);

  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [usage, setUsage] = useState<Map<string, ProfileUsage>>(new Map());
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const loadVersion = useRef(0);

  const loadProfile = async (preferredId?: string) => {
    const version = ++loadVersion.current;
    setError("");
    setMessage("");
    setLoading(true);
    setEditing(false);
    setCanCreate(false);
    setProfileId(null);
    try {
      const { getSupabaseClient, getSupabaseEnvErrorMessage } = await import("@/lib/supabase");
      const s = getSupabaseClient();
      if (!s) throw new Error(getSupabaseEnvErrorMessage() ?? "Supabase初期化に失敗しました");
      const { data: auth, error: authError } = await s.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) { router.replace("/"); return; }
      const uid = auth.user.id;
      const rows = await fetchLinkedPlayerProfiles(s, uid);
      let references = new Map<string, ProfileUsage>();
      let relatedError = "";
      try {
        references = await fetchProfileUsage(s, rows);
      } catch (cause) {
        console.error("プロフィールの所属・履歴確認に失敗しました", cause);
        relatedError = "所属・履歴の一部を確認できませんでした。選手の自動選択は行わず、保存済みのプロフィールを表示します";
      }
      const preferred = preferredId ?? preferredPlayerProfileId(uid);
      const selected = relatedError && rows.length > 1
        ? rows.find((row) => row.id === preferred) ?? null
        : choosePlayerProfile(rows, references, preferred);
      let profileStats: ProfileStats | null = null;
      if (rows.length) {
        try {
          profileStats = await loadProfileStats(s, rows, uid);
        } catch (cause) {
          console.error("プロフィールの戦績取得に失敗しました", cause);
          relatedError += `${relatedError ? "。" : ""}総合戦績を取得できませんでした`;
        }
      }
      if (version !== loadVersion.current) return;
      setOwnerId(uid);
      setProfiles(rows);
      setUsage(references);
      setGroupNames([...new Set([...references.values()].flatMap((entry) => entry.groups))]);
      setStats(profileStats);
      if (relatedError) setError(relatedError);
      if (selected) {
        if (rows.length === 1) rememberPlayerProfile(uid, selected.id);
        setProfileId(selected.id);
        setForm(toForm(selected));
        setDraft(toForm(selected));
      } else if (!rows.length) {
        setCanCreate(true);
        setDraft({ ...emptyForm, display_name: auth.user.user_metadata?.display_name ?? "" });
      }
    } catch (cause) {
      if (version !== loadVersion.current) return;
      console.error("プロフィール読み込みに失敗しました", cause);
      setProfiles([]);
      setGroupNames([]);
      setStats(null);
      setError(profileErrorMessage(cause));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfile();
    return () => { loadVersion.current += 1; };
  }, []);

  const createProfile = async () => {
    if (!ownerId || !canCreate || saving) return;
    if (!draft.display_name.trim()) return setError("表示名を入力してください");
    setSaving(true);
    setError("");
    try {
      const { getSupabaseClient } = await import("@/lib/supabase");
      const s = getSupabaseClient();
      if (!s) throw new Error("Supabase初期化に失敗しました");
      const { data, error: authError } = await s.auth.getUser();
      if (authError || data.user?.id !== ownerId) throw new Error("ログイン情報が変わりました");
      const created = await ensureLinkedPlayerProfile(s, ownerId, draft.display_name);
      rememberPlayerProfile(ownerId, created.id);
      await loadProfile(created.id);
    } catch (cause) {
      console.error("プロフィール作成に失敗しました", cause);
      setError(profileErrorMessage(cause));
    } finally { setSaving(false); }
  };

  const updateDraft = (key: keyof ProfileForm, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  const saveProfile = async () => {
    if (!profileId || !ownerId || saving) return;
    const expected = profiles.find((row) => row.id === profileId);
    if (!expected) return setError("対象のプロフィールを再読み込みしてください");
    const trimmedName = draft.display_name.trim();
    if (!trimmedName) return setError("表示名を入力してください");
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { getSupabaseClient } = await import("@/lib/supabase");
      const s = getSupabaseClient();
      if (!s) throw new Error("Supabase初期化に失敗しました");
      const saved = await saveLinkedPlayerProfile(s, ownerId, profileId, {
        display_name: trimmedName,
        bio: draft.bio.trim() || null,
        play_level: draft.play_level || null,
        dominant_hand: draft.dominant_hand || null,
        preferred_position: draft.preferred_position || null,
        activity_area: draft.activity_area.trim() || null
      }, expected);
      setForm(toForm(saved));
      setDraft(toForm(saved));
      setProfiles((rows) => rows.map((row) => row.id === saved.id ? saved : row));
      rememberPlayerProfile(ownerId, saved.id);
      setEditing(false);
      setMessage("プロフィールを更新しました");
    } catch (cause) {
      console.error("プロフィール保存に失敗しました", cause);
      setError(profileErrorMessage(cause));
    } finally { setSaving(false); }
  };

  const cancelEdit = () => {
    setDraft(form);
    setEditing(false);
    setError("");
    setMessage("");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <Card title="プロフィール">
        {profileId && <p className="mb-3 text-xs text-emerald-300">本人の連携プロフィールです。連携申請の承認後、他グループの所属・戦績もこの選手IDへ引き継ぎます。</p>}
        {profiles.length > 1 && !loading && <div className="mb-4 space-y-2 text-sm">
          <p className="text-amber-300">複数の有効な連携プロフィールがあります。表示する選手は選べますが、正規プロフィールの特定と新しい連携・統合は、本人の選択を管理者が確認するまで停止します。</p>
          <select aria-label="表示する選手プロフィール" className="w-full rounded-xl bg-zinc-800 p-3" value={profileId ?? ""} disabled={saving} onChange={(e) => {
            if (!e.target.value || !ownerId) return;
            rememberPlayerProfile(ownerId, e.target.value);
            void loadProfile(e.target.value);
          }}>
            <option value="">プロフィールを選択</option>
            {profiles.map((row, index) => {
              const references = usage.get(row.id);
              return <option key={row.id} value={row.id}>{index + 1}. {row.display_name}（設定{profileDetailCount(row)}項目 / {references ? `所属${references.memberships}件 / 参加${references.participants}件 / チーム戦${references.teamMatches + references.officialMatches}件` : "所属・履歴は未確認"}）</option>;
            })}
          </select>
          <p className="text-xs text-zinc-400">所属グループと総合戦績は、連携中の選手すべての記録を表示します。選手や試合の統合は行いません。</p>
        </div>}
        {loading ? <p className="text-sm text-zinc-300">読み込み中...</p> : profileId ? (
          <fieldset disabled={saving} className="space-y-3 text-sm">
            <ProfileField label="表示名" value={editing ? <input aria-label="表示名" className="w-full rounded-xl bg-zinc-800 p-3" value={draft.display_name} onChange={(e) => updateDraft("display_name", e.target.value)} /> : <p>{form.display_name || "未設定"}</p>} />
            <ProfileField label="自己紹介" value={editing ? <textarea aria-label="自己紹介" className="w-full rounded-xl bg-zinc-800 p-3" rows={3} placeholder="自己紹介を入力" value={draft.bio} onChange={(e) => updateDraft("bio", e.target.value)} /> : <p className="whitespace-pre-wrap">{form.bio || "未設定"}</p>} />
            <ProfileField label="プレイレベル" value={editing ? <select aria-label="プレイレベル" className="w-full rounded-xl bg-zinc-800 p-3" value={draft.play_level} onChange={(e) => updateDraft("play_level", e.target.value)}><option value="">未設定</option>{PLAY_LEVEL_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}</select> : <p>{form.play_level || "未設定"}</p>} />
            <ProfileField label="利き手" value={editing ? <select aria-label="利き手" className="w-full rounded-xl bg-zinc-800 p-3" value={draft.dominant_hand} onChange={(e) => updateDraft("dominant_hand", e.target.value)}><option value="">未設定</option>{DOMINANT_HAND_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}</select> : <p>{form.dominant_hand || "未設定"}</p>} />
            <ProfileField label="ポジション" value={editing ? <select aria-label="ポジション" className="w-full rounded-xl bg-zinc-800 p-3" value={draft.preferred_position} onChange={(e) => updateDraft("preferred_position", e.target.value)}><option value="">未設定</option>{PREFERRED_POSITION_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}</select> : <p>{form.preferred_position || "未設定"}</p>} />
            <ProfileField label="主な活動地域" value={editing ? <input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="例: 東京都" value={draft.activity_area} onChange={(e) => updateDraft("activity_area", e.target.value)} /> : <p>{form.activity_area || "未設定"}</p>} />
            <ProfileField label="所属グループ" value={usage.size === 0 ? <p>所属を確認できていません</p> : hasGroup ? <div className="space-y-1">{groupNames.map((g) => <p key={g}>{g}</p>)}</div> : <p>未所属</p>} />

            {editing ? (
              <div className="flex gap-2">
                <button className="w-1/2 rounded-xl border border-zinc-600 py-2" disabled={saving} onClick={cancelEdit}>キャンセル</button>
                <button disabled={saving} className="w-1/2 rounded-xl bg-accent py-2 font-semibold text-black disabled:bg-zinc-600" onClick={() => void saveProfile()}>{saving ? "保存中..." : "保存"}</button>
              </div>
            ) : (
              <button className="w-full rounded-xl border border-zinc-600 py-2" onClick={() => setEditing(true)}>編集</button>
            )}
          </fieldset>
        ) : canCreate ? <div className="space-y-3 text-sm">
          <p>プロフィールはまだ登録されていません</p>
          <input aria-label="表示名" disabled={saving} className="w-full rounded-xl bg-zinc-800 p-3" placeholder="表示名" value={draft.display_name} onChange={(e) => updateDraft("display_name", e.target.value)} />
          <button disabled={saving} className="w-full rounded-xl bg-accent py-2 font-semibold text-black disabled:bg-zinc-600" onClick={() => void createProfile()}>{saving ? "作成中..." : "プロフィールを作成"}</button>
        </div> : null}
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
        {message && <p role="status" className="mt-3 text-sm text-emerald-400">{message}</p>}
        {!loading && <button disabled={saving} className="mt-3 text-sm text-zinc-300 underline" onClick={() => void loadProfile()}>再読み込み</button>}
      </Card>

      <Card title="連携申請"><ProfileLinkRequests /></Card>

      <Card title="総合戦績">
        {loading ? <p className="text-sm text-zinc-300">読み込み中...</p> : stats ? (
          <div className="space-y-2 text-sm">
            <p>試合数: {stats.matches}</p>
            <p>勝利数: {stats.wins}</p>
            <p>勝率: {stats.winRate.toFixed(1)}%</p>
            <p>平均得点: {stats.avgScored.toFixed(1)}</p>
            <p>平均失点: {stats.avgConceded.toFixed(1)}</p>
          </div>
        ) : <p className="text-sm text-zinc-400">戦績を読み込めていません</p>}
      </Card>
    </main>
  );
}

function ProfileField({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="mb-1 text-xs text-zinc-400">{label}</p>{value}</div>;
}

function toForm(profile: PlayerProfile): ProfileForm {
  return {
    display_name: profile.display_name ?? "", bio: profile.bio ?? "", play_level: profile.play_level ?? "",
    dominant_hand: profile.dominant_hand ?? "", preferred_position: profile.preferred_position ?? "", activity_area: profile.activity_area ?? ""
  };
}

type ProfileMatchRow = { team: string; matches: { id: string; event_id: string; completed: boolean; match_results: { score_a: number; score_b: number; winner_team: string }[] } | null };

async function loadProfileStats(s: SupabaseClient, profiles: PlayerProfile[], userId: string): Promise<ProfileStats> {
  const profileIds = profiles.map((profile) => profile.id);
  const participants = await readStatsRows<{ id: string; event_id: string }>((start, end) => s.from("event_participants").select("id,event_id")
    .or(`player_profile_id.in.(${profileIds.join(",")}),profile_id.eq.${userId}`).eq("participant_type", "member").order("id").range(start, end));
  const eventIds = [...new Set(participants.map((participant) => participant.event_id))];
  const events = await fetchCountedFriendlyEvents(s, { eventIds });
  const closedIds = new Set(events.map(event => event.id));
  const seenMatches = new Set<string>();
  let wins = 0, scored = 0, conceded = 0;
  for (let index = 0; index < participants.length; index += 100) {
    const rows = await readStatsRows<ProfileMatchRow>((start, end) => s.from("match_players")
      .select("id,team,matches!inner(id,event_id,completed,match_results(score_a,score_b,winner_team))")
      .in("participant_id", participants.slice(index, index + 100).map((participant) => participant.id)).order("id").range(start, end).returns<ProfileMatchRow[]>());
    for (const row of rows) {
      const match = row.matches;
      if (!match || !closedIds.has(match.event_id) || seenMatches.has(match.id)) continue;
      const result = match.match_results?.[0];
      if (!hasEnteredFriendlyMatchScore({ completed: match.completed, result })) continue;
      seenMatches.add(match.id);
      scored += row.team === "A" ? result.score_a : result.score_b;
      conceded += row.team === "A" ? result.score_b : result.score_a;
      if (result.winner_team === row.team) wins += 1;
    }
  }
  const matches = seenMatches.size;
  return { matches, wins, winRate: matches ? wins / matches * 100 : 0, avgScored: matches ? scored / matches : 0, avgConceded: matches ? conceded / matches : 0 };
}
