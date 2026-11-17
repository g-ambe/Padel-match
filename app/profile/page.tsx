"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProfileMediaPanel } from "@/components/profile-media-panel";
import { ProfileHomeCourtField } from "@/components/profile-home-court-field";
import type { HomeCourtSelection } from "@/lib/padel-facilities";
import { BROAD_ACTIVITY_AREAS,PREFECTURES,legacyActivityArea,homeCourtName } from "@/lib/profile-options";
import { Card } from "@/components/ui";
import { ProfileGroups } from "@/components/profile-groups";
import { AppDialog } from "@/components/app-dialog";
import { ProfileAvatar } from "@/components/profile-avatar";
import { ProfilePhotoEditor } from "@/components/profile-photo-editor";
import { useProfileMedia } from "@/components/profile-media-provider";
import { avatarPosition } from "@/lib/profile-media/position";
import { instagramUsername } from "@/lib/profile-media/shared";
import { firstMatchResult, hasEnteredFriendlyMatchScore, type EmbeddedMatchResults } from "@/lib/friendly-match-results";
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
  const [stats, setStats] = useState<ProfileStats | null>(null);


  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [usage, setUsage] = useState<Map<string, ProfileUsage>>(new Map());
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const loadVersion = useRef(0);
  const media = useProfileMedia(ownerId, profileId);
  const [photoView,setPhotoView]=useState(false),[photoSaving,setPhotoSaving]=useState(false);
  const [instagram,setInstagram]=useState("");
  const igBaseline=useRef({username:"",version:0});
  const photoButton=useRef<HTMLButtonElement>(null);
  const igLoaded=useRef(false);
  const [statsOpen,setStatsOpen]=useState(false),[court,setCourt]=useState<HomeCourtSelection>({facilityId:null,name:""});
  const courtBaseline=useRef({name:"",facilityId:null as string|null,version:0});
  useEffect(()=>{if(editing&&!igLoaded.current&&media.state.profile){const p=media.state.profile;igBaseline.current={username:p.instagram_username??"",version:p.instagram_version};setInstagram(igBaseline.current.username);courtBaseline.current={name:p.home_court_name??"",facilityId:p.home_facility_id??null,version:p.home_court_version??0};setCourt({name:courtBaseline.current.name,facilityId:courtBaseline.current.facilityId});igLoaded.current=true;}},[editing,media.state.profile]);
  const openEdit=()=>{
    setDraft(profileId?form:draft);setPhotoView(false);setError("");setMessage("");
    const profile=media.state.profile;igLoaded.current=!!profile;igBaseline.current={username:profile?.instagram_username??"",version:profile?.instagram_version??0};
    courtBaseline.current={name:profile?.home_court_name??"",facilityId:profile?.home_facility_id??null,version:profile?.home_court_version??0};setCourt({name:courtBaseline.current.name,facilityId:courtBaseline.current.facilityId});
    setInstagram(igBaseline.current.username);setEditing(true);
  };
  const returnFromPhoto=()=>{setPhotoView(false);requestAnimationFrame(()=>photoButton.current?.focus({preventScroll:true}));};

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
    let normalizedInstagram: string|null,normalizedCourt:string|null;
    try { normalizedInstagram=instagramUsername(instagram);normalizedCourt=homeCourtName(court.name); } catch(cause) { return setError((cause as Error).message); }
    const changeCourt=court.facilityId!==courtBaseline.current.facilityId||(!court.facilityId&&(normalizedCourt??"")!==courtBaseline.current.name);
    const changeInstagram=(normalizedInstagram??"")!==igBaseline.current.username;
    if((changeInstagram||changeCourt)&&(profiles.length!==1||!media.state.profile))return setError("Instagram・ホームコートの変更には正規プロフィールの確認と読み込みが必要です");
    setSaving(true);
    setError("");
    setMessage("");
    let publicSaved=false;
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
        activity_area: draft.activity_area===form.activity_area ? expected.activity_area : draft.activity_area || null
      }, expected);
      setForm(toForm(saved));
      setDraft(toForm(saved));
      setProfiles((rows) => rows.map((row) => row.id === saved.id ? saved : row));
      rememberPlayerProfile(ownerId, saved.id);
      publicSaved=true;
      if(changeCourt){const savedCourt=await media.saveHomeCourt(ownerId,profileId,court,courtBaseline.current.version);courtBaseline.current={name:savedCourt.home_court_name??"",facilityId:savedCourt.home_facility_id??null,version:savedCourt.home_court_version??0};setCourt({name:courtBaseline.current.name,facilityId:courtBaseline.current.facilityId});}
      if(changeInstagram)await media.saveInstagram(ownerId,profileId,instagram,igBaseline.current.version);
      setEditing(false);
      setMessage("プロフィールを更新しました");
    } catch (cause) {
      console.error("プロフィール保存に失敗しました", cause);
      setError(`${publicSaved?"プレイヤー情報は保存済みです。追加項目の一部を保存できませんでした。":""}${profileErrorMessage(cause)}`);
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
      <div className="flex items-center justify-between gap-3 pr-14"><h1 className="whitespace-nowrap text-xl font-bold">マイページ</h1><a href="#profile-groups" className="flex min-h-11 items-center whitespace-nowrap text-xs text-accent underline">所属グループへ</a></div>
      <ProfileMediaPanel name={form.display_name} level={form.play_level} area={form.activity_area} bio={form.bio} hand={form.dominant_hand} position={form.preferred_position} state={media.state} onEdit={openEdit} canEdit={!loading&&!!(profileId||canCreate)}>
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
        {loading&&<p role="status" className="mt-2 text-xs text-zinc-400">読み込み中…</p>}
        {!loading&&canCreate&&<p className="mt-2 text-xs text-zinc-400">鉛筆から選手プロフィールを作成できます</p>}
        {error&&!editing&&<p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
        {message&&<p role="status" className="mt-2 text-xs text-accent">{message}</p>}
        {!loading&&error&&!editing&&<button type="button" className="min-h-11 text-xs text-zinc-400 underline" onClick={()=>void loadProfile()}>再読み込み</button>}
      </ProfileMediaPanel>
      <Card title="総合戦績">
        {loading ? <p className="text-sm text-zinc-300">読み込み中...</p> : stats ? (
          <div className="space-y-2 text-sm"><div className="grid grid-cols-3 gap-2 text-center"><div><p className="text-xs text-zinc-400">勝率</p><strong className="text-2xl text-accent">{stats.winRate.toFixed(1)}%</strong></div><div><p className="text-xs text-zinc-400">試合数</p><strong className="text-2xl">{stats.matches}</strong></div><div><p className="text-xs text-zinc-400">勝利数</p><strong className="text-2xl">{stats.wins}</strong></div></div><button type="button" className="flex min-h-11 w-full items-center justify-end gap-1 text-xs text-zinc-400 hover:underline" onClick={()=>setStatsOpen(true)}>戦績の詳細 <span aria-hidden="true">›</span></button></div>
        ) : <p className="text-sm text-zinc-400">戦績を読み込めていません</p>}
      </Card>
      <AppDialog open={statsOpen} title="総合戦績の詳細" onClose={()=>setStatsOpen(false)}><div className="min-h-0 overflow-y-auto p-4">{stats&&<dl className="divide-y divide-zinc-700 text-sm">{[["試合数",`${stats.matches} 試合`],["勝利数",`${stats.wins} 勝`],["勝率",`${stats.winRate.toFixed(1)}%`],["平均得点",stats.avgScored.toFixed(1)],["平均失点",stats.avgConceded.toFixed(1)]].map(([label,value])=><div key={label} className="flex min-h-11 items-center justify-between gap-3"><dt className="text-zinc-400">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>}<button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-zinc-600 text-sm" onClick={()=>setStatsOpen(false)}>閉じる</button></div></AppDialog>
      <div id="profile-groups" className="scroll-mt-4"><ProfileGroups owner={ownerId}/></div>
      <AppDialog open={editing} title={photoView?"プロフィール写真を調整":"プロフィールを編集"} busy={saving||photoSaving} onClose={cancelEdit}>
        {photoView&&ownerId&&profileId&&media.state.profile?<ProfilePhotoEditor key={`${ownerId}:${profileId}`} owner={ownerId} id={profileId} name={draft.display_name} media={media} onBusy={setPhotoSaving} onBack={returnFromPhoto} onSaved={text=>{setMessage(text);returnFromPhoto();}}/>:
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {profileId&&<button ref={photoButton} type="button" disabled={!media.state.profile||profiles.length!==1} className="mb-4 flex min-h-20 w-full items-center gap-3 rounded-xl bg-zinc-800/40 p-3 text-left disabled:opacity-40" onClick={()=>setPhotoView(true)}>
          <ProfileAvatar image={media.state.image} name={draft.display_name} position={avatarPosition(media.state.profile)} className="h-14 w-14"/>
          <span className="min-w-0 flex-1"><strong className="text-sm">プロフィール写真</strong><span className="mt-1 block text-xs text-zinc-400">タップして写真・表示位置を編集</span></span><span aria-hidden="true" className="text-zinc-400">›</span>
        </button>}
        {profiles.length>1&&<p role="alert" className="mb-3 text-xs text-amber-300">複数の有効な連携プロフィールがあるため、写真・Instagram・ホームコートの変更には正規プロフィールの確認が必要です。</p>}
        <form onSubmit={e=>{e.preventDefault();if(profileId)void saveProfile();else void createProfile();}}><fieldset disabled={saving} className="space-y-3 text-sm">
          <ProfileField label="表示名" value={<input aria-label="表示名" className="min-h-11 w-full rounded-xl bg-zinc-800 p-3" value={draft.display_name} onChange={e=>updateDraft("display_name",e.target.value)}/>}/>
          {profileId&&<>
          <ProfileField label="ひとこと" value={<textarea aria-label="ひとこと" className="w-full rounded-xl bg-zinc-800 p-3" rows={3} value={draft.bio} onChange={e=>updateDraft("bio",e.target.value)}/>}/>
          <div className="grid grid-cols-2 gap-3"><ProfileField label="プレイレベル" value={<select aria-label="プレイレベル" className="min-h-11 w-full rounded-xl bg-zinc-800 p-2" value={draft.play_level} onChange={e=>updateDraft("play_level",e.target.value)}><option value="">未設定</option>{PLAY_LEVEL_OPTIONS.map(x=><option key={x}>{x}</option>)}</select>}/><ProfileField label="活動エリア" value={<select aria-label="活動エリア" className="min-h-11 w-full rounded-xl bg-zinc-800 p-2" value={draft.activity_area} onChange={e=>updateDraft("activity_area",e.target.value)}><option value="">未設定</option>{legacyActivityArea(draft.activity_area)&&<option value={draft.activity_area}>{draft.activity_area}（登録済み）</option>}<optgroup label="広域エリア">{BROAD_ACTIVITY_AREAS.map(area=><option key={area}>{area}</option>)}</optgroup><optgroup label="都道府県">{PREFECTURES.map(area=><option key={area}>{area}</option>)}</optgroup></select>}/></div>
          <div className="grid grid-cols-2 gap-3"><ProfileField label="利き手" value={<select aria-label="利き手" className="min-h-11 w-full rounded-xl bg-zinc-800 p-2" value={draft.dominant_hand} onChange={e=>updateDraft("dominant_hand",e.target.value)}><option value="">未設定</option>{DOMINANT_HAND_OPTIONS.map(x=><option key={x}>{x}</option>)}</select>}/><ProfileField label="得意サイド" value={<select aria-label="得意サイド" className="min-h-11 w-full rounded-xl bg-zinc-800 p-2" value={draft.preferred_position} onChange={e=>updateDraft("preferred_position",e.target.value)}><option value="">未設定</option>{PREFERRED_POSITION_OPTIONS.map(x=><option key={x}>{x}</option>)}</select>}/></div>
          <ProfileHomeCourtField value={court} onChange={setCourt} disabled={profiles.length!==1||!media.state.profile}/>
          <ProfileField label="Instagram ID（任意）" value={<input aria-label="Instagram ID" disabled={profiles.length!==1||!media.state.profile} maxLength={31} autoCapitalize="none" autoCorrect="off" placeholder="@ユーザーネーム" className="min-h-11 w-full rounded-xl bg-zinc-800 p-3 disabled:opacity-40" value={instagram} onChange={e=>setInstagram(e.target.value)}/>}/>
          </>}
          {error&&<p role="alert" className="text-xs text-red-400">{error}</p>}
          {message&&<p role="status" className="text-xs text-accent">{message}</p>}
          <div className="flex gap-2 pt-2"><button type="button" className="min-h-11 flex-1 rounded-xl border border-zinc-600" onClick={cancelEdit}>キャンセル</button><button type="submit" className="min-h-11 flex-1 rounded-xl bg-accent px-2 font-semibold text-black disabled:opacity-40">{saving?"保存中…":profileId?"変更を保存":"プロフィールを作成"}</button></div>
        </fieldset></form></div>}
      </AppDialog>

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

type ProfileMatchRow = { team: string; matches: { id: string; event_id: string; completed: boolean; match_results: EmbeddedMatchResults<{ score_a: number; score_b: number; winner_team: string }> } | null };

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
      const result = firstMatchResult(match.match_results);
      if (!result || !hasEnteredFriendlyMatchScore({ completed: match.completed, result })) continue;
      seenMatches.add(match.id);
      scored += row.team === "A" ? result.score_a : result.score_b;
      conceded += row.team === "A" ? result.score_b : result.score_a;
      if (result.winner_team === row.team) wins += 1;
    }
  }
  const matches = seenMatches.size;
  return { matches, wins, winRate: matches ? wins / matches * 100 : 0, avgScored: matches ? scored / matches : 0, avgConceded: matches ? conceded / matches : 0 };
}
