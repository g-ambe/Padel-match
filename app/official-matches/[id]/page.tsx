"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { OfficialStatsCard } from "@/components/official-stats-card";
import { ActionButton, Card } from "@/components/ui";
import { fetchActiveClubMemberParticipants } from "@/lib/event-participants";
import { buildOfficialStats, createShareToken, getOfficialAccess, officialStatusLabel } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";

type MemberOption = { playerProfileId: string; displayName: string | null };
type OfficialOpponent = { id: string; official_event_id: string; opponent_team_name: string; memo: string | null };
type OfficialEvent = { id: string; club_id: string; title: string; event_date: string | null; description: string | null; memo: string | null; status: string; is_deleted?: boolean | null; share_enabled?: boolean | null; share_token?: string | null; clubs?: { name: string } | null };
type OfficialEventRow = OfficialEvent;
type ResultValue = "win" | "lose" | "draw" | "undecided";
type OfficialMatch = {
  id: string; official_opponent_id: string; match_order: number; created_at?: string | null;
  our_player1_profile_id: string | null; our_player2_profile_id: string | null;
  our_player1_guest_name: string | null; our_player2_guest_name: string | null;
  opponent_player1_name: string | null; opponent_player2_name: string | null;
  our_score: number | null; opponent_score: number | null; result: ResultValue;
  score_detail: string | null; memo: string | null; youtube_url: string | null;
};

type MatchForm = {
  our1ProfileId: string; our2ProfileId: string; our1GuestName: string; our2GuestName: string;
  opponent1Name: string; opponent2Name: string; ourScore: string; opponentScore: string;
  result: ResultValue; scoreDetail: string; memo: string; youtubeUrl: string;
};

const emptyMatchForm = (): MatchForm => ({
  our1ProfileId: "", our2ProfileId: "", our1GuestName: "", our2GuestName: "",
  opponent1Name: "", opponent2Name: "", ourScore: "", opponentScore: "",
  result: "undecided", scoreDetail: "", memo: "", youtubeUrl: ""
});

const resultLabel = (result: ResultValue) => ({ win: "勝ち", lose: "負け", draw: "引き分け", undecided: "未定" }[result]);
const autoResult = (ourScore: string, opponentScore: string): ResultValue => {
  if (ourScore.trim() === "" || opponentScore.trim() === "") return "undecided";
  const our = Number(ourScore); const opponent = Number(opponentScore);
  if (!Number.isInteger(our) || !Number.isInteger(opponent)) return "undecided";
  if (our > opponent) return "win";
  if (our < opponent) return "lose";
  return "draw";
};
const isYoutubeUrl = (value: string) => /^https:\/\/(www\.)?youtube\.com\/watch\?v=/.test(value) || /^https:\/\/youtu\.be\//.test(value) || /^https:\/\/(www\.)?youtube\.com\/shorts\//.test(value);
const opponentScore = (opponentId: string, matches: OfficialMatch[]) => matches
  .filter((match) => match.official_opponent_id === opponentId)
  .reduce((score, match) => {
    if (match.result === "win") return { ...score, ourWins: score.ourWins + 1 };
    if (match.result === "lose") return { ...score, opponentWins: score.opponentWins + 1 };
    if (match.result === "draw") return { ...score, draws: score.draws + 1 };
    return score;
  }, { ourWins: 0, opponentWins: 0, draws: 0 });
const formatOpponentScore = ({ ourWins, opponentWins, draws }: { ourWins: number; opponentWins: number; draws: number }) => `${ourWins}-${opponentWins}${draws > 0 ? `（引分${draws}）` : ""}`;

