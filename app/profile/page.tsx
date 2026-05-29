"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

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
  const [stats, setStats] = useState<ProfileStats>({ matches: 0, wins: 0, winRate: 0, avgScored: 0, avgConceded: 0 });

  const hasGroup = useMemo(() => groupNames.length > 0, [groupNames]);

  const loadProfile = async () => {
    setError("");
    setMessage("");
    setLoading(true);
    const { getSupabaseClient, getSupabaseEnvErrorMessage } = await import("@/lib/supabase");
    const s = getSupabaseClient();
    if (!s) {
      setError(getSupabaseEnvErrorMessage() ?? "Supabase初期化に失敗しました");
      setLoading(false);
      return;
    }

    const { data: sess } = await s.auth.getSession();
    const uid = sess.session?.user?.id;
    if (!uid) {
      router.replace("/");
      return;
    }

    let playerProfile = await s.from("player_profiles").select("id,display_name,bio,play_level,dominant_hand,preferred_position,activity_area").eq("linked_auth_user_id", uid).maybeSingle();

    if (!playerProfile.data?.id) {
      const { data: prof } = await s.from("profiles").select("display_name").eq("id", uid).maybeSingle();
      const fallbackName = (prof?.display_name ?? "名称未設定").trim() || "名称未設定";
      const { data: created, error: createErr } = await s.from("player_profiles").insert({ display_name: fallbackName, linked_auth_user_id: uid, is_active: true }).select("id,display_name,bio,play_level,dominant_hand,preferred_position,activity_area").single();
      if (createErr || !created?.id) {
        setError("プロフィールの作成に失敗しました");
        setLoading(false);
        return;
      }
      playerProfile = { data: created, error: null, count: null, status: 201, statusText: "Created" } as any;
    }

    const row = playerProfile.data;
    if (!row) {
      setError("プロフィールの読み込みに失敗しました");
      setLoading(false);
      return;
    }

    setProfileId(row.id);
    const normalized: ProfileForm = {
      display_name: row.display_name ?? "",
      bio: row.bio ?? "",
      play_level: row.play_level ?? "",
      dominant_hand: row.dominant_hand ?? "",
      preferred_position: row.preferred_position ?? "",
      activity_area: row.activity_area ?? ""
    };
    setForm(normalized);
    setDraft(normalized);

    const { data: memberships } = await s.from("club_members").select("clubs(name)").eq("player_profile_id", row.id).eq("is_active", true).eq("clubs.is_active", true);
    setGroupNames((memberships ?? []).map((m: any) => m.clubs?.name).filter(Boolean));

    const { data: participants } = await s.from("event_participants").select("id,event_id").eq("player_profile_id", row.id).eq("participant_type", "member");
    const participantIds = (participants ?? []).map((p: any) => p.id);
    const eventIds = [...new Set((participants ?? []).map((p: any) => p.event_id).filter(Boolean))];

    const { data: closedEvents } = eventIds.length
      ? await s.from("events").select("id").in("id", eventIds).eq("status", "closed").eq("is_deleted", false).eq("stats_mode", "official")
      : { data: [] as any[] };
    const closedIds = new Set((closedEvents ?? []).map((e: any) => e.id));

    const { data: matchRows } = participantIds.length
      ? await s.from("match_players").select("match_id,participant_id,team,matches!inner(id,event_id,match_results(score_a,score_b,winner_team))").in("participant_id", participantIds)
      : { data: [] as any[] };

    let matches = 0;
    let wins = 0;
    let scored = 0;
    let conceded = 0;

    for (const mp of matchRows ?? []) {
      const m = mp.matches;
      if (!m || !closedIds.has(m.event_id)) continue;
      const result = m.match_results?.[0];
      if (!result) continue;
      matches += 1;
      const myTeam = mp.team;
      const myScore = myTeam === "A" ? result.score_a : result.score_b;
      const opScore = myTeam === "A" ? result.score_b : result.score_a;
      scored += myScore ?? 0;
      conceded += opScore ?? 0;
      if (result.winner_team === myTeam) wins += 1;
    }

    const winRate = matches > 0 ? (wins / matches) * 100 : 0;
    setStats({
      matches,
      wins,
      winRate,
      avgScored: matches > 0 ? scored / matches : 0,
      avgConceded: matches > 0 ? conceded / matches : 0
    });

    setLoading(false);
  };

  useEffect(() => {
    void loadProfile();
  }, []);

  const updateDraft = (key: keyof ProfileForm, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  const saveProfile = async () => {
    if (!profileId) return;
    const trimmedName = draft.display_name.trim();
    if (!trimmedName) {
      setError("表示名を入力してください");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    const { getSupabaseClient, getSupabaseEnvErrorMessage } = await import("@/lib/supabase");
    const s = getSupabaseClient();
    if (!s) {
      setError(getSupabaseEnvErrorMessage() ?? "Supabase初期化に失敗しました");
      setSaving(false);
      return;
    }

    const payload = {
      display_name: trimmedName,
      bio: draft.bio.trim() || null,
      play_level: draft.play_level || null,
      dominant_hand: draft.dominant_hand || null,
      preferred_position: draft.preferred_position || null,
      activity_area: draft.activity_area.trim() || null
    };

    const { error: updateErr } = await s.from("player_profiles").update(payload).eq("id", profileId);
    if (updateErr) {
      setError("プロフィールの更新に失敗しました");
      setSaving(false);
      return;
    }

    setForm({
      display_name: payload.display_name,
      bio: payload.bio ?? "",
      play_level: payload.play_level ?? "",
      dominant_hand: payload.dominant_hand ?? "",
      preferred_position: payload.preferred_position ?? "",
      activity_area: payload.activity_area ?? ""
    });
    setEditing(false);
    setSaving(false);
    setMessage("プロフィールを更新しました");
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
        {loading ? <p className="text-sm text-zinc-300">読み込み中...</p> : (
          <div className="space-y-3 text-sm">
            <ProfileField label="表示名" value={editing ? <input className="w-full rounded-xl bg-zinc-800 p-3" value={draft.display_name} onChange={(e) => updateDraft("display_name", e.target.value)} /> : <p>{form.display_name || "未設定"}</p>} />
            <ProfileField label="自己紹介" value={editing ? <textarea className="w-full rounded-xl bg-zinc-800 p-3" rows={3} placeholder="自己紹介を入力" value={draft.bio} onChange={(e) => updateDraft("bio", e.target.value)} /> : <p className="whitespace-pre-wrap">{form.bio || "未設定"}</p>} />
            <ProfileField label="プレイレベル" value={editing ? <select className="w-full rounded-xl bg-zinc-800 p-3" value={draft.play_level} onChange={(e) => updateDraft("play_level", e.target.value)}><option value="">未設定</option>{PLAY_LEVEL_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}</select> : <p>{form.play_level || "未設定"}</p>} />
            <ProfileField label="利き手" value={editing ? <select className="w-full rounded-xl bg-zinc-800 p-3" value={draft.dominant_hand} onChange={(e) => updateDraft("dominant_hand", e.target.value)}><option value="">未設定</option>{DOMINANT_HAND_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}</select> : <p>{form.dominant_hand || "未設定"}</p>} />
            <ProfileField label="ポジション" value={editing ? <select className="w-full rounded-xl bg-zinc-800 p-3" value={draft.preferred_position} onChange={(e) => updateDraft("preferred_position", e.target.value)}><option value="">未設定</option>{PREFERRED_POSITION_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}</select> : <p>{form.preferred_position || "未設定"}</p>} />
            <ProfileField label="主な活動地域" value={editing ? <input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="例: 東京都" value={draft.activity_area} onChange={(e) => updateDraft("activity_area", e.target.value)} /> : <p>{form.activity_area || "未設定"}</p>} />
            <ProfileField label="所属グループ" value={hasGroup ? <div className="space-y-1">{groupNames.map((g) => <p key={g}>{g}</p>)}</div> : <p>未所属</p>} />

            {error && <p className="text-sm text-red-400">{error}</p>}
            {message && <p className="text-sm text-emerald-400">{message}</p>}

            {editing ? (
              <div className="flex gap-2">
                <button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={cancelEdit}>キャンセル</button>
                <button disabled={saving} className="w-1/2 rounded-xl bg-accent py-2 font-semibold text-black disabled:bg-zinc-600" onClick={() => void saveProfile()}>{saving ? "保存中..." : "保存"}</button>
              </div>
            ) : (
              <button className="w-full rounded-xl border border-zinc-600 py-2" onClick={() => setEditing(true)}>編集</button>
            )}
          </div>
        )}
      </Card>

      <Card title="総合戦績">
        {loading ? <p className="text-sm text-zinc-300">読み込み中...</p> : (
          <div className="space-y-2 text-sm">
            <p>試合数: {stats.matches}</p>
            <p>勝利数: {stats.wins}</p>
            <p>勝率: {stats.winRate.toFixed(1)}%</p>
            <p>平均得点: {stats.avgScored.toFixed(1)}</p>
            <p>平均失点: {stats.avgConceded.toFixed(1)}</p>
          </div>
        )}
      </Card>
    </main>
  );
}

function ProfileField({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="mb-1 text-xs text-zinc-400">{label}</p>{value}</div>;
}