export default function OfficialMatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<OfficialEvent | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [opponents, setOpponents] = useState<OfficialOpponent[]>([]);
  const [matches, setMatches] = useState<OfficialMatch[]>([]);
  const [accessRole, setAccessRole] = useState<"main_admin" | "sub_admin" | "member">("member");
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showOpponentForm, setShowOpponentForm] = useState(false);
  const [opponentName, setOpponentName] = useState("");
  const [opponentMemo, setOpponentMemo] = useState("");
  const [matchForms, setMatchForms] = useState<Record<string, MatchForm>>({});
  const [openMatchFormId, setOpenMatchFormId] = useState<string | null>(null);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [editingMatchForm, setEditingMatchForm] = useState<MatchForm>(emptyMatchForm());
  const [showDeleteEventConfirm, setShowDeleteEventConfirm] = useState(false);
  const [deleteEventChecked, setDeleteEventChecked] = useState(false);

  const canManageShare = useMemo(() => {
    if (!event) return false;
    return isSuperUser || accessRole === "main_admin" || accessRole === "sub_admin";
  }, [accessRole, event, isSuperUser]);
  const shareUrl = useMemo(() => {
    if (event?.status !== "closed" || !event.share_enabled || !event.share_token) return "";
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return `${origin}/share/official-events/${event.share_token}`;
  }, [event]);
  const canEdit = useMemo(() => {
    if (!event) return false;
    return event.status !== "closed" && (isSuperUser || accessRole === "main_admin" || accessRole === "sub_admin");
  }, [accessRole, event, isSuperUser]);
  const memberName = (profileId: string | null, guestName: string | null) => guestName || members.find((m) => m.playerProfileId === profileId)?.displayName || "未入力";
  const opponentMatches = (opponentId: string) => matches
    .filter((match) => match.official_opponent_id === opponentId)
    .sort((a, b) => a.match_order - b.match_order || (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id));
  const officialStats = useMemo(() => {
    if (!event) return null;
    return buildOfficialStats({ eventTitle: event.title, groupName: event.clubs?.name ?? "名称未設定", opponents, matches, memberName });
  }, [event, opponents, matches, members]);

  const loadDetail = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const access = await getOfficialAccess(supabase);
    setIsSuperUser(access.superUser);
    const { data } = await supabase.from("official_events").select("*,clubs(name)").eq("id", id).eq("is_deleted", false).maybeSingle();
    const eventRow = data as unknown as OfficialEventRow | null;
    if (!eventRow || (!access.superUser && !access.groups.some((group) => group.id === eventRow.club_id))) {
      setError("この操作を行う権限がありません");
      return;
    }
    const group = access.groups.find((g) => g.id === eventRow.club_id);
    setAccessRole(group?.role ?? "member");
    setEvent(eventRow);
    setMembers(await fetchActiveClubMemberParticipants(supabase, eventRow.club_id));
    const { data: opponentRows } = await supabase.from("official_opponents").select("id,official_event_id,opponent_team_name,memo").eq("official_event_id", id).order("created_at");
    setOpponents((opponentRows ?? []) as unknown as OfficialOpponent[]);
    const { data: matchRows } = await supabase.from("official_matches").select("*").eq("official_event_id", id).order("match_order", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true });
    setMatches((matchRows ?? []) as unknown as OfficialMatch[]);
  };

  useEffect(() => { void loadDetail(); }, [id]);

  const addOpponent = async () => {
    setError(""); setNotice("");
    if (!canEdit) return setError("この操作を行う権限がありません");
    if (!opponentName.trim()) return setError("相手チーム名は必須です");
    const supabase = getSupabaseClient(); if (!supabase) return;
    const { error: insertError } = await supabase.from("official_opponents").insert({ official_event_id: id, opponent_team_name: opponentName.trim(), memo: opponentMemo.trim() || null });
    if (insertError) return setError("対戦相手の追加に失敗しました");
    setOpponentName(""); setOpponentMemo(""); setShowOpponentForm(false); setNotice("対戦相手を追加しました");
    await loadDetail();
  };

  const updateMatchForm = (opponentId: string, patch: Partial<MatchForm>, syncResult = false) => {
    setMatchForms((prev) => {
      const next = { ...(prev[opponentId] ?? emptyMatchForm()), ...patch };
      if (syncResult) next.result = autoResult(next.ourScore, next.opponentScore);
      return { ...prev, [opponentId]: next };
    });
  };

  const updateEditingMatchForm = (patch: Partial<MatchForm>, syncResult = false) => {
    setEditingMatchForm((prev) => {
      const next = { ...prev, ...patch };
      if (syncResult) next.result = autoResult(next.ourScore, next.opponentScore);
      return next;
    });
  };

  const validateMatchForm = (form: MatchForm) => {
    const ourPlayers = [form.our1ProfileId || form.our1GuestName.trim(), form.our2ProfileId || form.our2GuestName.trim()].filter(Boolean);
    if (ourPlayers.length === 2 && ourPlayers[0] === ourPlayers[1]) return "選手1と選手2が重複しています";
    if (form.our1ProfileId && form.our1GuestName.trim()) return "選手1は選択またはゲスト名のどちらかにしてください";
    if (form.our2ProfileId && form.our2GuestName.trim()) return "選手2は選択またはゲスト名のどちらかにしてください";
    if (form.our1GuestName.trim() && form.our1GuestName.trim() === form.our2GuestName.trim()) return "ゲスト名が重複しています";
    if (form.opponent1Name.trim() && form.opponent1Name.trim() === form.opponent2Name.trim()) return "相手選手1と相手選手2が同一です";
    if ((form.ourScore && (!Number.isInteger(Number(form.ourScore)) || Number(form.ourScore) < 0)) || (form.opponentScore && (!Number.isInteger(Number(form.opponentScore)) || Number(form.opponentScore) < 0))) return "スコアは0以上の整数で入力してください";
    if (form.youtubeUrl.trim() && !isYoutubeUrl(form.youtubeUrl.trim())) return "YouTubeのURLを入力してください";
    return "";
  };

  const addMatch = async (opponentId: string) => {
    setError(""); setNotice("");
    if (!canEdit) return setError("この操作を行う権限がありません");
    const form = matchForms[opponentId] ?? emptyMatchForm();
    const validation = validateMatchForm(form);
    if (validation) return setError(validation);
    const nextOrder = Math.max(0, ...opponentMatches(opponentId).map((match) => match.match_order)) + 1;
    const supabase = getSupabaseClient(); if (!supabase) return;
    const { error: insertError } = await supabase.from("official_matches").insert({
      official_event_id: id, official_opponent_id: opponentId, match_order: nextOrder,
      ...matchPayload(form)
    });
    if (insertError) return setError("試合カードの追加に失敗しました");
    setMatchForms((prev) => ({ ...prev, [opponentId]: emptyMatchForm() })); setOpenMatchFormId(null); setNotice("試合カードを追加しました");
    await loadDetail();
  };

  const matchToForm = (match: OfficialMatch): MatchForm => ({
    our1ProfileId: match.our_player1_profile_id ?? "", our2ProfileId: match.our_player2_profile_id ?? "",
    our1GuestName: match.our_player1_guest_name ?? "", our2GuestName: match.our_player2_guest_name ?? "",
    opponent1Name: match.opponent_player1_name ?? "", opponent2Name: match.opponent_player2_name ?? "",
    ourScore: match.our_score === null ? "" : String(match.our_score), opponentScore: match.opponent_score === null ? "" : String(match.opponent_score),
    result: match.result, scoreDetail: match.score_detail ?? "", memo: match.memo ?? "", youtubeUrl: match.youtube_url ?? ""
  });

  const matchPayload = (form: MatchForm) => ({
    our_player1_profile_id: form.our1ProfileId || null, our_player2_profile_id: form.our2ProfileId || null,
    our_player1_guest_name: form.our1GuestName.trim() || null, our_player2_guest_name: form.our2GuestName.trim() || null,
    opponent_player1_name: form.opponent1Name.trim() || null, opponent_player2_name: form.opponent2Name.trim() || null,
    our_score: form.ourScore.trim() === "" ? null : Number(form.ourScore), opponent_score: form.opponentScore.trim() === "" ? null : Number(form.opponentScore),
    result: form.result, score_detail: form.scoreDetail.trim() || null, memo: form.memo.trim() || null, youtube_url: form.youtubeUrl.trim() || null, updated_at: new Date().toISOString()
  });

  const updateMatch = async () => {
    setError(""); setNotice("");
    if (!canEdit || !editingMatchId) return setError("この操作を行う権限がありません");
    const validation = validateMatchForm(editingMatchForm);
    if (validation) return setError(validation);
    const supabase = getSupabaseClient(); if (!supabase) return;
    const { error: updateError } = await supabase.from("official_matches").update(matchPayload(editingMatchForm)).eq("id", editingMatchId);
    if (updateError) return setError("試合カードの更新に失敗しました");
    setEditingMatchId(null); setEditingMatchForm(emptyMatchForm()); setNotice("試合カードを更新しました");
    await loadDetail();
  };

  const deleteMatch = async (matchId: string) => {
    setError(""); setNotice("");
    if (!canEdit) return setError("この操作を行う権限がありません");
    if (!window.confirm("試合カードを削除しますか？")) return;
    const supabase = getSupabaseClient(); if (!supabase) return;
    const { error: deleteError } = await supabase.from("official_matches").delete().eq("id", matchId);
    if (deleteError) return setError("試合カードの削除に失敗しました");
    setNotice("試合カードを削除しました");
    await loadDetail();
  };

  const updateEventStatus = async (status: "active" | "closed") => {
    setError(""); setNotice("");
    if (!canManageShare) return setError("この操作を行う権限がありません");
    if (!window.confirm(status === "closed" ? "公式試合を終了しますか？" : "公式試合を再開しますか？")) return;
    const supabase = getSupabaseClient(); if (!supabase) return;
    const { error: updateError } = await supabase.from("official_events").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (updateError) return setError(status === "closed" ? "公式試合の終了に失敗しました" : "公式試合の再開に失敗しました");
    setNotice(status === "closed" ? "公式試合を終了しました" : "公式試合を再開しました");
    setOpenMatchFormId(null); setEditingMatchId(null); await loadDetail();
  };

  const deleteEvent = async () => {
    setError(""); setNotice("");
    if (!canManageShare) return setError("この操作を行う権限がありません");
    if (!deleteEventChecked) return setError("削除確認にチェックしてください");
    const supabase = getSupabaseClient(); if (!supabase) return;
    const { error: updateError } = await supabase.from("official_events").update({ is_deleted: true, deleted_at: new Date().toISOString(), share_enabled: false, share_token: null, updated_at: new Date().toISOString() }).eq("id", id);
    if (updateError) return setError("公式試合の削除に失敗しました");
    router.push("/official-matches");
  };

  const createOrRotateShare = async (rotate = false) => {
    setError(""); setNotice("");
    if (!event || event.status !== "closed") return setError("終了済みの公式試合のみ共有できます");
    if (!canManageShare) return setError("この操作を行う権限がありません");
    const supabase = getSupabaseClient(); if (!supabase) return;
    const { error: updateError } = await supabase.from("official_events").update({ share_enabled: true, share_token: createShareToken(), share_token_updated_at: new Date().toISOString() }).eq("id", id);
    if (updateError) return setError("共有リンクの更新に失敗しました");
    setNotice(rotate ? "共有リンクを再発行しました" : "共有リンクを作成しました");
    await loadDetail();
  };

  const stopShare = async () => {
    setError(""); setNotice("");
    if (!canManageShare) return setError("この操作を行う権限がありません");
    const supabase = getSupabaseClient(); if (!supabase) return;
    const { error: updateError } = await supabase.from("official_events").update({ share_enabled: false, share_token: null, share_token_updated_at: new Date().toISOString() }).eq("id", id);
    if (updateError) return setError("共有の停止に失敗しました");
    setNotice("共有を停止しました");
    await loadDetail();
  };

  const copyShare = async () => {
    setError(""); setNotice("");
    if (!shareUrl) return setError("この公式試合は共有されていません");
    await navigator.clipboard.writeText(shareUrl);
    setNotice("共有リンクをコピーしました");
  };

  if (!event) return <main className="mx-auto min-h-screen w-full max-w-md p-4 text-sm text-zinc-100">{error || "読み込み中..."}</main>;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 text-zinc-100">
      <h1 className="text-xl font-bold">公式試合詳細</h1>
      {error && <p className="rounded-xl border border-red-500/60 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
      {notice && <p className="rounded-xl border border-emerald-500/60 bg-emerald-950/40 p-3 text-sm text-emerald-200">{notice}</p>}
      <Card title={event.title}>
        <dl className="space-y-3 text-sm">
          <div><dt className="text-zinc-400">所属グループ</dt><dd>{event.clubs?.name ?? "名称未設定"}</dd></div>
          <div><dt className="text-zinc-400">開催日</dt><dd>{event.event_date ?? "未定"}</dd></div>
          <div><dt className="text-zinc-400">ステータス</dt><dd>{officialStatusLabel(event.status)}</dd></div>
          <div><dt className="text-zinc-400">説明</dt><dd className="whitespace-pre-wrap">{event.description || "未入力"}</dd></div>
          <div><dt className="text-zinc-400">メモ</dt><dd className="whitespace-pre-wrap">{event.memo || "未入力"}</dd></div>
        </dl>
      </Card>

      <OfficialStatsCard stats={officialStats} />
      <Card title="開催操作">
        <div className="space-y-3 text-sm">
          {event.status === "active" && canManageShare && <button className="w-full rounded-xl border border-red-500/70 py-2 font-bold text-red-200" onClick={() => void updateEventStatus("closed")}>公式試合終了</button>}
          {event.status === "closed" && <><p className="font-bold">公式試合終了済み</p><p className="text-zinc-400">この公式試合は終了しました</p>{canManageShare && <button className="w-full rounded-xl bg-accent py-2 font-bold text-black" onClick={() => void updateEventStatus("active")}>公式試合再開</button>}{canManageShare && (showDeleteEventConfirm ? <div className="space-y-2 rounded-xl border border-red-500/60 p-3"><p>公式試合を削除しますか？</p><label className="flex gap-2 text-xs text-zinc-300"><input type="checkbox" checked={deleteEventChecked} onChange={(e) => setDeleteEventChecked(e.target.checked)} />削除すると元に戻せません。問題ない場合はチェックしてください</label><div className="flex gap-2"><button className="w-1/2 rounded bg-red-600 py-2 font-bold" onClick={() => void deleteEvent()}>公式試合削除</button><button className="w-1/2 rounded border border-zinc-500 py-2" onClick={() => { setShowDeleteEventConfirm(false); setDeleteEventChecked(false); }}>キャンセル</button></div></div> : <button className="w-full rounded-xl border border-red-500/70 py-2 font-bold text-red-200" onClick={() => setShowDeleteEventConfirm(true)}>公式試合削除</button>)}</>}
          {!canManageShare && <p className="text-zinc-400">閲覧のみです</p>}
        </div>
      </Card>
      {event.status === "closed" && <Card title="共有リンク">
        <div className="space-y-3 text-sm">
          {!shareUrl && <p className="text-zinc-400">この公式試合は共有されていません</p>}
          {shareUrl && <p className="break-all rounded-xl bg-zinc-800 p-3 text-xs">{shareUrl}</p>}
          <div className="grid grid-cols-1 gap-2">
            {!shareUrl && canManageShare && <button className="rounded-xl bg-accent py-2 font-bold text-black" onClick={() => void createOrRotateShare(false)}>共有リンクを作成</button>}
            {shareUrl && <button className="rounded-xl border border-zinc-500 py-2 font-bold" onClick={() => void copyShare()}>共有リンクをコピー</button>}
            {shareUrl && canManageShare && <button className="rounded-xl border border-zinc-500 py-2 font-bold" onClick={() => void createOrRotateShare(true)}>共有リンクを再発行</button>}
            {shareUrl && canManageShare && <button className="rounded-xl border border-red-500/70 py-2 font-bold text-red-200" onClick={() => void stopShare()}>共有を停止</button>}
          </div>
        </div>
      </Card>}
      <Card title="戦績">
        <div className="space-y-4">
          {opponents.length === 0 && <p className="text-sm text-zinc-400">戦績はまだ登録されていません</p>}
          {opponents.map((opponent) => (
            <section key={opponent.id} className="space-y-3 rounded-2xl border border-zinc-700 bg-zinc-900/60 p-3">
              <div><h3 className="font-bold">{event.clubs?.name ?? "自チーム"} vs {opponent.opponent_team_name}</h3><p className="mt-1 text-2xl font-black tracking-tight text-accent">{formatOpponentScore(opponentScore(opponent.id, matches))}</p>{opponent.memo && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-400">メモ: {opponent.memo}</p>}</div>
              <div className="space-y-3">
                {opponentMatches(opponent.id).length === 0 && <p className="text-sm text-zinc-400">試合カードはまだ登録されていません</p>}
                {opponentMatches(opponent.id).map((match, index) => {
                  const isEditing = editingMatchId === match.id;
                  return (
                  <div key={match.id} className={isEditing ? "text-sm" : "rounded-xl bg-zinc-800 p-3 text-sm"}>
                    {isEditing ? <MatchFormView title="試合カードを編集" members={members} form={editingMatchForm} onChange={updateEditingMatchForm} onSave={() => void updateMatch()} onCancel={() => { setEditingMatchId(null); setEditingMatchForm(emptyMatchForm()); }} /> : <>
                    <p className="font-bold">第{index + 1}試合</p>
                    <p className="mt-1">{memberName(match.our_player1_profile_id, match.our_player1_guest_name)} / {memberName(match.our_player2_profile_id, match.our_player2_guest_name)} vs {match.opponent_player1_name || "未入力"} / {match.opponent_player2_name || "未入力"}</p>
                    <p className="mt-1">スコア: {match.our_score ?? "未入力"} - {match.opponent_score ?? "未入力"}</p>
                    <p>結果: {resultLabel(match.result)}</p>
                    {match.score_detail && <p className="whitespace-pre-wrap">詳細スコア: {match.score_detail}</p>}
                    {match.memo && <p className="whitespace-pre-wrap">メモ: {match.memo}</p>}
                    {match.youtube_url && <a className="mt-1 inline-block underline" href={match.youtube_url} target="_blank" rel="noreferrer">動画を見る</a>}
                    {canEdit && <div className="mt-3 grid grid-cols-2 gap-2"><button className="rounded-xl border border-zinc-500 py-2 text-xs font-bold" onClick={() => { setEditingMatchId(match.id); setEditingMatchForm(matchToForm(match)); setOpenMatchFormId(null); }}>試合カードを編集</button><button className="rounded-xl border border-red-500/70 py-2 text-xs font-bold text-red-200" onClick={() => void deleteMatch(match.id)}>試合カードを削除</button></div>}
                    </>}
                  </div>
                  );
                })}
              </div>
              {canEdit && (openMatchFormId === opponent.id ? <MatchFormView title="試合カードを追加" members={members} form={matchForms[opponent.id] ?? emptyMatchForm()} onChange={(patch, sync) => updateMatchForm(opponent.id, patch, sync)} onSave={() => void addMatch(opponent.id)} onCancel={() => setOpenMatchFormId(null)} /> : <button className="w-full rounded-xl border border-zinc-500 py-2 text-sm font-bold" onClick={() => { setOpenMatchFormId(opponent.id); updateMatchForm(opponent.id, {}); }}>試合カードを追加</button>)}
            </section>
          ))}
          {canEdit && (showOpponentForm ? <div className="space-y-2 rounded-2xl border border-zinc-700 p-3"><input className="w-full rounded bg-zinc-800 p-2" placeholder="相手チーム名" value={opponentName} onChange={(e) => setOpponentName(e.target.value)} /><textarea className="w-full rounded bg-zinc-800 p-2" placeholder="メモ" value={opponentMemo} onChange={(e) => setOpponentMemo(e.target.value)} /><div className="flex gap-2"><button className="w-1/2 rounded bg-accent py-2 text-black" onClick={() => void addOpponent()}>保存</button><button className="w-1/2 rounded border border-zinc-500 py-2" onClick={() => setShowOpponentForm(false)}>キャンセル</button></div></div> : <ActionButton onClick={() => setShowOpponentForm(true)}>対戦相手を追加</ActionButton>)}
        </div>
      </Card>
      <Link href="/official-matches/new" className="text-center text-sm underline">公式試合へ戻る</Link>
    </main>
  );
}

function MatchFormView({ title, members, form, onChange, onSave, onCancel }: { title: string; members: MemberOption[]; form: MatchForm; onChange: (patch: Partial<MatchForm>, syncResult?: boolean) => void; onSave: () => void; onCancel: () => void }) {
  const fieldClass = "w-full rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-accent";
  const labelClass = "text-xs font-bold text-zinc-300";
  const sectionClass = "space-y-3 rounded-2xl border border-zinc-700 bg-zinc-900/70 p-3";

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4 shadow-lg shadow-black/20">
      <h4 className="text-base font-bold">{title}</h4>

      <section className={sectionClass}>
        <p className="text-xs font-bold text-zinc-400">自チーム</p>
        {[1, 2].map((n) => (
          <div key={n} className="space-y-2">
            <label className={labelClass}>選手{n}</label>
            <select className={fieldClass} value={n === 1 ? form.our1ProfileId : form.our2ProfileId} onChange={(e) => onChange(n === 1 ? { our1ProfileId: e.target.value } : { our2ProfileId: e.target.value })}>
              <option value="">グループメンバーから選択</option>
              {members.map((member) => <option key={member.playerProfileId} value={member.playerProfileId}>{member.displayName ?? "名称未設定"}</option>)}
            </select>
            <input className={fieldClass} placeholder="ゲスト名" value={n === 1 ? form.our1GuestName : form.our2GuestName} onChange={(e) => onChange(n === 1 ? { our1GuestName: e.target.value } : { our2GuestName: e.target.value })} />
          </div>
        ))}
      </section>

      <section className={sectionClass}>
        <p className="text-xs font-bold text-zinc-400">相手チーム</p>
        <div className="space-y-2">
          <label className={labelClass}>相手選手1</label>
          <input className={fieldClass} placeholder="相手選手1" value={form.opponent1Name} onChange={(e) => onChange({ opponent1Name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <label className={labelClass}>相手選手2</label>
          <input className={fieldClass} placeholder="相手選手2" value={form.opponent2Name} onChange={(e) => onChange({ opponent2Name: e.target.value })} />
        </div>
      </section>

      <section className={sectionClass}>
        <p className="text-xs font-bold text-zinc-400">スコア</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className={labelClass}>自チーム得点</label>
            <input className={fieldClass} inputMode="numeric" placeholder="自チーム得点" value={form.ourScore} onChange={(e) => onChange({ ourScore: e.target.value }, true)} />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>相手チーム得点</label>
            <input className={fieldClass} inputMode="numeric" placeholder="相手チーム得点" value={form.opponentScore} onChange={(e) => onChange({ opponentScore: e.target.value }, true)} />
          </div>
        </div>
        <div className="space-y-2">
          <label className={labelClass}>結果</label>
          <select className={fieldClass} value={form.result} onChange={(e) => onChange({ result: e.target.value as ResultValue })}>
            <option value="win">勝ち</option><option value="lose">負け</option><option value="draw">引き分け</option><option value="undecided">未定</option>
          </select>
        </div>
      </section>

      <section className={sectionClass}>
        <p className="text-xs font-bold text-zinc-400">詳細</p>
        <div className="space-y-2"><label className={labelClass}>詳細スコア</label><input className={fieldClass} placeholder="詳細スコア" value={form.scoreDetail} onChange={(e) => onChange({ scoreDetail: e.target.value })} /></div>
        <div className="space-y-2"><label className={labelClass}>メモ</label><textarea className={`${fieldClass} min-h-24`} placeholder="メモ" value={form.memo} onChange={(e) => onChange({ memo: e.target.value })} /></div>
        <div className="space-y-2"><label className={labelClass}>YouTubeリンク</label><input className={fieldClass} placeholder="YouTubeリンク" value={form.youtubeUrl} onChange={(e) => onChange({ youtubeUrl: e.target.value })} /></div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <button className="rounded-xl bg-accent py-2.5 text-sm font-bold text-black" onClick={onSave}>保存</button>
        <button className="rounded-xl border border-zinc-500 bg-zinc-900 py-2.5 text-sm font-bold text-zinc-100" onClick={onCancel}>キャンセル</button>
      </div>
    </div>
  );
}
