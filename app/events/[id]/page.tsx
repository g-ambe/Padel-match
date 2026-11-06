"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card, ActionButton } from "@/components/ui";
import { GuestName, YoutubeDisclosure } from "@/components/match-ui";
import type { ScorePair } from "@/lib/score-input";
import { ScoreInput } from "@/components/score-input";
import { useScoreSaves } from "@/components/score-save-provider";
import { AppDialog } from "@/components/app-dialog";
import { RoundLineupEditor, type LineupEditorData } from "@/components/round-lineup-editor";
import { readLineupVersions, readRoundLineup, createLineupCommit, createFriendlyScoreCommit, canonicalPlayers, type LineupVersions } from "@/lib/round-lineup";
import { guestLineupSnapshot, roundCards, saveGuestRoundLineup, type RoundCard } from "@/lib/guest-round-lineup";
import { FriendlyMatchCards } from "@/components/friendly-match-cards";
import { readRoundMode, rememberRoundMode } from "@/lib/friendly-round-mode-selection";
import { MatchShareButtons } from "@/components/match-share-buttons";
import { getSupabaseClient } from "@/lib/supabase";
import { getGuestEvent, isGuestModeEnabled, removeGuestEvent, upsertGuestEvent, type EventMode, type StatsMode } from "@/lib/guest-events";
import { addMissingClubMembersToEvent, fetchActiveClubMemberParticipants } from "@/lib/event-participants";
import { readParticipantStatus, saveParticipantStatus, type ParticipantStatus } from "@/lib/event-participant-status";
import { hasEnteredFriendlyMatchScore } from "@/lib/friendly-match-results";
import { FRIENDLY_MODE_UNLOCK_MATCHES, friendlyRoundModes, generateFriendlyRound, scoredFriendlyMatches, type FriendlyRoundMode } from "@/lib/friendly-rounds";
import { readFriendlyRoundRows } from "@/lib/friendly-round-history";
import { readEventCourts, saveEventCourts, validCourtCount } from "@/lib/event-courts";
import { fetchBalancePastStats } from "@/lib/friendly-balance-history";
import { EventFixedPairs } from "@/components/event-fixed-pairs";
import { generateFriendlyRoundWithFixedPairs, type FixedPair } from "@/lib/friendly-fixed-pairs";
import { readEventFixedPairs, saveEventFixedPairs, createEventFixedRound, finishEventWithFixedPairs, readPendingFixedRound, storePendingFixedRound, FixedPairRequestError, type FixedPairState, type FixedRoundRequest } from "@/lib/event-fixed-pairs";

type Participant = { id: string; profile_id: string | null; player_profile_id: string | null; guest_name: string | null; status: "active" | "resting" | "absent"; participant_type?: "member" | "guest"; display_name?: string | null; is_member_candidate: boolean };
type TeamResult = "A" | "B" | "draw";
type MatchView = { id: string; event_id?: string; round_id?: string | null; lineup_revision?: number; court_number: number; round_number: number; created_at?: string; youtube_url?: string | null; players: { participant_id: string; team: "A" | "B" }[]; completed: boolean; result?: { id?: string; score_a: number; score_b: number; winner_team: TeamResult } | null };
type ScoreInput = { a: number | ""; b: number | "" };
type ManualMatchDraft = { id: string; court_number: number; teamA1: string; teamA2: string; teamB1: string; teamB2: string };
type LineupDraft = { teamA1: string; teamA2: string; teamB1: string; teamB2: string };
type SummaryRankingSectionKey = "wins" | "winRate" | "diff" | "mvp";
type EventVideoLink = { id: string; title: string; video_url: string | null; memo: string | null; display_order: number };
type EventVideoForm = { title: string; video_url: string; memo: string; display_order: string };
const eventTabs = [{ value: "matches", label: "対戦" }, { value: "participants", label: "参加者" }, { value: "results", label: "結果" }] as const;
type EventTab = typeof eventTabs[number]["value"];

const formatRecord = (wins: number, losses: number, draws: number) => `${wins}勝${losses}敗${draws}分`;
type MatchDeleteTarget = { id: string; hasScore: boolean } | null;

const getWinnerTeam = (scoreA: number, scoreB: number): TeamResult => scoreA === scoreB ? "draw" : scoreA > scoreB ? "A" : "B";

const isSupabaseErrorLike = (error: unknown): error is { message?: string; code?: string; details?: string; hint?: string } => typeof error === "object" && error !== null;

const summaryRankingButtonClass = "flex min-h-12 w-full items-center rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-3 text-left text-sm font-bold text-zinc-100 shadow-sm shadow-black/20 active:bg-zinc-800";

function SummaryRankingSection({ title, isOpen, onToggle, children }: { title: string; isOpen: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <button type="button" className={summaryRankingButtonClass} onClick={onToggle} aria-expanded={isOpen}>
        <span className="mr-2 text-accent">{isOpen ? "▼" : "◀"}</span>
        <span>{title}</span>
      </button>
      {isOpen && <div>{children}</div>}
    </section>
  );
}


export default function EventDetailPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const router = useRouter();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [eventName, setEventName] = useState("-");
  const [courtCount, setCourtCount] = useState(1);
  const boardOperation = useRef<"court" | "round" | "delete" | "fixed" | "lineup" | null>(null);
  const [lineupVersions, setLineupVersions] = useState<{eventId:string;userId:string;data:LineupVersions}|null>(null);
  const [lineupEditor, setLineupEditor] = useState<{data:LineupEditorData;target:string;save:(cards:RoundCard[])=>Promise<unknown>}|null>(null);
  const [lineupLoading,setLineupLoading] = useState(false), [lineupSaving,setLineupSaving] = useState(false);
  const [moreCourts, setMoreCourts] = useState(false);
  const [allHistoryOpen, setAllHistoryOpen] = useState(false);
  const latestCardsHost = useRef<HTMLDivElement>(null);
  const pastCardsHost = useRef<HTMLDivElement>(null);
  const expandedCardsHost = useRef<HTMLDivElement>(null);
  const courtDialogRequest = useRef(0);
  const [showCourtDialog, setShowCourtDialog] = useState(false);
  const [courtDraft, setCourtDraft] = useState(1);
  const [courtBeforeEdit, setCourtBeforeEdit] = useState(1);
  const [courtLoading, setCourtLoading] = useState(false);
  const [courtReady, setCourtReady] = useState(false);
  const [courtSaving, setCourtSaving] = useState(false);
  const [courtError, setCourtError] = useState("");
  const [isDeletingMatch, setIsDeletingMatch] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [eventStatus, setEventStatus] = useState<"active" | "closed">("active");
  const [eventTab, setEventTab] = useState<{ eventId: string; value: EventTab } | null>(null);
  const tabReady = eventTab?.eventId === eventId;
  const activeTab = tabReady ? eventTab.value : "matches";
  const [tabNotice, setTabNotice] = useState("");
  const participantWrites = useRef(new Set<string>());
  const participantStatusRevision = useRef(0);
  const [busyParticipants, setBusyParticipants] = useState<Set<string>>(new Set());
  const [participantErrors, setParticipantErrors] = useState<Record<string, string>>({});
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteChecked, setDeleteChecked] = useState(false);
  const [isDeletedEvent, setIsDeletedEvent] = useState(false);
  const [canDeleteEvent, setCanDeleteEvent] = useState(false);
  const [scoreInputs, setScoreInputs] = useState<Record<string, ScoreInput>>({});
  const { queue: scoreQueue, snapshot: scoreJobs } = useScoreSaves();
  const scoreScope = `/events/${eventId}#`;
  const scoreSaveState = useMemo(() => ({current:scoreQueue.writeState(scoreScope)}), [scoreQueue,scoreScope]);
  const unsavedScoreCount = Object.keys(scoreJobs).filter(key => key.startsWith(scoreScope)).length;
  const failedScoreCount = Object.keys(scoreJobs).filter(key => key.startsWith(scoreScope) && scoreJobs[key].status === "error").length;
  const closingEvent = useRef(false), reloadAfterScores = useRef(false);
  const [isClosingEvent, setIsClosingEvent] = useState(false);
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [editingGuestName, setEditingGuestName] = useState("");
  const [youtubeInputs, setYoutubeInputs] = useState<Record<string, string>>({});
  const [videoClickCounts, setVideoClickCounts] = useState<Record<string, number>>({});
  const [eventVideoClickCounts, setEventVideoClickCounts] = useState<Record<string, number>>({});
  const [canViewVideoClickCounts, setCanViewVideoClickCounts] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [shareEnabled, setShareEnabled] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [canManageShare, setCanManageShare] = useState(false);
  const [canManageEventVideos, setCanManageEventVideos] = useState(false);
  const [canManageEventName, setCanManageEventName] = useState(false);
  const [canCopyShare, setCanCopyShare] = useState(false);
  const [isEditingEventName, setIsEditingEventName] = useState(false);
  const [eventNameDraft, setEventNameDraft] = useState("");
  const [isGeneratingRound, setIsGeneratingRound] = useState(false);
  const [roundUserId, setRoundUserId] = useState<string | null>(null);
  const [roundModeSelection, setRoundModeSelection] = useState<{ eventId: string; userId: string; mode: FriendlyRoundMode }>({ eventId: "", userId: "", mode: "normal" });
  const [eventMode, setEventMode] = useState<EventMode>("auto");
  const [eventClubId, setEventClubId] = useState<string | null>(null);
  const [fixedState, setFixedState] = useState<FixedPairState | null>(null);
  const [displayEligibility, setDisplayEligibility] = useState<{ eventId: string; owner: string; rounds: FixedPairState["eligible_rounds"] } | null>(null);
  const [fixedError, setFixedError] = useState("");
  const [fixedSaving, setFixedSaving] = useState(false);
  const [fixedCloseChoice, setFixedCloseChoice] = useState<"official" | "record_only" | null>(null);
  const pendingFixedRound = useRef<FixedRoundRequest | null>(null);
  const pendingFixedOwner = useRef<string | null>(null);
  const fixedScope = useRef("");
  fixedScope.current = `${roundUserId ?? ""}:${eventId}`;
  const fixedOwner = useRef<string | null>(null);
  const scopedFixedState = fixedState?.event_id === eventId && fixedOwner.current === roundUserId ? fixedState : null;
  const fixedFeature = !guestMode && eventMode === "auto" && !!eventClubId;
  const usedFixedPairs = fixedFeature && !!scopedFixedState?.used_fixed_pairs;
  const [statsMode, setStatsMode] = useState<StatsMode>("official");
  const [closeStatsMode, setCloseStatsMode] = useState<StatsMode>("official");
  const [manualDrafts, setManualDrafts] = useState<ManualMatchDraft[]>([]);
  const [lineupDrafts, setLineupDrafts] = useState<Record<string, LineupDraft>>({});
  const [openSummaryRankingSections, setOpenSummaryRankingSections] = useState<Record<SummaryRankingSectionKey, boolean>>({ wins: false, winRate: false, diff: false, mvp: false });
  const [swipeOffsets, setSwipeOffsets] = useState<Record<string, number>>({});
  const [swipeStartX, setSwipeStartX] = useState<Record<string, number>>({});
  const [matchDeleteTarget, setMatchDeleteTarget] = useState<MatchDeleteTarget>(null);
  const [eventVideoLinks, setEventVideoLinks] = useState<EventVideoLink[]>([]);
  const [eventVideoForm, setEventVideoForm] = useState<EventVideoForm>({ title: "全試合動画", video_url: "", memo: "", display_order: "1" });
  const [editingEventVideoId, setEditingEventVideoId] = useState<string | null>(null);
  const [deleteEventVideoId, setDeleteEventVideoId] = useState<string | null>(null);

  const nameMap = useMemo(() => Object.fromEntries(participants.map((p) => [p.id, p.display_name ?? (p.participant_type === "guest" ? (p.guest_name ?? "ゲスト（名称未設定）") : "メンバー名未設定") ])), [participants]);




  const eventSummary = useMemo(() => {
    const table: Record<string, { name: string; played: number; wins: number; losses: number; draws: number; scored: number; conceded: number; winRate: number; diff: number; matchPoints: number }> = {};
    for (const p of participants) {
      table[p.id] = { name: p.guest_name ?? "ゲスト", played: 0, wins: 0, losses: 0, draws: 0, scored: 0, conceded: 0, winRate: 0, diff: 0, matchPoints: 0 };
    }

    for (const m of matches) {
      if (!hasEnteredFriendlyMatchScore(m)) continue;
      const teamA = m.players.filter((x) => x.team === "A").map((x) => x.participant_id);
      const teamB = m.players.filter((x) => x.team === "B").map((x) => x.participant_id);

      for (const pid of teamA) {
        const row = table[pid];
        if (!row) continue;
        row.played += 1;
        row.scored += m.result.score_a;
        row.conceded += m.result.score_b;
        if (m.result.score_a > m.result.score_b) row.wins += 1;
        else if (m.result.score_a < m.result.score_b) row.losses += 1;
        else row.draws += 1;
      }
      for (const pid of teamB) {
        const row = table[pid];
        if (!row) continue;
        row.played += 1;
        row.scored += m.result.score_b;
        row.conceded += m.result.score_a;
        if (m.result.score_b > m.result.score_a) row.wins += 1;
        else if (m.result.score_b < m.result.score_a) row.losses += 1;
        else row.draws += 1;
      }
    }

    const rows = Object.values(table).map((r) => ({ ...r, winRate: r.played ? Math.round((r.wins / r.played) * 1000) / 10 : 0, diff: r.scored - r.conceded, matchPoints: r.wins * 3 + r.draws }));
    return {
      rows,
      winRateRanking: [...rows].sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || b.draws - a.draws || b.diff - a.diff || b.scored - a.scored || b.played - a.played || a.name.localeCompare(b.name, "ja")),
      diffRanking: [...rows].sort((a, b) => b.diff - a.diff || b.wins - a.wins || b.draws - a.draws || b.winRate - a.winRate || b.scored - a.scored || a.played - b.played || a.name.localeCompare(b.name, "ja")),
      scoredRanking: [...rows].sort((a, b) => b.scored - a.scored)
    };
  }, [participants, matches]);
  const totalMatches = useMemo(() => matches.length, [matches]);
  const summaryRankingRows = useMemo(() => eventSummary.rows.filter((r) => r.played > 0), [eventSummary.rows]);
  const hasSummaryResults = summaryRankingRows.length > 0;
  const winRanking = useMemo(() => [...summaryRankingRows].sort((a, b) => b.wins - a.wins || b.draws - a.draws || b.winRate - a.winRate || b.diff - a.diff || b.scored - a.scored || a.played - b.played || a.name.localeCompare(b.name, "ja")), [summaryRankingRows]);
  const winRateRanking = useMemo(() => [...summaryRankingRows].sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || b.draws - a.draws || b.diff - a.diff || b.scored - a.scored || b.played - a.played || a.name.localeCompare(b.name, "ja")), [summaryRankingRows]);
  const diffRanking = useMemo(() => [...summaryRankingRows].sort((a, b) => b.diff - a.diff || b.wins - a.wins || b.draws - a.draws || b.winRate - a.winRate || b.scored - a.scored || a.played - b.played || a.name.localeCompare(b.name, "ja")), [summaryRankingRows]);
  const mvp = useMemo(() => [...summaryRankingRows].sort((a, b) => b.matchPoints - a.matchPoints || b.wins - a.wins || b.winRate - a.winRate || b.diff - a.diff || b.scored - a.scored || b.draws - a.draws || a.played - b.played || a.name.localeCompare(b.name, "ja"))[0] ?? null, [summaryRankingRows]);
  const toggleSummaryRankingSection = (key: SummaryRankingSectionKey) => setOpenSummaryRankingSections((prev) => ({ ...prev, [key]: !prev[key] }));


  const candidateParticipants = useMemo(() => participants.filter((p) => p.status === "active" && p.is_member_candidate), [participants]);
  const activeParticipantsCount = useMemo(() => candidateParticipants.length, [candidateParticipants]);
  const maxPlayableCourts = Math.floor(activeParticipantsCount / 4);
  const showCourtWarning = maxPlayableCourts < courtCount;

  const ranking = useMemo(() => {
    const stats: Record<string, { name: string; m: number; w: number }> = {};
    for (const p of participants) stats[p.id] = { name: p.display_name ?? (p.participant_type === "guest" ? (p.guest_name ?? "ゲスト（名称未設定）") : "メンバー名未設定"), m: 0, w: 0 };
    for (const m of matches) {
      if (!hasEnteredFriendlyMatchScore(m)) continue;
      const winner = m.result!.winner_team;
      for (const mp of m.players) {
        if (!stats[mp.participant_id]) continue;
        stats[mp.participant_id].m += 1;
        if (mp.team === winner) stats[mp.participant_id].w += 1;
      }
    }
    return Object.values(stats)
      .map((v) => ({ ...v, r: v.m ? Math.round((v.w / v.m) * 100) : 0 }))
      .sort((a, b) => b.r - a.r);
  }, [participants, matches, scoreInputs]);




  const latestRoundNumber = useMemo(() => matches.reduce((max, m) => Math.max(max, m.round_number), 0), [matches]);
  useEffect(() => { setMoreCourts(false); }, [eventId, latestRoundNumber]);
  useEffect(() => { setAllHistoryOpen(false); }, [eventId]);
  const sortedMatches = useMemo(() => [...matches].sort((a, b) => (b.round_number - a.round_number) || (a.court_number - b.court_number) || ((b.created_at ?? "").localeCompare(a.created_at ?? "")) || a.id.localeCompare(b.id)), [matches]);
  const scoredMatchCount = useMemo(() => scoredFriendlyMatches(eventId, matches, new Set(participants.map(p => p.id))).length, [eventId, matches, participants]);
  const specialModesUnlocked = scoredMatchCount >= FRIENDLY_MODE_UNLOCK_MATCHES;
  const selectedRoundMode = roundModeSelection.eventId === eventId && roundModeSelection.userId === roundUserId ? roundModeSelection.mode : "normal";
  useEffect(() => {
    setRoundModeSelection({ eventId, userId: roundUserId ?? "", mode: readRoundMode(roundUserId ?? "", eventId) });
  }, [eventId, roundUserId]);

  const selectRoundMode = (mode: FriendlyRoundMode) => {
    if (!roundUserId) return;
    setRoundModeSelection({ eventId, userId: roundUserId, mode });
    rememberRoundMode(roundUserId, eventId, mode);
  };

  const initializeEventTab = (status: string) => setEventTab(current => current?.eventId === eventId ? current : { eventId, value: status === "closed" ? "results" : "matches" });
  const selectEventTab = (value: EventTab) => {
    if (document.querySelector('dialog[open], [aria-modal="true"], .fixed.inset-0.z-50')) {
      setTabNotice("開いている入力・確認画面を閉じてからタブを切り替えてください。入力内容は保持しています。");
      return;
    }
    setTabNotice(""); setEventTab({ eventId, value });
  };

  const loadAll = async (confirmFailedScores = false) => {
    const scoreRevision = scoreQueue.getRevision(scoreScope);
    const statusRevision = participantStatusRevision.current;
    if (typeof eventId === "string" && eventId.startsWith("guest_")) {
      setGuestMode(true);
      const ge = getGuestEvent(eventId);
      if (!ge) { setError("イベントが見つかりません"); return; }
      setEventName(ge.name);
      setCourtCount(ge.court_count);
      setEventStatus(ge.status);
      initializeEventTab(ge.status);
      setEventMode(ge.event_mode ?? "auto");
      setEventClubId(null);
      setStatsMode(ge.stats_mode ?? (ge.event_mode === "manual" ? "undecided" : "official"));
      setParticipants(ge.participants.map((p) => ({ ...p, profile_id: null, player_profile_id: null, display_name: p.guest_name, is_member_candidate: true })));
      setMatches(ge.matches as any);
      setScoreInputs(Object.fromEntries(ge.matches.filter((m) => m.result).map((m) => [m.id, { a: m.result!.score_a, b: m.result!.score_b }])));
      setVideoClickCounts({});
      setEventVideoClickCounts({});
      setEventVideoLinks([]);
      setCanViewVideoClickCounts(false);
      setCanManageEventVideos(false);
      setCanManageEventName(true);
      return;
    }
    setGuestMode(false);
    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return;

    const { data: event } = await supabase.from("events").select("name,court_count,status,club_id,is_deleted,share_enabled,share_token,event_mode,stats_mode,created_by_auth_user_id").eq("id", eventId).single();
    if (scoreRevision !== scoreQueue.getRevision(scoreScope)) { await loadAll(); return; }
    if (!event) { setError("イベントが見つかりません"); return; }
    if (event.is_deleted) { setIsDeletedEvent(true); setEventName(event.name ?? "-"); return; }
    setIsDeletedEvent(false);
    if (event?.name) setEventName(event.name);
    if (event?.court_count) setCourtCount(event.court_count);
    if (event?.status === "closed") setEventStatus("closed");
    else setEventStatus("active");
    initializeEventTab(event.status);
    setShareEnabled(!!event?.share_enabled);
    setShareToken(event?.share_token ?? null);
    setEventClubId(event?.club_id ?? null);
    setEventMode((event?.event_mode ?? "auto") as EventMode);
    setStatsMode((event?.stats_mode ?? "official") as StatsMode);

    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    setRoundUserId(uid ?? null);
    const { data: adminRow } = uid ? await supabase.from("app_admins").select("id").eq("profile_id", uid).eq("is_active", true).maybeSingle() : { data: null as any };
    const superUser = !!adminRow;
    let allowViewVideoClickCounts = superUser || (!!uid && !event?.club_id && event?.created_by_auth_user_id === uid);
    let allowManageEventVideos = superUser || (!!uid && !event?.club_id && event?.created_by_auth_user_id === uid);
    let canDelete = superUser || (!!uid && !event?.club_id && event?.created_by_auth_user_id === uid);
    if (!canDelete && uid && event?.club_id) {
      const { data: linkedProfiles } = await supabase
        .from("player_profiles")
        .select("id")
        .eq("linked_auth_user_id", uid);
      const linkedProfileIds = (linkedProfiles ?? []).map((p: any) => p.id).filter(Boolean);
      if (linkedProfileIds.length) {
        const { data: myMembers } = await supabase
          .from("club_members")
          .select("role")
          .eq("club_id", event.club_id)
          .in("player_profile_id", linkedProfileIds)
          .eq("is_active", true);
        canDelete = (myMembers ?? []).some((m: any) => m.role === "main_admin");
        allowViewVideoClickCounts = allowViewVideoClickCounts || (myMembers ?? []).some((m: any) => m.role === "main_admin");
      }
      if (!canDelete) {
        const { data: myMember } = await supabase
          .from("club_members")
          .select("role")
          .eq("club_id", event.club_id)
          .eq("profile_id", uid)
          .eq("is_active", true)
          .maybeSingle();
        canDelete = myMember?.role === "main_admin";
        allowViewVideoClickCounts = allowViewVideoClickCounts || myMember?.role === "main_admin";
      }
    }
    setCanDeleteEvent(canDelete);
    const isNoGroupCreator = !!uid && !event?.club_id && event?.created_by_auth_user_id === uid;
    let allowManageShare = superUser || isNoGroupCreator;
    let allowCopyShare = allowManageShare;
    let allowOperateEvent = allowManageShare;
    if (uid && event?.club_id) {
      const { data: linkedProfiles } = await supabase.from("player_profiles").select("id").eq("linked_auth_user_id", uid);
      const linkedProfileIds = (linkedProfiles ?? []).map((p: any) => p.id).filter(Boolean);
      let memberRoles: any[] = [];
      if (linkedProfileIds.length) {
        const { data } = await supabase.from("club_members").select("role").eq("club_id", event.club_id).in("player_profile_id", linkedProfileIds).eq("is_active", true);
        memberRoles = data ?? [];
      }
      if (!memberRoles.length) {
        const { data } = await supabase.from("club_members").select("role").eq("club_id", event.club_id).eq("profile_id", uid).eq("is_active", true);
        memberRoles = data ?? [];
      }
      const roles = new Set(memberRoles.map((x: any) => x.role));
      allowOperateEvent = allowOperateEvent || (memberRoles.length > 0 && ["auto", "manual"].includes(event.event_mode ?? "auto"));
      allowViewVideoClickCounts = allowViewVideoClickCounts || roles.has("main_admin");
      allowManageShare = allowManageShare || roles.has("main_admin") || roles.has("sub_admin");
      allowManageEventVideos = allowManageEventVideos || roles.has("main_admin") || roles.has("sub_admin");
      allowCopyShare = allowManageShare || roles.has("member");
    }
    setCanViewVideoClickCounts(allowViewVideoClickCounts);
    setCanManageShare(allowManageShare);
    setCanManageEventVideos(allowManageEventVideos);
    setCanManageEventName(allowManageEventVideos || allowOperateEvent);
    setCanCopyShare(allowCopyShare);
    if (uid && event?.club_id && (event.event_mode ?? "auto") === "auto") {
      try {
        const current = await readEventFixedPairs(supabase, eventId, true);
        fixedOwner.current = uid; setFixedState(current); setFixedError("");
        setDisplayEligibility({ eventId, owner: uid, rounds: current.eligible_rounds });
      }
      catch (cause) { setFixedState(null); setDisplayEligibility(null); setFixedError(cause instanceof Error ? cause.message : "固定ペア設定を確認できませんでした"); }
    } else { setFixedState(null); setDisplayEligibility(null); setFixedError(""); }

    let currentLineupVersions: LineupVersions | null = null;
    if (allowOperateEvent && event.event_mode === "auto") {
      try { currentLineupVersions = await readLineupVersions(supabase,eventId); setLineupVersions({eventId,userId:uid!,data:currentLineupVersions}); }
      catch (cause) { setLineupVersions(null); setError(cause instanceof Error ? cause.message : "構成の版数を確認できませんでした。"); }
    } else setLineupVersions(null);

    // グループ定常メンバーをイベント参加者へ自動反映（未登録分のみ）
    if (event?.club_id) {
      await addMissingClubMembersToEvent(supabase, eventId, event.club_id);
    }

    const { data: pt } = await supabase
      .from("event_participants")
      .select("id,profile_id,player_profile_id,guest_name,status,participant_type")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true }).order("id", { ascending: true });
        const participantRows = (pt ?? []) as any[];
    const playerProfileIds = participantRows.map((r) => r.player_profile_id).filter(Boolean);
    const profileIds = participantRows.map((r) => r.profile_id).filter(Boolean);

    const { data: pps } = playerProfileIds.length
      ? await supabase.from("player_profiles").select("id,display_name,is_active").in("id", playerProfileIds)
      : { data: [] as any[] };
    const { data: ps } = profileIds.length
      ? await supabase.from("profiles").select("id,display_name").in("id", profileIds)
      : { data: [] as any[] };

    const playerProfileNameMap = new Map((pps ?? []).map((x: any) => [x.id, x.display_name]));
    const profileNameMap = new Map((ps ?? []).map((x: any) => [x.id, x.display_name]));

    const activeMemberProfileIds = new Set<string>();
    if (event?.club_id) {
      const activeMembers = await fetchActiveClubMemberParticipants(supabase, event.club_id);
      for (const member of activeMembers) activeMemberProfileIds.add(member.playerProfileId);
    }

    setParticipants(previous =>
      participantRows.map((row) => {
        const resolvedName =
          (row.player_profile_id ? playerProfileNameMap.get(row.player_profile_id) : null) ??
          (row.profile_id ? profileNameMap.get(row.profile_id) : null) ??
          (row.participant_type === "guest" ? row.guest_name : null);
        const memberProfileId = row.player_profile_id ?? row.profile_id;
        const isMemberCandidate = row.participant_type === "guest" || !event?.club_id || (memberProfileId ? activeMemberProfileIds.has(memberProfileId) : false);

        return {
          id: row.id,
          profile_id: row.profile_id,
          player_profile_id: row.player_profile_id,
          guest_name: row.guest_name,
          status: statusRevision === participantStatusRevision.current ? row.status : previous.find(p => p.id === row.id)?.status ?? row.status,
          participant_type: row.participant_type,
          display_name: resolvedName ?? null,
          is_member_candidate: isMemberCandidate
        } as Participant;
      })
    );

    const matchQuery = () => supabase
      .from("matches")
      .select("id,event_id,round_id,court_number,created_at,completed,youtube_url,rounds(round_number),match_players(participant_id,team),match_results(id,score_a,score_b,winner_team)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });

    const { data: ms, error: matchLoadError } = await readFriendlyRoundRows((start, end) => matchQuery().order("id").range(start, end));
    if (matchLoadError) { setError("試合履歴を取得できませんでした。画面を更新してください"); return; }

    const normalizedMatches = (ms ?? []).map((m: any) => ({ id: m.id, event_id: m.event_id, round_id: m.round_id ?? null, court_number: m.court_number, created_at: m.created_at, youtube_url: m.youtube_url ?? null, round_number: m.rounds?.round_number ?? 0, lineup_revision: currentLineupVersions?.rounds.find(r=>r.round_id===m.round_id)?.revision ?? 0, completed: m.completed, players: m.match_players ?? [], result: m.match_results?.[0] ?? null }));
    // 遅れて届いた取得結果で、保存中・失敗中のスコアや新しい確定値を上書きしない。
    if (scoreRevision !== scoreQueue.getRevision(scoreScope)) { await loadAll(); return; }
    setMatches(previous => normalizedMatches.map(row => {
      if (!scoreQueue.has(`${scoreScope}${row.id}`) || (confirmFailedScores && scoreQueue.getSnapshot()[`${scoreScope}${row.id}`]?.status === "error")) return row;
      const confirmed = previous.find(match => match.id === row.id);
      return { ...row, completed: confirmed?.completed ?? false, result: confirmed?.result ?? null };
    }));
    const savedScores = Object.fromEntries(normalizedMatches.filter((m: any) => hasEnteredFriendlyMatchScore(m)).map((m: any) => [m.id, { a: m.result.score_a, b: m.result.score_b }]));
    setScoreInputs((prev) => ({ ...savedScores, ...prev }));
    const savedYoutube = Object.fromEntries(normalizedMatches.map((m: any) => [m.id, m.youtube_url ?? ""]));
    setYoutubeInputs((prev) => ({ ...savedYoutube, ...prev }));
    const { data: eventVideos } = await supabase.from("event_video_links").select("id,title,video_url,memo,display_order").eq("event_id", eventId).order("display_order", { ascending: true }).order("created_at", { ascending: true });
    setEventVideoLinks((eventVideos ?? []) as EventVideoLink[]);
    if (allowViewVideoClickCounts) {
      const { data: clickRows, error: clickError } = await supabase.rpc("get_event_video_click_counts", { p_event_id: eventId });
      if (clickError) {
        console.warn("イベント動画クリック数の取得に失敗しました", {
          message: clickError.message,
          code: clickError.code,
          details: clickError.details,
          hint: clickError.hint
        });
        setVideoClickCounts({});
      } else {
        setVideoClickCounts(Object.fromEntries((clickRows ?? []).map((row: any) => [row.match_id, Number(row.click_count ?? 0)])));
      }
    } else {
      setVideoClickCounts({});
    }
    if (allowViewVideoClickCounts) {
      const { data: eventVideoClickRows, error: eventVideoClickError } = await supabase.rpc("get_event_video_link_click_counts", { p_event_id: eventId });
      if (eventVideoClickError) {
        console.warn("全試合動画クリック数の取得に失敗しました", { message: eventVideoClickError.message, code: eventVideoClickError.code, details: eventVideoClickError.details, hint: eventVideoClickError.hint });
        setEventVideoClickCounts({});
      } else {
        setEventVideoClickCounts(Object.fromEntries((eventVideoClickRows ?? []).map((row: any) => [row.event_video_link_id, Number(row.click_count ?? 0)])));
      }
    } else {
      setEventVideoClickCounts({});
    }
  };

  useEffect(() => {
    if (unsavedScoreCount) reloadAfterScores.current = true;
    else if (reloadAfterScores.current) { reloadAfterScores.current = false; void loadAll().catch(() => setError("保存後の再読み込みに失敗しました")); }
  }, [unsavedScoreCount]);

  const refreshCourtCount = async () => {
    if (guestMode || eventMode !== "auto" || boardOperation.current || closingEvent.current || showCourtDialog) return;
    const supabase = getSupabaseClient(); if (!supabase) return;
    const revision = scoreQueue.getRevision(scoreScope);
    try {
      const current = await readEventCourts(supabase, eventId);
      if (revision !== scoreQueue.getRevision(scoreScope) || boardOperation.current || closingEvent.current) return;
      setCourtCount(current.court_count);
      if (current.is_deleted) setIsDeletedEvent(true);
      if (current.status === "closed") setEventStatus("closed");
    } catch { /* 生成時にも最新設定を取得する。フォーカス復帰で既存の画面を消さない。 */ }
  };
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void refreshCourtCount(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [eventId, eventMode, guestMode, showCourtDialog]);

  const closeCourtDialog = () => {
    if (boardOperation.current === "court") return;
    courtDialogRequest.current++; setShowCourtDialog(false); setCourtLoading(false); setCourtReady(false);
  };
  const openCourtDialog = async () => {
    if ((!guestMode && !canManageEventName) || eventStatus === "closed" || eventMode !== "auto" || boardOperation.current || closingEvent.current) return;
    const request = ++courtDialogRequest.current;
    setCourtDraft(courtCount); setCourtBeforeEdit(courtCount); setCourtError(""); setCourtReady(false); setShowCourtDialog(true); setCourtLoading(true);
    try {
      let current: { court_count: number; status: string; is_deleted?: boolean; event_mode: string | null };
      if (guestMode) { const guest = getGuestEvent(eventId); if (!guest) throw new Error("イベントが見つかりません"); current = { ...guest, event_mode: guest.event_mode ?? "auto" }; }
      else { const supabase = getSupabaseClient(); if (!supabase) throw new Error("設定の準備ができませんでした"); current = await readEventCourts(supabase, eventId); }
      if (request !== courtDialogRequest.current) return;
      if (current.status === "closed") setEventStatus("closed");
      if (current.is_deleted || current.status !== "active" || (current.event_mode ?? "auto") !== "auto") throw new Error("開催中の自動生成イベントのみ変更できます");
      setCourtCount(current.court_count); setCourtBeforeEdit(current.court_count); setCourtDraft(current.court_count); setCourtReady(true);
    } catch (cause) { if (request === courtDialogRequest.current) setCourtError(cause instanceof Error ? cause.message : "利用コート数を取得できませんでした"); }
    finally { if (request === courtDialogRequest.current) setCourtLoading(false); }
  };
  const saveCourtCount = async () => {
    if (boardOperation.current || isGeneratingRound || closingEvent.current) return;
    if (!courtReady) return setCourtError("現在の設定を確認できていません。閉じて再度お試しください");
    if ((!guestMode && !canManageEventName) || eventStatus !== "active" || eventMode !== "auto") return setCourtError("このイベントのコート数を変更する権限がありません");
    if (!validCourtCount(courtDraft)) return setCourtError("利用コート数は1〜5面で選択してください");
    boardOperation.current = "court"; setCourtSaving(true); setCourtError("");
    try {
      let saved: number;
      if (guestMode) {
        const guest = getGuestEvent(eventId);
        if (!guest || guest.status !== "active" || (guest.event_mode ?? "auto") !== "auto" || guest.court_count !== courtBeforeEdit) throw new Error("設定または開催状態が変更されています。閉じて再操作してください");
        upsertGuestEvent({ ...guest, court_count: courtDraft }); saved = courtDraft;
      } else {
        const supabase = getSupabaseClient(); if (!supabase) throw new Error("設定の準備ができませんでした");
        saved = await saveEventCourts(supabase, eventId, courtBeforeEdit, courtDraft);
      }
      scoreQueue.invalidateReads(scoreScope); setCourtCount(saved); courtDialogRequest.current++;
      setShowCourtDialog(false); setMessage(`利用コート数を${saved}面に変更しました。次Roundから適用します`);
    } catch (cause) { setCourtError(cause instanceof Error ? cause.message : "利用コート数を保存できませんでした"); }
    finally { boardOperation.current = null; setCourtSaving(false); }
  };

  const startEventNameEdit = () => {
    setError("");
    setMessage("");
    setEventNameDraft(eventName === "-" ? "" : eventName);
    setIsEditingEventName(true);
  };

  const cancelEventNameEdit = () => {
    setEventNameDraft("");
    setIsEditingEventName(false);
  };

  const saveEventName = async () => {
    setError("");
    setMessage("");
    const nextName = eventNameDraft.trim();
    if (!nextName) return setError("イベント名を入力してください");
    if (nextName.length > 80) return setError("イベント名は80文字以内で入力してください");
    if (!eventId) return;

    if (guestMode) {
      const ge = getGuestEvent(eventId);
      if (!ge) return setError("イベントが見つかりません");
      upsertGuestEvent({ ...ge, name: nextName });
      setEventName(nextName);
      setIsEditingEventName(false);
      setMessage("更新しました");
      return;
    }

    if (!canManageEventName) return setError("この操作を行う権限がありません");
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: saved, error: e } = await supabase.from("events").update({ name: nextName, updated_at: new Date().toISOString() }).eq("id", eventId).eq("is_deleted", false).select("id").single();
    if (e || saved?.id !== eventId) return setError("更新に失敗しました。所属状態を確認し、再読み込みしてお試しください");
    setEventName(nextName);
    setIsEditingEventName(false);
    setMessage("更新しました");
  };

  const generateShareToken = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
  };
  const shareUrl = useMemo(() => {
    if (!shareToken || typeof window === "undefined") return "";
    return `${window.location.origin}/share/events/${shareToken}`;
  }, [shareToken]);
  const logShareContext = (reason: string, extra?: Record<string, unknown>) => {
    console.warn(reason, {
      eventId,
      eventMode,
      isClubIdNull: eventClubId === null,
      status: eventStatus,
      canShare: canManageShare,
      canManage: canManageShare,
      ...extra
    });
  };

  const updateShareLink = async (rotate: boolean) => {
    setError("");
    setMessage("");
    if (!eventId) {
      logShareContext("共有リンク更新を中止しました: イベント情報なし");
      return setError("イベント情報を取得できていません");
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      logShareContext("共有リンク更新を中止しました: Supabaseクライアントなし");
      return setError("Supabaseクライアントを初期化できませんでした");
    }
    if (eventStatus !== "closed") {
      logShareContext("共有リンク更新を中止しました: イベント未終了");
      return setError("終了済みイベントのみ共有リンクを作成できます");
    }
    if (!canManageShare) {
      logShareContext("共有リンク更新を中止しました: 権限不足", { creatorMatched: false });
      return setError("この操作を行う権限がありません");
    }
    const token = generateShareToken();
    const { error: e } = await supabase.from("events").update({ share_enabled: true, share_token: token, share_token_updated_at: new Date().toISOString() }).eq("id", eventId).eq("status", "closed").eq("is_deleted", false);
    if (e) {
      console.error("共有リンクの更新に失敗しました", { eventId, eventMode, isClubIdNull: eventClubId === null, status: eventStatus, canShare: canManageShare, canManage: canManageShare, message: e.message, code: e.code, details: e.details, hint: e.hint });
      return setError(rotate ? "共有リンクの再発行に失敗しました" : "共有リンクの作成に失敗しました");
    }
    setShareEnabled(true);
    setShareToken(token);
    setMessage(rotate ? "共有リンクを再発行しました" : "共有リンクを作成しました");
    try {
      const url = `${window.location.origin}/share/events/${token}`;
      await navigator.clipboard.writeText(url);
      setMessage(rotate ? "共有リンクを再発行してコピーしました" : "共有リンクを作成してコピーしました");
    } catch (copyError) {
      console.warn("共有リンクのコピーに失敗しました", { eventId, eventMode, isClubIdNull: eventClubId === null, status: eventStatus, canShare: canManageShare, canManage: canManageShare, message: copyError instanceof Error ? copyError.message : String(copyError) });
    }
  };

  const createShareLink = async () => updateShareLink(false);
  const reissueShareLink = async () => updateShareLink(true);
  const stopShareLink = async () => {
    setError("");
    setMessage("");
    if (!eventId) { logShareContext("共有停止を中止しました: イベント情報なし"); return setError("イベント情報を取得できていません"); }
    const supabase = getSupabaseClient();
    if (!supabase) { logShareContext("共有停止を中止しました: Supabaseクライアントなし"); return setError("Supabaseクライアントを初期化できませんでした"); }
    if (!canManageShare) { logShareContext("共有停止を中止しました: 権限不足"); return setError("この操作を行う権限がありません"); }
    const { error: e } = await supabase.from("events").update({ share_enabled: false, share_token: null, share_token_updated_at: new Date().toISOString() }).eq("id", eventId);
    if (e) { console.error("共有停止に失敗しました", { eventId, eventMode, isClubIdNull: eventClubId === null, status: eventStatus, canShare: canManageShare, canManage: canManageShare, message: e.message, code: e.code, details: e.details, hint: e.hint }); return setError("共有停止に失敗しました"); }
    setShareEnabled(false); setShareToken(null); setMessage("共有を停止しました");
  };
  const copyShareLink = async () => {
    setError("");
    setMessage("");
    if (!canCopyShare) return setError("この操作を行う権限がありません");
    if (!shareEnabled || !shareToken || !shareUrl) return setError("このイベントは共有されていません");
    try {
      await navigator.clipboard.writeText(shareUrl);
      setMessage("共有リンクをコピーしました");
    } catch (copyError) {
      console.warn("共有リンクのコピーに失敗しました", { eventId, eventMode, isClubIdNull: eventClubId === null, status: eventStatus, canShare: canManageShare, canManage: canManageShare, message: copyError instanceof Error ? copyError.message : String(copyError) });
      setError("コピーに失敗しました。URLを手動でコピーしてください");
    }
  };

  useEffect(() => {
    void loadAll();
  }, [eventId]);

  useEffect(() => {
    if (eventMode !== "manual") return;
    setManualDrafts((prev) => {
      if (prev.length) return prev;
      return Array.from({ length: Math.max(1, courtCount) }, (_, i) => ({ id: `draft_${Date.now()}_${i}`, court_number: i + 1, teamA1: "", teamA2: "", teamB1: "", teamB2: "" }));
    });
  }, [courtCount, eventMode]);


  useEffect(() => {
    const checkAuth = async () => {
      if (typeof eventId === "string" && eventId.startsWith("guest_") && isGuestModeEnabled()) return;
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) router.replace("/");
    };
    void checkAuth();
  }, [router]);

  const addGuest = async () => {
    if (guestMode) {
      if (!guestName.trim() || !eventId) return;
      const ge = getGuestEvent(eventId);
      if (!ge) return;
      ge.participants.push({ id: `gp_${Date.now()}`, guest_name: guestName.trim(), status: "active", participant_type: "guest" });
      upsertGuestEvent(ge);
      setGuestName("");
      await loadAll();
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase || !guestName.trim() || !eventId) return;
    const normalizeName = (v: string) => v.trim().toLowerCase();
    const newGuest = normalizeName(guestName);
    const exists = participants.some((p) => normalizeName(p.display_name ?? (p.participant_type === "guest" ? (p.guest_name ?? "") : "")) === newGuest);
    if (exists) {
      setError("同じ名前の参加者が既にいます");
      return;
    }
    setError("");
    await supabase.from("event_participants").insert({ event_id: eventId, guest_name: guestName.trim(), status: "active" });
    setGuestName("");
    await loadAll();
  };

  const saveGuestName = async (participantId: string) => {
    if (guestMode && eventId) {
      const ge = getGuestEvent(eventId);
      if (!ge) return;
      ge.participants = ge.participants.map((p) => p.id === participantId ? { ...p, guest_name: editingGuestName.trim() } : p);
      upsertGuestEvent(ge);
      setEditingGuestId(null);
      setEditingGuestName("");
      await loadAll();
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return;
    const normalizeName = (v: string) => v.trim().toLowerCase();
    const candidate = normalizeName(editingGuestName);
    if (!candidate) {
      setError("ゲスト名を入力してください");
      return;
    }
    const exists = participants.some((p) => p.id !== participantId && normalizeName(p.display_name ?? (p.participant_type === "guest" ? (p.guest_name ?? "") : "")) === candidate);
    if (exists) {
      setError("同じ名前の参加者が既にいます");
      return;
    }
    setError("");
    await supabase.from("event_participants").update({ guest_name: editingGuestName.trim() }).eq("id", participantId).eq("event_id", eventId);
    setEditingGuestId(null);
    setEditingGuestName("");
    await loadAll();
  };

  const goTop = async () => {
    if (scoreQueue.hasUnsaved(scoreScope) || closingEvent.current) return setError("未保存のスコアがあります。保存完了または再試行後に移動してください");
    if (guestMode && eventId) {
      removeGuestEvent(eventId);
      router.push("/");
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      router.push("/");
      return;
    }
    const { data } = await supabase.auth.getSession();
    router.push(data.session ? "/home" : "/");
  };

  // next未指定は確認用の再取得。更新に成功するまで表示上の状態を変更しない。
  const updateStatus = async (participantId: string, next?: ParticipantStatus) => {
    if (participantWrites.current.has(participantId)) return;
    if (next && (eventStatus !== "active" || (!guestMode && !canManageEventName) || boardOperation.current || closingEvent.current)) return;
    const participant = participants.find(p => p.id === participantId);
    if (!participant) return;
    participantWrites.current.add(participantId); setBusyParticipants(new Set(participantWrites.current));
    participantStatusRevision.current++;
    setParticipantErrors(previous => { const errors = { ...previous }; delete errors[participantId]; return errors; });
    try {
      let status: ParticipantStatus;
      if (guestMode) {
        const ge = getGuestEvent(eventId), rows = ge?.participants.filter(p => p.id === participantId) ?? [];
        if (!ge || rows.length !== 1) throw new Error("参加状態を確認できませんでした。");
        if (next) {
          if (ge.status !== "active" || rows[0].status !== participant.status) throw new Error("参加状態が変更されています。状態を再読み込みしてください。");
          rows[0].status = next; upsertGuestEvent(ge);
        }
        const saved = getGuestEvent(eventId)?.participants.find(p => p.id === participantId);
        if (!saved || (next && saved.status !== next)) throw new Error("参加状態の保存結果を確認できませんでした。");
        status = saved.status;
      } else {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error("参加状態の保存先を確認できませんでした。");
        const saved = next ? await saveParticipantStatus(supabase, eventId, participantId, participant.status, next) : await readParticipantStatus(supabase, eventId, participantId);
        status = saved.status;
      }
      setParticipants(previous => previous.map(p => p.id === participantId ? { ...p, status } : p));
      setMessage(next ? "" : "参加状態を再取得しました。");
    } catch (cause) {
      setParticipantErrors(previous => ({ ...previous, [participantId]: cause instanceof Error ? cause.message : "参加状態の更新に失敗しました。" }));
    } finally {
      participantStatusRevision.current++;
      participantWrites.current.delete(participantId); setBusyParticipants(new Set(participantWrites.current));
    }
  };

  const scrollToResults = () => {
    setEventTab({ eventId, value: "results" });
    requestAnimationFrame(() => document.getElementById("event-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const reloadFixedPairs = async () => {
    const supabase = getSupabaseClient(), scope = fixedScope.current;
    if (!supabase || !eventId || !fixedFeature) return;
    try { const current = await readEventFixedPairs(supabase, eventId); if (scope === fixedScope.current) { fixedOwner.current = roundUserId; setFixedState(current); setFixedError(""); } }
    catch (cause) { if (scope === fixedScope.current) { setFixedState(null); setFixedError(cause instanceof Error ? cause.message : "固定設定を確認できませんでした"); } }
  };
  const saveFixedPairs = async (pairs: FixedPair[]) => {
    const supabase = getSupabaseClient(), scope = fixedScope.current;
    if (!supabase || !scopedFixedState || !fixedFeature || eventStatus !== "active" || boardOperation.current || closingEvent.current) return false;
    boardOperation.current = "fixed"; setFixedSaving(true); setFixedError(""); setMessage("");
    try {
      const current = await saveEventFixedPairs(supabase, scopedFixedState, pairs, crypto.randomUUID());
      if (scope !== fixedScope.current) return false;
      setFixedState(current); setMessage("固定ペア設定を保存しました。次Roundから反映します"); return true;
    } catch (cause) { if (scope === fixedScope.current) setFixedError(cause instanceof Error ? cause.message : "固定ペアの保存に失敗しました"); return false; }
    finally { boardOperation.current = null; setFixedSaving(false); }
  };
  const openCloseEvent = async () => {
    if (boardOperation.current || closingEvent.current) return;
    const supabase = getSupabaseClient(), scope = fixedScope.current;
    if (fixedFeature && supabase && eventId) {
      try {
        const current = await readEventFixedPairs(supabase, eventId);
        if (scope !== fixedScope.current) return;
        fixedOwner.current = roundUserId; setFixedState(current); setFixedCloseChoice(null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "固定ペアの利用状況を確認できませんでした"); return; }
    }
    setShowCloseModal(true);
  };

  const closeEvent = async () => {
    if (closingEvent.current) return;
    if (boardOperation.current) return setError("Round生成・削除・コート数保存の完了後に終了してください");
    if (scoreQueue.hasUnsaved(scoreScope) || scoreSaveState.current.saving.size) return setError("保存中または保存失敗のスコアがあります。保存完了・再試行後に終了してください");
    closingEvent.current = true; setIsClosingEvent(true);
    try {
    if (guestMode && eventId) {
      const ge = getGuestEvent(eventId);
      if (!ge) return;
      ge.status = "closed";
      if ((ge.event_mode ?? "auto") === "manual") ge.stats_mode = closeStatsMode === "record_only" ? "record_only" : "official";
      else ge.stats_mode = "official";
      upsertGuestEvent(ge);
      scoreQueue.invalidateReads(scoreScope);setEventStatus("closed");
      setShowCloseModal(false);
      scrollToResults();
      await loadAll();
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return;
    if (fixedFeature) {
      const current = await readEventFixedPairs(supabase, eventId);
      fixedOwner.current = roundUserId; setFixedState(current);
      if (current.used_fixed_pairs && !fixedCloseChoice) return setError("このイベントの戦績反映方法を選択してください");
      if (current.used_fixed_pairs) {
        await finishEventWithFixedPairs(supabase, current, true, fixedCloseChoice!);
        scoreQueue.invalidateReads(scoreScope); setEventStatus("closed"); setShowCloseModal(false); scrollToResults(); await loadAll(); return;
      }
    }
    const { error: closeError } = await supabase
      .from("events")
      .update({ status: "closed", closed_at: new Date().toISOString(), stats_mode: eventMode === "manual" ? closeStatsMode : "official" })
      .eq("id", eventId).eq("is_deleted", false).select("id").single();
    if (closeError) { console.error("イベント終了の保存失敗", { code: closeError.code, message: closeError.message }); return setError("イベントの終了に失敗しました。再読み込みし、所属状態と保存済みスコアを確認してください"); }
    scoreQueue.invalidateReads(scoreScope);setEventStatus("closed");
    setShowCloseModal(false);
    scrollToResults();
    await loadAll();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "終了処理に失敗しました"); }
    finally { closingEvent.current = false; setIsClosingEvent(false); }
  };
  const reopenEvent = async () => {
    if (boardOperation.current || closingEvent.current) return;
    if (fixedFeature && eventId) {
      const supabase = getSupabaseClient(); if (!supabase) return;
      closingEvent.current = true; setIsClosingEvent(true);
      try {
        const current = await readEventFixedPairs(supabase, eventId);
        const saved = await finishEventWithFixedPairs(supabase, current, false);
        scoreQueue.invalidateReads(scoreScope); setEventStatus("active"); setStatsMode(saved.stats_mode); setEventTab({ eventId, value: "matches" }); await loadAll();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "再開処理に失敗しました"); }
      finally { closingEvent.current = false; setIsClosingEvent(false); }
      return;
    }
    if (guestMode && eventId) {
      const ge = getGuestEvent(eventId);
      if (!ge) return;
      ge.status = "active";
      if ((ge.event_mode ?? "auto") === "manual") ge.stats_mode = "undecided";
      upsertGuestEvent(ge);scoreQueue.invalidateReads(scoreScope);setEventStatus("active");
      setEventTab({ eventId, value: "matches" });
      await loadAll();
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return;
    const { error: reopenError } = await supabase.from("events").update({ status: "active", stats_mode: eventMode === "manual" ? "undecided" : "official" })
      .eq("id", eventId).eq("is_deleted", false).select("id").single();
    if (reopenError) { console.error("イベント再開の保存失敗", { code: reopenError.code, message: reopenError.message }); return setError("イベントの再開に失敗しました。再読み込みし、所属状態を確認してください"); }
    scoreQueue.invalidateReads(scoreScope);setEventStatus("active");
    setEventTab({ eventId, value: "matches" });
    await loadAll();
  };

  const saveScore = async (matchId: string, entered?: ScorePair, send?: ReturnType<typeof createFriendlyScoreCommit> | null) => {
    if (boardOperation.current === "lineup") { scoreSaveState.current.error="メンバー変更の完了後に保存してください"; return false; }
    if (closingEvent.current) { setError("イベントの終了処理中です"); return false; }
    if (scoreSaveState.current.saving.has(matchId)) return false;
    const score: ScoreInput | undefined = entered ? { a: entered.a.trim() === "" ? "" : Number(entered.a), b: entered.b.trim() === "" ? "" : Number(entered.b) } : scoreInputs[matchId];
    if (!score || score.a === "" || score.b === "") { setError("スコアを入力してください"); return false; }
    const targetMatch = matches.find(m => m.id === matchId);
    if (!targetMatch || eventStatus === "closed") { setError("この試合は編集できません"); return false; }
    scoreSaveState.current.saving.add(matchId);scoreSaveState.current.error="";setMessage("");setError("");
    try {
      const winner = getWinnerTeam(Number(score.a), Number(score.b));
      let resultId = targetMatch.result?.id ?? scoreSaveState.current.resultIds.get(matchId);
      if (guestMode && eventId) {
        const ge = getGuestEvent(eventId);
        if (!ge) throw new Error("イベントが見つかりません");
        const current = ge.matches.find(m=>m.id===matchId);
        if (!current || JSON.stringify(canonicalPlayers(current.players)) !== JSON.stringify(canonicalPlayers(targetMatch.players))) throw new Error("メンバー構成が変更されています。選手を確認してスコアを再入力してください。");
        ge.matches = ge.matches.map(m => m.id === matchId ? { ...m, completed: true, result: { score_a: Number(score.a), score_b: Number(score.b), winner_team: winner } } : m);
        upsertGuestEvent(ge);
      } else {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error("保存の準備ができませんでした");
        if (eventMode === "auto") {
          const saved = await (send ?? createFriendlyScoreCommit(supabase,eventId,targetMatch))(Number(score.a),Number(score.b));
          resultId = saved.id;
        } else {
        // 手動Roundの既存保存経路は維持する。
        if (!resultId) {
          const existing = await supabase.from("match_results").select("id").eq("match_id", matchId).maybeSingle();
          if (existing.error) throw new Error("保存済みスコアを確認できませんでした");
          resultId = existing.data?.id;
        }
        const write = resultId
          ? supabase.from("match_results").update({ score_a: score.a, score_b: score.b, winner_team: winner }).eq("id", resultId)
          : supabase.from("match_results").insert({ match_id: matchId, score_a: score.a, score_b: score.b, winner_team: winner });
        const saved = await write.select("id").single();
        if (saved.error || !saved.data) throw new Error("スコアの保存に失敗しました");
        resultId = saved.data.id;
        scoreSaveState.current.resultIds.set(matchId, resultId!);
        if (!targetMatch.completed) {
          const complete = await supabase.from("matches").update({ completed: true }).eq("id", matchId).select("id").single();
          if (complete.error) throw new Error("試合の確定に失敗しました。再度保存してください");
        }
      }
      }
      setMatches(previous => previous.map(m => m.id === matchId ? { ...m, completed: true, result: { id: resultId, score_a: Number(score.a), score_b: Number(score.b), winner_team: winner } } : m));
      setScoreInputs(previous => ({ ...previous, [matchId]: score }));
      // 保存済み履歴を正本として再取得する。取得失敗を保存の失敗と取り違えない。
      try { await loadAll(); } catch { setError("保存は完了しましたが、再読み込みに失敗しました"); }
      return true;
    } catch (cause) { const message=cause instanceof Error ? cause.message : "スコアの保存に失敗しました";scoreSaveState.current.error=message; return false; }
    finally { scoreSaveState.current.saving.delete(matchId); }
  };

  const openLineupEditor = async (match: MatchView) => {
    if (document.querySelectorAll('dialog[open]').length > (allHistoryOpen ? 1 : 0)) return setError("開いている入力を確定またはキャンセルしてから操作してください。");
    if (boardOperation.current || closingEvent.current || scoreQueue.hasUnsaved(scoreScope) || busyParticipants.size) return setError("保存中・未保存の操作を完了してからメンバーを変更してください。");
    if (eventMode !== "auto" || eventStatus !== "active" || (!guestMode && !canManageEventName) || match.completed || match.result) return;
    boardOperation.current="lineup";setLineupLoading(true);setError("");
    try {
      if (guestMode) {
        const event=getGuestEvent(eventId);if(!event)throw new Error("ゲストイベントが見つかりません。");
        const expected=guestLineupSnapshot(event), cards=roundCards(event,match.round_number);
        setLineupEditor({target:match.id,data:{round:match.round_number,cards:cards.map(c=>({...c,court_number:event.matches.find(m=>m.id===c.id)!.court_number})),people:event.participants.map(p=>({id:p.id,name:p.guest_name})),eligible:event.participants.filter(p=>p.status==="active").map(p=>p.id)},save:async cards=>saveGuestRoundLineup(eventId,expected,match.round_number,cards,{read:getGuestEvent,write:upsertGuestEvent})});
      } else {
        const db=getSupabaseClient();if(!db||!match.round_id)throw new Error("Roundの情報を確認できません。");
        const snapshot=await readRoundLineup(db,eventId,match.round_id);
        setLineupEditor({target:match.id,data:{round:snapshot.round_number,cards:snapshot.cards.map(c=>({...c,result:c.result.length?c.result:null})),people:snapshot.people,eligible:snapshot.eligible,blocked_reason:snapshot.blocked_reason},save:createLineupCommit(db,snapshot)});
      }
    } catch(cause) {boardOperation.current=null;setError(cause instanceof Error?cause.message:"メンバー変更を開けませんでした。");}
    finally {setLineupLoading(false);}
  };
  const closeLineupEditor = () => {if(lineupSaving)return;setLineupEditor(null);boardOperation.current=null;void loadAll().catch(()=>setError("最新の構成を再取得してください。"));};
  const commitLineupEditor = async (cards: RoundCard[]) => {
    if (!lineupEditor || lineupSaving) return;
    setLineupSaving(true);
    try {await lineupEditor.save(cards);setLineupEditor(null);boardOperation.current=null;scoreQueue.invalidateReads(scoreScope);await loadAll();}
    finally {setLineupSaving(false);}
  };

  const matchHasSavedScore = (match: MatchView) => {
    const score = scoreInputs[match.id];
    return hasEnteredFriendlyMatchScore(match) || (score?.a !== undefined && score.a !== "") || (score?.b !== undefined && score.b !== "");
  };

  const requestMatchDelete = (match: MatchView) => {
    if (boardOperation.current) return setError("処理の完了後に削除を操作してください");
    if (scoreQueue.has(`${scoreScope}${match.id}`)) return setError("この試合のスコアを保存完了・再試行してから操作してください");
    if (eventMode !== "auto" || eventStatus === "closed") return;
    setError("");
    setMatchDeleteTarget({ id: match.id, hasScore: matchHasSavedScore(match) });
    // 確認を独立したdialogへ出すため、復帰先のボタンを画面外へ動かさない。
    setSwipeOffsets((prev) => ({ ...prev, [match.id]: 0 }));
  };

  const cancelMatchDelete = () => {
    const id = matchDeleteTarget?.id;
    setMatchDeleteTarget(null);
    if (id) setSwipeOffsets((prev) => ({ ...prev, [id]: 0 }));
  };

  const logSupabaseError = (label: string, error: unknown) => {
    if (!isSupabaseErrorLike(error)) return console.error(label, error);
    console.error(label, { message: error.message, code: error.code, details: error.details, hint: error.hint });
  };

  const renumberRoundsAfterDeletedRound = async (deletedRoundNumber: number) => {
    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return false;
    const { data: laterRounds, error: fetchError } = await supabase
      .from("rounds")
      .select("id,round_number")
      .eq("event_id", eventId)
      .gt("round_number", deletedRoundNumber)
      .order("round_number", { ascending: true });
    if (fetchError) {
      logSupabaseError("rounds renumber fetch failed", fetchError);
      setError("Round番号の更新に失敗しました");
      return false;
    }
    const rounds = (laterRounds ?? []) as { id: string; round_number: number }[];
    for (const round of rounds) {
      const { error: tempError } = await supabase
        .from("rounds")
        .update({ round_number: -100000 - round.round_number })
        .eq("id", round.id);
      if (tempError) {
        logSupabaseError("rounds renumber temp update failed", tempError);
        setError("Round番号の更新に失敗しました");
        return false;
      }
    }
    for (const round of rounds) {
      const { error: finalError } = await supabase
        .from("rounds")
        .update({ round_number: round.round_number - 1 })
        .eq("id", round.id);
      if (finalError) {
        logSupabaseError("rounds renumber final update failed", finalError);
        setError("Round番号の更新に失敗しました");
        return false;
      }
    }
    return true;
  };

  const deleteEmptyRoundAndRenumber = async (roundId: string | null | undefined, deletedRoundNumber: number) => {
    if (!roundId) return true;
    const supabase = getSupabaseClient();
    if (!supabase) return false;
    const { count, error: countError } = await supabase
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("round_id", roundId);
    if (countError) {
      logSupabaseError("round matches count failed", countError);
      setError("Roundの削除に失敗しました");
      return false;
    }
    if ((count ?? 0) > 0) return true;
    const { error: roundDeleteError } = await supabase.from("rounds").delete().eq("id", roundId);
    if (roundDeleteError) {
      logSupabaseError("round delete failed", roundDeleteError);
      setError("Roundの削除に失敗しました");
      return false;
    }
    return renumberRoundsAfterDeletedRound(deletedRoundNumber);
  };


  const deleteMatch = async () => {
    if (!matchDeleteTarget) return;
    const matchId = matchDeleteTarget.id;
    if (scoreQueue.has(`${scoreScope}${matchId}`) || closingEvent.current) return setError("この試合の保存・終了処理が完了してから削除してください");
    const match = matches.find((m) => m.id === matchId);
    if (!match) return cancelMatchDelete();
    if (guestMode && eventId) {
      const ge = getGuestEvent(eventId);
      if (!ge) return;
      const deletedRoundNumber = match.round_number;
      ge.matches = ge.matches.filter((m) => m.id !== matchId);
      if (!ge.matches.some((m) => m.round_number === deletedRoundNumber)) {
        ge.matches = ge.matches.map((m) => m.round_number > deletedRoundNumber ? { ...m, round_number: m.round_number - 1 } : m);
      }
      upsertGuestEvent(ge);
      setScoreInputs((prev) => { const next = { ...prev }; delete next[matchId]; return next; });
      await loadAll();
      cancelMatchDelete();
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const resultDelete = await supabase.from("match_results").delete().eq("match_id", matchId);
    if (resultDelete.error) { logSupabaseError("match_results delete failed", resultDelete.error); setError("試合の削除に失敗しました"); return; }
    const playersDelete = await supabase.from("match_players").delete().eq("match_id", matchId);
    if (playersDelete.error) { logSupabaseError("match_players delete failed", playersDelete.error); setError("試合の削除に失敗しました"); return; }
    const matchDelete = await supabase.from("matches").delete().eq("id", matchId);
    if (matchDelete.error) { logSupabaseError("matches delete failed", matchDelete.error); setError("試合の削除に失敗しました"); return; }
    const roundUpdated = await deleteEmptyRoundAndRenumber(match.round_id, match.round_number);
    if (!roundUpdated) return;
    setError("");
    setScoreInputs((prev) => { const next = { ...prev }; delete next[matchId]; return next; });
    await loadAll();
    cancelMatchDelete();
  };

  const confirmMatchDelete = async () => {
    if (boardOperation.current || closingEvent.current) return;
    boardOperation.current = "delete"; setIsDeletingMatch(true);
    try { await deleteMatch(); }
    catch { setError("削除に失敗しました。画面を更新して試合の状態を確認してください"); }
    finally { boardOperation.current = null; setIsDeletingMatch(false); }
  };


  const isYoutubeUrl = (v: string) => {
    const u = v.trim();
    return /^https:\/\/(www\.)?youtube\.com\/watch\?v=/.test(u)
      || /^https:\/\/youtu\.be\//.test(u)
      || /^https:\/\/(www\.)?youtube\.com\/shorts\//.test(u);
  };

  const saveYoutubeUrl = async (matchId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const value = (youtubeInputs[matchId] ?? "").trim();
    if (!value) return setError("YouTubeのURLを入力してください");
    if (!isYoutubeUrl(value)) return setError("YouTubeのURLを入力してください");
    const { error: e } = await supabase.from("matches").update({ youtube_url: value }).eq("id", matchId);
    if (e) return setError("YouTubeリンクの保存に失敗しました");
    setError("");
    await loadAll();
  };

  const deleteYoutubeUrl = async (matchId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error: e } = await supabase.from("matches").update({ youtube_url: null }).eq("id", matchId);
    if (e) return setError("YouTubeリンクの削除に失敗しました");
    setYoutubeInputs((prev) => ({ ...prev, [matchId]: "" }));
    await loadAll();
  };

  const resetEventVideoForm = () => {
    setEventVideoForm({ title: "全試合動画", video_url: "", memo: "", display_order: String(eventVideoLinks.length + 1 || 1) });
    setEditingEventVideoId(null);
  };

  const startEventVideoEdit = (video: EventVideoLink) => {
    setEditingEventVideoId(video.id);
    setEventVideoForm({ title: video.title || "全試合動画", video_url: video.video_url ?? "", memo: video.memo ?? "", display_order: String(video.display_order ?? 1) });
  };

  const saveEventVideoLink = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !eventId || !canManageEventVideos) return setError("この操作を行う権限がありません");
    const videoUrl = eventVideoForm.video_url.trim();
    if (videoUrl && !isYoutubeUrl(videoUrl)) return setError("YouTubeのURLを入力してください");
    const payload = {
      event_id: eventId,
      title: eventVideoForm.title.trim() || "全試合動画",
      video_url: videoUrl || null,
      memo: eventVideoForm.memo.trim() || null,
      display_order: Number(eventVideoForm.display_order) || 1,
      updated_at: new Date().toISOString()
    };
    const result = editingEventVideoId
      ? await supabase.from("event_video_links").update(payload).eq("id", editingEventVideoId).eq("event_id", eventId)
      : await supabase.from("event_video_links").insert(payload);
    if (result.error) return setError("動画の保存に失敗しました");
    setError("");
    resetEventVideoForm();
    await loadAll();
  };

  const deleteEventVideoLink = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !eventId || !deleteEventVideoId || !canManageEventVideos) return;
    const { error: e } = await supabase.from("event_video_links").delete().eq("id", deleteEventVideoId).eq("event_id", eventId);
    if (e) return setError("動画の削除に失敗しました");
    setDeleteEventVideoId(null);
    if (editingEventVideoId === deleteEventVideoId) resetEventVideoForm();
    await loadAll();
  };

  const generateRound = async () => {
    if (isGeneratingRound || boardOperation.current || closingEvent.current) return;
    if (eventMode !== "auto") {
      setError("手動作成イベントでは手動で試合を作成してください");
      return;
    }
    if (eventStatus === "closed") {
      setError("終了済みイベントはRound生成できません");
      return;
    }

    if (guestMode && eventId) {
      boardOperation.current = "round";
      setIsGeneratingRound(true);
      try {
      const active = candidateParticipants;
      if (active.length < 4) return setError("アクティブ参加者が4人未満のためRound生成できません");
      const maxMatches = Math.min(courtCount, Math.floor(active.length / 4));
      const slots = maxMatches * 4;
      const shuffled = [...active].sort(() => Math.random() - 0.5).slice(0, slots);
      const ge = getGuestEvent(eventId);
      if (!ge) return;
      const nextRound = (Math.max(0, ...ge.matches.map((m) => m.round_number)) + 1);
      const created = Array.from({ length: maxMatches }).map((_, i) => {
        const g = shuffled.slice(i * 4, i * 4 + 4);
        return { id: `gm_${Date.now()}_${i}`, court_number: i + 1, round_number: nextRound, created_at: new Date().toISOString(), completed: false, youtube_url: null, players: [{ participant_id: g[0].id, team: "A" as const }, { participant_id: g[1].id, team: "A" as const }, { participant_id: g[2].id, team: "B" as const }, { participant_id: g[3].id, team: "B" as const }], result: null };
      });
      ge.matches = [...created, ...ge.matches];
      upsertGuestEvent(ge);
      await loadAll();
      return;
      } finally {
        boardOperation.current = null;
        setIsGeneratingRound(false);
      }
    }
    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return;
    boardOperation.current = "round";
    setError("");
    setIsGeneratingRound(true);

    try {
    if (!roundUserId) throw new Error("ログインしてからRoundを生成してください");
    const pending = pendingFixedOwner.current === roundUserId && pendingFixedRound.current?.eventId === eventId ? pendingFixedRound.current : readPendingFixedRound(roundUserId, eventId);
    if (pending) {
      try { await createEventFixedRound(supabase, pending); }
      catch (cause) {
        if (cause instanceof FixedPairRequestError && cause.definitelyRejected) { pendingFixedRound.current = null; storePendingFixedRound(roundUserId, eventId, null); }
        throw cause;
      }
      pendingFixedRound.current = null; storePendingFixedRound(roundUserId, eventId, null);
      await loadAll(); setMessage("前回生成したRoundの保存を確認しました"); return;
    }
    const generationVersions = await readLineupVersions(supabase,eventId);
    const requestedMode = selectedRoundMode;
    // 実行時の状態・参加者・スコアを確認する。履歴取得は既存の問い合わせを拡張する。
    const [eventResult, roundsResult, matchesResult, participantsResult] = await Promise.all([
      supabase.from("events").select("status,is_deleted,event_mode,court_count,club_id,created_at").eq("id", eventId).single(),
      readFriendlyRoundRows((start, end) => supabase.from("rounds").select("id,round_number").eq("event_id", eventId).order("round_number", { ascending: true }).order("id").range(start, end)),
      readFriendlyRoundRows((start, end) => supabase.from("matches").select("id,event_id,round_id,court_number,created_at,completed,youtube_url,match_players(participant_id,team),match_results(id,score_a,score_b,winner_team)").eq("event_id", eventId).order("id").range(start, end)),
      readFriendlyRoundRows((start, end) => supabase.from("event_participants").select("id,status,participant_type,player_profile_id,profile_id").eq("event_id", eventId).order("created_at", { ascending: true }).order("id", { ascending: true }).range(start, end)),
    ]);
    if (eventResult.error || !eventResult.data) throw new Error("イベントの状態を確認できませんでした。再試行してください");
    const currentEvent = eventResult.data;
    if (currentEvent.is_deleted) { setIsDeletedEvent(true); throw new Error("削除済みイベントはRound生成できません"); }
    if (currentEvent.status !== "active") { setEventStatus("closed"); throw new Error("終了済みイベントはRound生成できません"); }
    if ((currentEvent.event_mode ?? "auto") !== "auto") throw new Error("自動生成イベントのみ利用できます。画面を更新してください");
    setCourtCount(currentEvent.court_count);
    if (roundsResult.error || matchesResult.error || participantsResult.error) throw new Error("試合履歴・参加者を確認できませんでした。再試行してください");
    const rounds = roundsResult.data ?? [];
    const roundMap = new Map(rounds.map(r => [r.id, r.round_number as number]));
    const lastRoundNumber = rounds.length ? Math.max(...rounds.map(r => r.round_number as number)) : 0;
    if (lastRoundNumber !== latestRoundNumber) {
      setError("他のユーザーが先にRoundを生成しました。画面を更新したので、追加されたRoundをご確認ください。");
      await loadAll();
      return;
    }
    const historyMatches: MatchView[] = (matchesResult.data ?? []).map((m: any) => ({ id: m.id, event_id: m.event_id, round_id: m.round_id, court_number: m.court_number, created_at: m.created_at, youtube_url: m.youtube_url, round_number: roundMap.get(m.round_id) ?? 0, completed: m.completed, players: m.match_players ?? [], result: m.match_results?.[0] ?? null }));
    const knownIds = new Set((participantsResult.data ?? []).map(p => p.id as string));
    if (requestedMode !== "normal" && scoredFriendlyMatches(eventId, historyMatches, knownIds).length < FRIENDLY_MODE_UNLOCK_MATCHES) {
      await loadAll();
      throw new Error("スコア登録済み試合が10試合未満になったため、選択中の特別モードは利用できません。通常モードを選択するかスコアを登録してください");
    }
    const members = currentEvent.club_id ? await fetchActiveClubMemberParticipants(supabase, currentEvent.club_id) : [];
    const memberIds = new Set(members.map(member => member.playerProfileId));
    const activeIds = (participantsResult.data ?? []).filter(p => p.status === "active" && (p.participant_type === "guest" || !currentEvent.club_id || memberIds.has(p.player_profile_id ?? p.profile_id))).map(p => p.id as string);
    const playedToday = requestedMode === "balance" ? new Set(scoredFriendlyMatches(eventId, historyMatches, knownIds).flatMap(match => match.players.map(p => p.participant_id))) : null;
    const pastFormStats = requestedMode === "balance" ? await fetchBalancePastStats(supabase, { id: eventId, club_id: currentEvent.club_id, created_at: currentEvent.created_at }, (participantsResult.data ?? []).filter(p => activeIds.includes(p.id) && playedToday?.has(p.id))) : undefined;
    const currentFixed = currentEvent.club_id ? await readEventFixedPairs(supabase, eventId, true) : null;
    if (currentFixed) { setFixedState(currentFixed); setFixedError(""); }
    const generationInput = { eventId, participantIds: activeIds, knownParticipantIds: knownIds, courtCount: currentEvent.court_count, lastRound: lastRoundNumber, history: historyMatches, mode: requestedMode, pastFormStats };
    const generated = currentFixed?.pairs.length
      ? generateFriendlyRoundWithFixedPairs({ ...generationInput, fixedPairs: currentFixed.pairs, eligibleRounds: currentFixed.eligible_rounds })
      : generateFriendlyRound(generationInput);
    const bestMatches = generated.matches;

    {
      const request: FixedRoundRequest = { eventId, lineupRevision:generationVersions.event_revision, revision: currentFixed?.revision ?? 0, lastRound: lastRoundNumber, courtCount: currentEvent.court_count, mode: requestedMode, activeIds, matches: bestMatches, requestId: crypto.randomUUID() };
      pendingFixedOwner.current = roundUserId; pendingFixedRound.current = request; storePendingFixedRound(roundUserId, eventId, request);
      try { await createEventFixedRound(supabase, request); }
      catch (cause) {
        if (cause instanceof FixedPairRequestError && cause.definitelyRejected) { pendingFixedRound.current = null; storePendingFixedRound(roundUserId, eventId, null); }
        throw cause;
      }
      pendingFixedRound.current = null; storePendingFixedRound(roundUserId, eventId, null);
      await loadAll(); return;
    }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Round生成に失敗しました。再試行してください");
    } finally {
      boardOperation.current = null;
      setIsGeneratingRound(false);
    }
  };

  const selectedManualPlayerIds = useMemo(() => manualDrafts.flatMap((d) => [d.teamA1, d.teamA2, d.teamB1, d.teamB2]).filter(Boolean), [manualDrafts]);
  const manualRestingParticipants = useMemo(() => candidateParticipants.filter((p) => !selectedManualPlayerIds.includes(p.id)), [candidateParticipants, selectedManualPlayerIds]);

  const participantLabel = (p: Participant) => p.display_name ?? (p.participant_type === "guest" ? (p.guest_name ?? "ゲスト（名称未設定）") : "メンバー名未設定");
  const createEmptyDraft = (index: number): ManualMatchDraft => ({ id: `draft_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`, court_number: index + 1, teamA1: "", teamA2: "", teamB1: "", teamB2: "" });

  const updateManualDraft = (draftId: string, field: keyof LineupDraft, value: string) => {
    setError("");
    setManualDrafts((prev) => prev.map((d) => d.id === draftId ? { ...d, [field]: value } : d));
  };

  const addManualDraft = () => setManualDrafts((prev) => [...prev, createEmptyDraft(prev.length)]);
  const removeManualDraft = (draftId: string) => setManualDrafts((prev) => prev.length <= 1 ? prev : prev.filter((d) => d.id !== draftId).map((d, i) => ({ ...d, court_number: i + 1 })));

  const validateManualDrafts = (drafts: ManualMatchDraft[]) => {
    const seen = new Set<string>();
    for (const d of drafts) {
      const ids = [d.teamA1, d.teamA2, d.teamB1, d.teamB2];
      if (ids.some((id) => !id)) return "すべての試合で4人を選択してください";
      if (new Set(ids).size !== ids.length) return "同一試合内で同じ人は選択できません";
      for (const id of ids) {
        if (seen.has(id)) return "同一Round内で同じ人を複数試合に出場させることはできません";
        seen.add(id);
      }
    }
    return "";
  };

  const createManualRound = async () => {
    if (eventMode !== "manual") return;
    if (eventStatus === "closed") return setError("終了済みイベントはRound作成できません");
    const validationError = validateManualDrafts(manualDrafts);
    if (validationError) return setError(validationError);

    if (guestMode && eventId) {
      const ge = getGuestEvent(eventId);
      if (!ge) return;
      const nextRound = Math.max(0, ...ge.matches.map((m) => m.round_number)) + 1;
      const now = new Date().toISOString();
      const created = manualDrafts.map((d, i) => ({
        id: `gm_${Date.now()}_${i}`,
        court_number: d.court_number,
        round_number: nextRound,
        created_at: now,
        completed: false,
        youtube_url: null,
        players: [
          { participant_id: d.teamA1, team: "A" as const },
          { participant_id: d.teamA2, team: "A" as const },
          { participant_id: d.teamB1, team: "B" as const },
          { participant_id: d.teamB2, team: "B" as const }
        ],
        result: null
      }));
      ge.matches = [...created, ...ge.matches];
      upsertGuestEvent(ge);
      setManualDrafts(Array.from({ length: Math.max(1, courtCount) }, (_, i) => createEmptyDraft(i)));
      await loadAll();
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return;
    const { data: roundsData } = await supabase.from("rounds").select("id,round_number").eq("event_id", eventId).order("round_number", { ascending: true });
    const lastRoundNumber = (roundsData ?? []).length ? Math.max(...(roundsData ?? []).map((r: any) => r.round_number as number)) : 0;
    if (lastRoundNumber !== latestRoundNumber) {
      setError("他のユーザーが先にRoundを作成しました。画面を更新したので、追加されたRoundをご確認ください。");
      await loadAll();
      return;
    }
    const { data: round, error: roundInsertError } = await supabase.from("rounds").insert({ event_id: eventId, round_number: lastRoundNumber + 1 }).select("id").single();
    if (roundInsertError?.code === "23505") {
      setError("他のユーザーが先にRoundを作成しました。画面を更新したので、追加されたRoundをご確認ください。");
      await loadAll();
      return;
    }
    if (roundInsertError || !round) return setError("Round作成に失敗しました");

    for (const d of manualDrafts) {
      const { data: match } = await supabase.from("matches").insert({ event_id: eventId, round_id: round.id, court_number: d.court_number, completed: false }).select("id").single();
      if (!match) continue;
      await supabase.from("match_players").insert([
        { match_id: match.id, participant_id: d.teamA1, team: "A" },
        { match_id: match.id, participant_id: d.teamA2, team: "A" },
        { match_id: match.id, participant_id: d.teamB1, team: "B" },
        { match_id: match.id, participant_id: d.teamB2, team: "B" }
      ]);
    }
    setManualDrafts(Array.from({ length: Math.max(1, courtCount) }, (_, i) => createEmptyDraft(i)));
    await loadAll();
  };

  const startLineupEdit = (match: MatchView) => {
    if (scoreQueue.has(`${scoreScope}${match.id}`) || closingEvent.current) return;
    if (match.completed) return;
    const a = match.players.filter((p) => p.team === "A");
    const b = match.players.filter((p) => p.team === "B");
    setLineupDrafts((prev) => ({ ...prev, [match.id]: { teamA1: a[0]?.participant_id ?? "", teamA2: a[1]?.participant_id ?? "", teamB1: b[0]?.participant_id ?? "", teamB2: b[1]?.participant_id ?? "" } }));
  };

  const saveLineupEdit = async (matchId: string) => {
    if (scoreQueue.has(`${scoreScope}${matchId}`) || closingEvent.current) return setError("スコアの保存完了・再試行後に組み合わせを編集してください");
    const draft = lineupDrafts[matchId];
    if (!draft) return;
    const validationError = validateManualDrafts([{ id: matchId, court_number: 1, ...draft }]);
    if (validationError) return setError(validationError);
    const match = matches.find((m) => m.id === matchId);
    if (!match || match.completed) return setError("スコア入力済みのため組み合わせは編集できません");
    const editedIds = [draft.teamA1, draft.teamA2, draft.teamB1, draft.teamB2];
    const sameRoundOtherIds = matches
      .filter((m) => m.id !== matchId && m.round_number === match.round_number)
      .flatMap((m) => m.players.map((p) => p.participant_id));
    if (editedIds.some((id) => sameRoundOtherIds.includes(id))) {
      return setError("同一Round内で同じ人を複数試合に出場させることはできません");
    }

    if (guestMode && eventId) {
      const ge = getGuestEvent(eventId);
      if (!ge) return;
      ge.matches = ge.matches.map((m) => m.id === matchId ? { ...m, players: [
        { participant_id: draft.teamA1, team: "A" as const },
        { participant_id: draft.teamA2, team: "A" as const },
        { participant_id: draft.teamB1, team: "B" as const },
        { participant_id: draft.teamB2, team: "B" as const }
      ] } : m);
      upsertGuestEvent(ge);
      setLineupDrafts((prev) => { const next = { ...prev }; delete next[matchId]; return next; });
      await loadAll();
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return;
    await supabase.from("match_players").delete().eq("match_id", matchId);
    const { error: e } = await supabase.from("match_players").insert([
      { match_id: matchId, participant_id: draft.teamA1, team: "A" },
      { match_id: matchId, participant_id: draft.teamA2, team: "A" },
      { match_id: matchId, participant_id: draft.teamB1, team: "B" },
      { match_id: matchId, participant_id: draft.teamB2, team: "B" }
    ]);
    if (e) return setError("組み合わせの保存に失敗しました");
    setLineupDrafts((prev) => { const next = { ...prev }; delete next[matchId]; return next; });
    await loadAll();
  };


  const deleteEvent = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return;
    if (!canDeleteEvent) return setError("この操作を行う権限がありません");
    if (eventStatus !== "closed") return setError("終了済みイベントのみ削除できます");
    const { error: e, count } = await supabase.from("events").update({ is_deleted: true, deleted_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", eventId).eq("status", "closed").eq("is_deleted", false);
    if (e || count !== 1) return setError("イベントの削除に失敗しました");
    setMessage("イベントを削除しました");
    router.push("/home");
  };

  const latestRoundPlayers = new Set(matches.filter(m => m.round_number === latestRoundNumber).flatMap(m => m.players.map(p => p.participant_id)));
  const latestRoundEligibility = displayEligibility?.eventId === eventId && displayEligibility.owner === roundUserId ? displayEligibility.rounds.find(round => round.round === latestRoundNumber) : undefined;
  const participantRoundLabel = (id: string) => {
    if (!latestRoundNumber) return null;
    if (eventMode === "auto" && latestRoundEligibility) {
      if (!latestRoundEligibility.eligible.includes(id)) return `直近Round ${latestRoundNumber} の生成対象外`;
      return latestRoundEligibility.played.includes(id) ? `直近Round ${latestRoundNumber} に出場` : `直近Round ${latestRoundNumber} の自動休憩`;
    }
    if (latestRoundPlayers.has(id)) return `直近Round ${latestRoundNumber} に出場`;
    return `直近Round ${latestRoundNumber} に出場なし${eventMode === "auto" ? "（当時の参加状態は未記録）" : ""}`;
  };

  if (isDeletedEvent) return <main data-friendly-scoreboard className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-1.5 p-3 pb-20"><h1 className="text-xl font-bold">イベント詳細：{eventName}</h1><Card title="イベント詳細"><p className="text-sm text-zinc-300">このイベントは削除済みです</p><button className="mt-3 w-full rounded-2xl border border-zinc-500 py-3 text-zinc-200" onClick={() => void goTop()}>TOPへ戻る</button></Card></main>;


  const renderPlayerSelect = (value: string, onChange: (value: string) => void, usedIds: string[]) => (
    <select className="w-full rounded-xl bg-zinc-700 p-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)} disabled={eventStatus === "closed"}>
      <option value="">選手を選択</option>
      {candidateParticipants.map((p) => {
        const disabled = usedIds.includes(p.id) && p.id !== value;
        return <option key={p.id} value={p.id} disabled={disabled}>{participantLabel(p)}{p.participant_type === "guest" ? "（ゲスト）" : ""}{disabled ? "（選択済み）" : ""}</option>;
      })}
    </select>
  );

  const manualRoundSection = eventMode === "manual" && eventStatus !== "closed" ? (
    <Card title="手動で試合を作成">
      <div className="space-y-3">
        <div className="rounded-xl bg-zinc-800 p-3 text-sm">
          <p className="font-semibold">Roundを作成：Round {latestRoundNumber + 1}</p>
          <p className="text-xs text-zinc-400">コート数分の試合作成枠を初期表示しています</p>
        </div>
        {manualDrafts.map((d) => {
          const draftUsed = [d.teamA1, d.teamA2, d.teamB1, d.teamB2].filter(Boolean);
          const allUsed = selectedManualPlayerIds;
          const usedForSelect = (current: string) => allUsed.filter((id) => id !== current).concat(draftUsed.filter((id) => id !== current));
          return (
            <div key={d.id} className="rounded-xl bg-zinc-800 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Court{d.court_number}</p>
                <button type="button" className="rounded border border-zinc-600 px-3 py-1 text-xs" onClick={() => removeManualDraft(d.id)} disabled={manualDrafts.length <= 1}>削除</button>
              </div>
              <div className="space-y-2">
                <div>
                  <p className="mb-1 text-xs text-zinc-300">チームA: 選手1 / 選手2</p>
                  <div className="grid grid-cols-2 gap-2">
                    {renderPlayerSelect(d.teamA1, (v) => updateManualDraft(d.id, "teamA1", v), usedForSelect(d.teamA1))}
                    {renderPlayerSelect(d.teamA2, (v) => updateManualDraft(d.id, "teamA2", v), usedForSelect(d.teamA2))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs text-zinc-300">チームB: 選手1 / 選手2</p>
                  <div className="grid grid-cols-2 gap-2">
                    {renderPlayerSelect(d.teamB1, (v) => updateManualDraft(d.id, "teamB1", v), usedForSelect(d.teamB1))}
                    {renderPlayerSelect(d.teamB2, (v) => updateManualDraft(d.id, "teamB2", v), usedForSelect(d.teamB2))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div className="rounded-xl bg-zinc-800 p-3 text-sm">
          <p className="mb-1 font-semibold">このRoundの休み</p>
          <p className="text-zinc-300">{manualRestingParticipants.length ? manualRestingParticipants.map(participantLabel).join(" / ") : "なし"}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="rounded-xl border border-zinc-600 py-3 text-sm" onClick={addManualDraft}>試合を追加</button>
          <button type="button" className="rounded-xl bg-accent py-3 font-semibold text-black" disabled={busyParticipants.size > 0 || isClosingEvent || unsavedScoreCount > 0} onClick={() => { if (!scoreQueue.hasUnsaved(scoreScope) && !closingEvent.current) void createManualRound(); }}>Roundを作成</button>
        </div>
      </div>
    </Card>
  ) : null;

  const renderMatchCard = (m: MatchView) => {
            const db = !guestMode && eventMode === "auto" ? getSupabaseClient() : null;
            const send = db ? createFriendlyScoreCommit(db,eventId,m) : null;
            return (
              <div key={m.id} className="relative overflow-hidden rounded-xl bg-red-950/70">
                <div className="absolute inset-y-0 left-0 flex w-28 items-center justify-center bg-red-600 text-sm font-bold text-white">削除</div>
                <div
                  className="relative rounded-xl bg-zinc-800 p-2 transition-transform"
                  style={{ transform: `translateX(${eventMode === "auto" && eventStatus !== "closed" ? (swipeOffsets[m.id] ?? 0) : 0}px)` }}
                  onTouchStart={(e) => { if (eventMode === "auto" && eventStatus !== "closed") setSwipeStartX((prev) => ({ ...prev, [m.id]: e.touches[0]?.clientX ?? 0 })); }}
                  onTouchMove={(e) => {
                    if (eventMode !== "auto" || eventStatus === "closed") return;
                    const start = swipeStartX[m.id] ?? e.touches[0]?.clientX ?? 0;
                    const delta = Math.max(0, Math.min((e.touches[0]?.clientX ?? start) - start, 128));
                    setSwipeOffsets((prev) => ({ ...prev, [m.id]: delta }));
                  }}
                  onTouchEnd={() => {
                    if (eventMode !== "auto" || eventStatus === "closed") return;
                    const offset = swipeOffsets[m.id] ?? 0;
                    if (offset >= 88) requestMatchDelete(m);
                    else setSwipeOffsets((prev) => ({ ...prev, [m.id]: 0 }));
                  }}
                >
                <div className="mb-1 flex flex-wrap items-center gap-1"><p className="mr-auto text-[11px] font-bold">{m.round_number === latestRoundNumber && !allHistoryOpen ? "" : `R${m.round_number} · `}コート{m.court_number}</p>
                  <YoutubeDisclosure compact registered={!!m.youtube_url}>
                  {m.youtube_url && <a href={m.youtube_url} target="_blank" rel="noreferrer" className="inline-block rounded border border-zinc-500 px-3 py-2 text-sm">動画を見る</a>}
                  <input className="w-full rounded bg-zinc-700 p-2 text-sm" placeholder="https://www.youtube.com/watch?v=..." value={youtubeInputs[m.id] ?? ""} onChange={e => setYoutubeInputs(previous => ({ ...previous, [m.id]: e.target.value }))} />
                  <div className="flex gap-2"><button className="flex-1 rounded border border-zinc-500 py-2 text-xs" onClick={() => void saveYoutubeUrl(m.id)}>URLを保存</button>{m.youtube_url && <button className="flex-1 rounded border border-red-500 py-2 text-xs text-red-300" onClick={() => void deleteYoutubeUrl(m.id)}>URLを削除</button>}</div>
                  {canViewVideoClickCounts && m.youtube_url && <p className="text-xs text-zinc-400">動画クリック数: {videoClickCounts[m.id] ?? 0}回</p>}
                </YoutubeDisclosure>
                {eventMode === "auto" && eventStatus === "active" && !m.completed && !m.result && (guestMode || (canManageEventName && lineupVersions?.eventId===eventId && lineupVersions.userId===roundUserId && lineupVersions.data.editing_enabled)) && <button type="button" className="min-h-11 shrink-0 rounded-xl border border-zinc-600 px-2 text-[11px]" disabled={lineupLoading||!!lineupEditor||isGeneratingRound||isClosingEvent||unsavedScoreCount>0||busyParticipants.size>0} onClick={()=>void openLineupEditor(m)}>メンバー変更</button>}
                  {eventMode === "auto" && eventStatus !== "closed" && <button type="button" className="min-h-11 min-w-11 rounded-xl border border-zinc-600 px-2 text-[11px] text-zinc-400" disabled={scoreQueue.has(`${scoreScope}${m.id}`)||isClosingEvent} onClick={() => requestMatchDelete(m)}>削除</button>}
                </div>
                {eventMode === "manual" && (lineupDrafts[m.id] ? (
                  <div className="mb-3 space-y-2 rounded-lg border border-zinc-700 p-2">
                    <p className="text-xs text-zinc-300">組み合わせ編集</p>
                    <div className="grid grid-cols-2 gap-2">
                      {renderPlayerSelect(lineupDrafts[m.id].teamA1, (v) => setLineupDrafts((prev) => ({ ...prev, [m.id]: { ...prev[m.id], teamA1: v } })), [lineupDrafts[m.id].teamA2, lineupDrafts[m.id].teamB1, lineupDrafts[m.id].teamB2].filter(Boolean))}
                      {renderPlayerSelect(lineupDrafts[m.id].teamA2, (v) => setLineupDrafts((prev) => ({ ...prev, [m.id]: { ...prev[m.id], teamA2: v } })), [lineupDrafts[m.id].teamA1, lineupDrafts[m.id].teamB1, lineupDrafts[m.id].teamB2].filter(Boolean))}
                      {renderPlayerSelect(lineupDrafts[m.id].teamB1, (v) => setLineupDrafts((prev) => ({ ...prev, [m.id]: { ...prev[m.id], teamB1: v } })), [lineupDrafts[m.id].teamA1, lineupDrafts[m.id].teamA2, lineupDrafts[m.id].teamB2].filter(Boolean))}
                      {renderPlayerSelect(lineupDrafts[m.id].teamB2, (v) => setLineupDrafts((prev) => ({ ...prev, [m.id]: { ...prev[m.id], teamB2: v } })), [lineupDrafts[m.id].teamA1, lineupDrafts[m.id].teamA2, lineupDrafts[m.id].teamB1].filter(Boolean))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button className="rounded border border-zinc-500 py-2 text-sm" onClick={() => setLineupDrafts((prev) => { const next = { ...prev }; delete next[m.id]; return next; })}>キャンセル</button>
                      <button className="rounded bg-accent py-2 text-sm text-black" onClick={() => void saveLineupEdit(m.id)}>保存</button>
                    </div>
                  </div>
                ) : m.completed ? (
                  <p className="mb-2 text-xs text-zinc-400">スコア入力済みのため組み合わせは編集できません</p>
                ) : eventStatus !== "closed" ? (
                  <button className="mb-2 rounded border border-zinc-500 px-3 py-2 text-xs" disabled={scoreQueue.has(`${scoreScope}${m.id}`)||isClosingEvent} onClick={() => startLineupEdit(m)}>組み合わせ編集</button>
                ) : null)}
                <div className="flex items-center gap-2">
                  <ScoreInput compact captureCommit={eventMode === "auto"} saveKey={`${scoreScope}${m.id}`} names={(["A", "B"] as const).map(team => m.players.filter(player => player.team === team).map(player => ({ name: nameMap[player.participant_id] || "選手名未設定", guest: participants.find(p => p.id === player.participant_id)?.participant_type === "guest" }))) as [{ name: string; guest: boolean }[], { name: string; guest: boolean }[]]} value={{ a: m.result ? String(m.result.score_a) : "", b: m.result ? String(m.result.score_b) : "" }} kind="number"
                    saved={hasEnteredFriendlyMatchScore(m)} result={hasEnteredFriendlyMatchScore(m) ? m.result!.winner_team : null}
                    title={`Round ${m.round_number} / Court${m.court_number} のスコア`} disabled={eventStatus === "closed" || isClosingEvent || isGeneratingRound || lineupLoading || !!lineupEditor || !!lineupDrafts[m.id]}
                    onCommit={async scores => { if (!await saveScore(m.id, scores, send)) throw new Error(scoreSaveState.current.error || "スコアを保存できませんでした。再試行してください"); }} />
                </div>
                </div>
              </div>
            );
          };

  const resultSummarySection = (
    <Card title={eventStatus === "closed" ? "結果サマリー" : "暫定結果サマリー"}>
      <div className="space-y-3 text-sm">
        <div className="rounded-xl bg-zinc-800 p-3">
          <p>イベント名：{eventName}</p>
          <p>総試合数：{totalMatches}</p>
          <p>参加者数：{participants.length}</p>
        </div>
        <SummaryRankingSection title="勝利数ランキング" isOpen={openSummaryRankingSections.wins} onToggle={() => toggleSummaryRankingSection("wins")}>
          {hasSummaryResults ? <ol className="space-y-1 rounded-xl bg-zinc-800 p-3">{winRanking.map((r, i) => <li key={`w-${r.name}-${i}`}>{i + 1}位 {r.name} {formatRecord(r.wins, r.losses, r.draws)}</li>)}</ol> : <div className="rounded-xl bg-zinc-800 p-3"><p>試合結果がありません</p></div>}
        </SummaryRankingSection>
        <SummaryRankingSection title="勝率ランキング" isOpen={openSummaryRankingSections.winRate} onToggle={() => toggleSummaryRankingSection("winRate")}>
          {hasSummaryResults ? <ol className="space-y-1 rounded-xl bg-zinc-800 p-3">{winRateRanking.map((r, i) => <li key={`wr-${r.name}-${i}`}>{i + 1}位 {r.name} {formatRecord(r.wins, r.losses, r.draws)} / 勝率{r.winRate}%</li>)}</ol> : <div className="rounded-xl bg-zinc-800 p-3"><p>試合結果がありません</p></div>}
        </SummaryRankingSection>
        <SummaryRankingSection title="得失点差ランキング" isOpen={openSummaryRankingSections.diff} onToggle={() => toggleSummaryRankingSection("diff")}>
          {hasSummaryResults ? <ol className="space-y-1 rounded-xl bg-zinc-800 p-3">{diffRanking.map((r, i) => <li key={`df-${r.name}-${i}`}>{i + 1}位 {r.name} {formatRecord(r.wins, r.losses, r.draws)} / 得失点差{r.diff}</li>)}</ol> : <div className="rounded-xl bg-zinc-800 p-3"><p>試合結果がありません</p></div>}
        </SummaryRankingSection>
        <SummaryRankingSection title="MVP" isOpen={openSummaryRankingSections.mvp} onToggle={() => toggleSummaryRankingSection("mvp")}>
          <div className="rounded-xl bg-zinc-800 p-3"><p>{hasSummaryResults && mvp ? `${mvp.name}（${formatRecord(mvp.wins, mvp.losses, mvp.draws)} / 勝点${mvp.matchPoints} / 勝率${mvp.winRate}% / 得失点差${mvp.diff}）` : "該当なし"}</p></div>
        </SummaryRankingSection>
      </div>
    </Card>
  );

  return (
    <main data-friendly-scoreboard className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-1.5 p-3 pb-20">
      <EditableEventTitle statusLabel={tabReady ? `${eventStatus === "closed" ? "終了済み" : "開催中"} · ${eventMode === "manual" ? "手動" : "乱数"}${guestMode ? " · ゲストの一時保存" : ""}` : ""} label="イベント詳細" name={eventName} canEdit={guestMode || canManageEventName} isEditing={isEditingEventName} draft={eventNameDraft} onDraftChange={setEventNameDraft} onStartEdit={startEventNameEdit} onSave={() => void saveEventName()} onCancel={cancelEventNameEdit} />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-400">{message}</p>}
      <div id="event-tabs" role="tablist" aria-label="開催詳細" className="grid grid-cols-3 border-b border-zinc-700">
        {eventTabs.map((tab, index) => <button key={tab.value} id={`event-tab-${tab.value}`} type="button" role="tab" aria-label={tab.label} aria-describedby={tab.value === "matches" && unsavedScoreCount > 0 ? "event-score-status" : undefined} aria-controls={`event-panel-${tab.value}`} aria-selected={tabReady && activeTab === tab.value} tabIndex={activeTab === tab.value ? 0 : -1} disabled={!tabReady} className={`flex min-h-11 items-center justify-center gap-1 border-b-2 px-1 text-sm font-bold disabled:opacity-40 ${activeTab === tab.value ? "border-accent text-accent" : "border-transparent text-zinc-400"}`} onClick={() => selectEventTab(tab.value)} onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
          if (next === null) return;
          event.preventDefault(); selectEventTab(eventTabs[next].value); document.getElementById(`event-tab-${eventTabs[next].value}`)?.focus();
        }}><span>{tab.label}</span>{tab.value === "matches" && unsavedScoreCount > 0 && <span id="event-score-status" data-score-status aria-live="polite" className={`rounded-full px-1 text-[10px] ${failedScoreCount ? "text-red-400" : "text-zinc-400"}`}>{failedScoreCount ? `保存エラー${failedScoreCount}` : `保存中${unsavedScoreCount}`}</span>}</button>)}
      </div>
      {!tabReady && <p role="status" className="text-sm text-zinc-400">開催情報を読み込み中…</p>}
      {tabNotice && <p role="status" className="text-sm text-amber-300">{tabNotice}</p>}
      {failedScoreCount>0 && eventMode==="auto" && !guestMode && <button type="button" className="min-h-11 rounded-xl border border-zinc-600 px-3 text-xs" onClick={()=>void loadAll(true).then(()=>setMessage("入力した得点は保持しています。最新の選手を確認し、対戦タブの得点をタップして再入力してください。")).catch(()=>setError("最新データを確認できませんでした。"))}>最新データを確認</button>}
      {busyParticipants.size > 0 && <p role="status" className="text-sm text-zinc-300">参加状態を保存・確認中…</p>}
      {Object.entries(participantErrors).map(([id, detail]) => <div key={id} role="alert" className="space-y-2 rounded-xl border border-red-500 p-3 text-sm text-red-300">
        <p>{participants.find(p => p.id === id) ? participantLabel(participants.find(p => p.id === id)!) : "参加者"}：{detail}</p>
        <button type="button" disabled={busyParticipants.has(id)} className="min-h-11 rounded-xl border border-zinc-500 px-3 disabled:opacity-40" onClick={() => void updateStatus(id)}>参加状態を再読み込み</button>
      </div>)}
      {/* 非表示パネルもマウントを維持し、スコア・動画・手動編成の入力と保存キューを保持する。 */}
      <section id="event-panel-matches" role="tabpanel" aria-labelledby="event-tab-matches" hidden={!tabReady || activeTab !== "matches"} className="space-y-4">
      <section aria-label="マッチボード" className="space-y-1.5" data-event-operations>
        <div className="flex items-center justify-between"><h2 className="text-sm font-bold">{latestRoundNumber ? `Round ${latestRoundNumber}` : "試合はまだありません"}</h2><span className="text-xs text-zinc-400">{matches.filter(m => m.round_number === latestRoundNumber).length}コート</span></div>
        <div ref={latestCardsHost} data-scoreboard-latest className="space-y-1.5" />
        {matches.filter(m => m.round_number === latestRoundNumber).length > 2 && <button type="button" aria-expanded={moreCourts} className="min-h-11 w-full rounded-xl border border-zinc-600 px-3 text-sm" onClick={() => setMoreCourts(value => !value)}>{moreCourts ? "コートを2面にまとめる" : `残り${matches.filter(m => m.round_number === latestRoundNumber).length - 2}コートを表示`}{unsavedScoreCount > 0 && " · 未保存あり"}</button>}
      {eventMode === "manual" ? manualRoundSection : (
        <div className="space-y-2" data-court-generation>

          <div className="min-w-0 flex-1">{eventStatus === "closed" ? <button className="min-h-12 w-full rounded-xl bg-zinc-700 px-2 py-3 text-sm font-semibold text-zinc-300" disabled>次のRoundを生成（終了済み）</button> : <ActionButton aria-label="次Round生成" onClick={() => { if (!scoreQueue.hasUnsaved(scoreScope) && !closingEvent.current) void generateRound(); }} disabled={busyParticipants.size > 0 || isGeneratingRound || courtSaving || courtLoading || isDeletingMatch || isClosingEvent || unsavedScoreCount > 0}>{isGeneratingRound ? "生成中..." : "次のRoundを生成"}</ActionButton>}</div>
        </div>
      )}
          {showCourtWarning && <p className="text-xs text-amber-300">※ {courtCount}面設定ですが、現在の参加人数では{maxPlayableCourts}面まで生成可能です（1試合につき4人必要です）</p>}
        <div className="friendly-scoreboard-settings">
      {!guestMode && !eventId.startsWith("guest_") && !!roundUserId && eventMode === "auto" && eventStatus !== "closed" && (
        <details className="rounded-xl border border-zinc-700" data-round-mode>
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-bold">組み合わせ：{friendlyRoundModes.find(mode => mode.value === selectedRoundMode)!.label}{specialModesUnlocked && <span className="ml-2 text-xs text-accent">解放済み</span>}</summary>
        <fieldset className="space-y-2 p-3 pt-0" disabled={isGeneratingRound || isClosingEvent}>
          <legend className="sr-only">組み合わせモード</legend>
          <div className="grid grid-cols-2 gap-2">
            {friendlyRoundModes.map(mode => {
              const locked = mode.value !== "normal" && !specialModesUnlocked;
              return <label key={mode.value} className={`flex min-h-11 items-center gap-3 rounded-xl border border-zinc-700 px-3 py-2 text-sm ${locked ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}>
                <input type="radio" name="friendly-round-mode" value={mode.value} checked={selectedRoundMode === mode.value} disabled={locked} onChange={() => selectRoundMode(mode.value)} />
                <span>{locked && <span aria-hidden="true">🔒 </span>}{mode.label}</span>
              </label>;
            })}
          </div>
          <p className="text-xs text-zinc-300">{friendlyRoundModes.find(mode => mode.value === selectedRoundMode)!.description}</p>
          {!specialModesUnlocked && <div className="space-y-1 text-xs text-zinc-400">
            <p>特別モード解放まで：{scoredMatchCount} / {FRIENDLY_MODE_UNLOCK_MATCHES}試合</p>
            <progress className="h-2 w-full" style={{ accentColor: "var(--app-accent)" }} max={FRIENDLY_MODE_UNLOCK_MATCHES} value={scoredMatchCount} aria-label="特別モード解放まで" />
            <p>あと{FRIENDLY_MODE_UNLOCK_MATCHES - scoredMatchCount}試合で解放！</p>
          </div>}
        </fieldset>
        </details>
      )}
          {eventMode === "auto" && ((guestMode || canManageEventName) && eventStatus === "active" ? <button type="button" aria-label="利用コート数を変更" className="min-h-12 min-w-24 shrink-0 rounded-xl border border-zinc-500 px-2 py-1 disabled:opacity-40" onClick={() => void openCourtDialog()} disabled={busyParticipants.size > 0 || isGeneratingRound || courtSaving || isDeletingMatch || courtLoading || isClosingEvent}>
            <span className="block text-xs text-zinc-300">利用コート数</span><span className="text-sm font-bold">{courtCount}面</span>
          </button> : <p className="flex min-h-12 shrink-0 flex-col justify-center rounded-xl border border-zinc-700 px-2 text-center"><span className="text-xs text-zinc-400">利用コート数</span><span className="text-sm font-bold">{courtCount}面</span></p>)}
        </div>
        {fixedFeature && <details data-fixed-settings className="group/fixed rounded-xl border border-zinc-700"><summary className="flex min-h-11 list-none cursor-pointer items-center gap-2 px-3 text-sm font-bold [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="shrink-0"><span className="group-open/fixed:hidden">▶</span><span className="hidden group-open/fixed:inline">▼</span></span>固定ペア{scopedFixedState ? ` · ${scopedFixedState.pairs.length}組` : ""}</summary>
        {fixedFeature && <EventFixedPairs key={`${roundUserId}:${eventId}`} people={participants.map(p => ({ id: p.id, name: participantLabel(p), guest: p.participant_type === "guest", status: p.status }))} activeIds={candidateParticipants.map(p => p.id)} snapshot={scopedFixedState} error={fixedError} busy={busyParticipants.size > 0 || fixedSaving || isGeneratingRound || isClosingEvent || courtSaving || isDeletingMatch} closed={eventStatus === "closed"} onSave={saveFixedPairs} onReload={reloadFixedPairs} />}
        </details>}
        <details data-round-history className="group/history rounded-xl border border-zinc-700"><summary className="flex min-h-11 list-none cursor-pointer items-center gap-2 px-3 text-sm font-bold [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="shrink-0"><span className="group-open/history:hidden">▶</span><span className="hidden group-open/history:inline">▼</span></span>過去Round · {matches.filter(m => m.round_number !== latestRoundNumber).length}試合{unsavedScoreCount > 0 && " · 未保存あり"}</summary><div className="space-y-2 p-2">
          <div className="flex justify-end"><button type="button" aria-label="全試合履歴を拡大" title="全試合履歴を拡大" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-600" onClick={() => { if (!document.querySelector('dialog[open]')) setAllHistoryOpen(true); }}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" /></svg></button></div>
          {!matches.some(m => m.round_number !== latestRoundNumber) && <p className="text-xs text-zinc-400">過去Roundはまだありません。拡大すると最新Roundを含む全試合を確認できます。</p>}
          <div ref={pastCardsHost} data-match-list="normal" className="max-h-[min(25rem,50dvh)] space-y-3 overflow-y-auto overscroll-contain pr-1" />
        </div></details>
      </section>

      <details data-event-videos className="rounded-xl border border-zinc-700"><summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-bold">YouTube動画一覧・管理</summary>
      <Card title="動画視聴">
        <div className="space-y-3 text-sm">
          {eventVideoLinks.map((video) => (
            <div key={video.id} className="rounded-xl bg-zinc-800 p-3">
              <p className="font-semibold">{video.title || "全試合動画"}</p>
              {video.video_url ? <a href={video.video_url} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded border border-zinc-500 px-3 py-2 text-sm">YouTubeで見る</a> : <p className="mt-2 text-xs text-zinc-400">YouTube URL未設定</p>}
              {video.memo && <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">メモ: {video.memo}</p>}
              {canViewVideoClickCounts && <p className="mt-2 text-xs text-zinc-400">動画クリック数: {eventVideoClickCounts[video.id] ?? 0}回</p>}
              {canManageEventVideos && <div className="mt-3 flex gap-2"><button className="rounded border border-zinc-500 px-3 py-2 text-sm" onClick={() => startEventVideoEdit(video)}>動画を編集</button><button className="rounded border border-red-500 px-3 py-2 text-sm text-red-300" onClick={() => setDeleteEventVideoId(video.id)}>動画を削除</button></div>}
            </div>
          ))}
          {canManageEventVideos && (
            <div className="space-y-2 rounded-xl border border-zinc-700 p-3">
              <p className="font-semibold">{editingEventVideoId ? "動画を編集" : "動画を追加"}</p>
              <input className="w-full rounded bg-zinc-700 p-2 text-sm" placeholder="全試合動画" value={eventVideoForm.title} onChange={(e) => setEventVideoForm((prev) => ({ ...prev, title: e.target.value }))} />
              <input className="w-full rounded bg-zinc-700 p-2 text-sm" placeholder="https://www.youtube.com/watch?v=..." value={eventVideoForm.video_url} onChange={(e) => setEventVideoForm((prev) => ({ ...prev, video_url: e.target.value }))} />
              <textarea className="w-full rounded bg-zinc-700 p-2 text-sm" placeholder="メモ" value={eventVideoForm.memo} onChange={(e) => setEventVideoForm((prev) => ({ ...prev, memo: e.target.value }))} />
              <input type="number" className="w-full rounded bg-zinc-700 p-2 text-sm" placeholder="表示順" value={eventVideoForm.display_order} onChange={(e) => setEventVideoForm((prev) => ({ ...prev, display_order: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2"><button className="rounded border border-zinc-500 py-2" onClick={resetEventVideoForm}>キャンセル</button><button className="rounded bg-accent py-2 text-black" onClick={() => void saveEventVideoLink()}>保存</button></div>
            </div>
          )}
        </div>
      </Card>

      </details>

      {eventStatus !== "closed" && <Card title="開催操作">
          <div className="space-y-2">
            <button className="min-h-11 w-full rounded-xl border border-zinc-500 px-3 py-2 text-sm font-semibold disabled:opacity-50" onClick={() => void openCloseEvent()} disabled={busyParticipants.size > 0 || isClosingEvent || fixedSaving || isGeneratingRound || courtSaving || isDeletingMatch}>イベント終了</button>
            <p className="text-xs text-zinc-400">終了後、ランキング・MVP・結果共有を確認できます</p>
          </div>
      </Card>}
      </section>

      <section id="event-panel-participants" role="tabpanel" aria-labelledby="event-tab-participants" hidden={!tabReady || activeTab !== "participants"} className="space-y-4">
      <Card title="参加者">
        {eventStatus === "closed" && <p className="mb-2 text-sm text-zinc-300">この開催は終了済みです</p>}
        <ul className="space-y-2">
          {participants.map((p) => (
            <li key={p.id} data-participant-id={p.id} aria-busy={busyParticipants.has(p.id)} className="rounded-xl bg-zinc-800 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1"><GuestName name={participantLabel(p)} guest={p.participant_type === "guest"} /><p data-participant-status={p.status} className={`mt-1 text-xs font-semibold ${p.status === "active" ? "text-accent" : p.status === "resting" ? "text-amber-300" : "text-zinc-400"}`}>{{ active: "参加中", resting: "休憩中（手動）", absent: "欠席" }[p.status]}</p></div>
                {p.status !== "absent" && <button
                  type="button"
                  aria-label={`${participantLabel(p)}を${p.status === "active" ? "休憩にする" : "参加に戻す"}`}
                  aria-pressed={p.status === "resting"}
                  onClick={() => void updateStatus(p.id, p.status === "active" ? "resting" : "active")}
                  disabled={busyParticipants.has(p.id) || eventStatus === "closed" || (!guestMode && !canManageEventName) || fixedSaving || isGeneratingRound || isClosingEvent || courtSaving || isDeletingMatch}
                  className={`min-h-11 min-w-20 shrink-0 rounded-xl border px-3 text-sm font-bold disabled:opacity-40 ${p.status === "resting" ? "border-accent bg-accent text-black" : "border-zinc-500 text-zinc-100"}`}
                >
                  {busyParticipants.has(p.id) ? "確認中…" : p.status === "resting" ? "参加に戻す" : "休憩"}
                </button>}
                {p.status === "absent" && eventStatus === "active" && (guestMode || canManageEventName) && <button type="button" disabled={busyParticipants.has(p.id) || fixedSaving || isGeneratingRound || isClosingEvent || courtSaving || isDeletingMatch} className="min-h-11 rounded-xl border border-zinc-600 px-3 text-sm disabled:opacity-40" onClick={() => void updateStatus(p.id, "active")}>参加に戻す</button>}
              </div>
              {participantRoundLabel(p.id) && <p className="mb-2 text-[10px] text-zinc-400">{participantRoundLabel(p.id)}</p>}
              {p.participant_type === "guest" && eventStatus !== "closed" && (
                <div className="flex items-center gap-2">
                  {editingGuestId === p.id ? (
                    <>
                      <input className="w-full rounded-xl bg-zinc-700 p-2 text-sm" value={editingGuestName} onChange={(e) => setEditingGuestName(e.target.value)} />
                      <button className="rounded bg-accent px-3 py-2 text-sm text-black" onClick={() => void saveGuestName(p.id)}>保存</button>
                      <button className="rounded border border-zinc-500 px-3 py-2 text-sm" onClick={() => { setEditingGuestId(null); setEditingGuestName(""); }}>キャンセル</button>
                    </>
                  ) : (
                    <button className="rounded border border-zinc-500 px-3 py-2 text-sm" onClick={() => { setEditingGuestId(p.id); setEditingGuestName(p.guest_name ?? p.display_name ?? ""); }}>編集</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

      </Card>

      

<Card title="参加者追加">
        <div className="flex gap-2">
          <input className="w-full rounded-xl bg-zinc-800 p-3 disabled:bg-zinc-900 disabled:text-zinc-500" placeholder="ゲスト名" value={guestName} onChange={(e) => setGuestName(e.target.value)} disabled={eventStatus === "closed"} />
          <button className="min-w-16 whitespace-nowrap rounded-xl bg-accent px-4 py-2 text-black disabled:bg-zinc-700 disabled:text-zinc-300" onClick={addGuest} disabled={eventStatus === "closed"}>追加</button>
        </div>
      </Card>
      

      </section>

      <section id="event-panel-results" role="tabpanel" aria-labelledby="event-tab-results" hidden={!tabReady || activeTab !== "results"} className="space-y-4">
      <p className="text-sm text-zinc-300">{eventStatus === "closed" ? "終了後の結果です。" : "開催中の暫定結果です。"} 戦績反映：{guestMode ? "ゲストの一時保存" : statsMode === "record_only" ? "このイベント内だけに保存" : statsMode === "official" ? usedFixedPairs ? "グループ通算戦績に反映" : "通算戦績の対象（既存の集計条件に従います）" : "終了時に選択"}</p>
      <div id="event-results">{resultSummarySection}</div>
{eventStatus !== "closed" && (
      <Card title="勝率ランキング">
        <ol className="space-y-1 text-sm">{ranking.map((r, i) => <li key={r.name + i}>{i + 1}位 {r.name} {r.r}%（{r.m}試合）</li>)}</ol>
      </Card>
      )}

      

      {eventStatus === "closed" && (
        <Card title="結果共有">
          <div className="space-y-2 text-sm">
            {shareEnabled && shareToken ? <div className="space-y-1"><p className="font-bold">共有リンク</p><p className="break-all rounded bg-zinc-800 p-2">{shareUrl}</p></div> : <p className="text-zinc-300">このイベントは共有されていません</p>}
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded border border-zinc-500 py-2" onClick={() => void createShareLink()}>共有リンクを作成</button>
              <button className="rounded border border-zinc-500 py-2" onClick={() => void copyShareLink()}>コピー</button>
              <button className="rounded border border-zinc-500 py-2" onClick={() => void stopShareLink()}>共有を停止</button>
              <button className="rounded border border-zinc-500 py-2" onClick={() => void reissueShareLink()}>共有リンクを再発行</button>
            </div>
            <MatchShareButtons
              event={{ status: eventStatus, is_deleted: isDeletedEvent, share_enabled: shareEnabled, share_token: shareToken }}
              eventName={eventName}
              kind="events"
              canShare={canCopyShare}
              getMatches={() => sortedMatches.map(match => ({
                teamA: match.players.length === 4 ? match.players.filter(player => player.team === "A").map(player => nameMap[player.participant_id]) : [],
                teamB: match.players.length === 4 ? match.players.filter(player => player.team === "B").map(player => nameMap[player.participant_id]) : [],
                score: hasEnteredFriendlyMatchScore(match) ? { a: match.result.score_a, b: match.result.score_b } : null,
                youtubeUrl: match.youtube_url,
              }))}
            />
          </div>
        </Card>
      )}
      {eventStatus === "closed" && <Card title="開催操作">
        <p className="text-sm text-zinc-300">この開催は終了しました</p>
        <button className="mt-2 min-h-11 w-full rounded-xl border border-zinc-500 py-3" disabled={busyParticipants.size > 0 || isClosingEvent || fixedSaving || isGeneratingRound || courtSaving || isDeletingMatch} onClick={reopenEvent}>イベント再開</button>
        {canDeleteEvent && <button className="mt-2 min-h-11 w-full rounded-xl border border-red-500 py-3 text-red-300" onClick={() => setShowDeleteModal(true)}>イベント削除</button>}
      </Card>}

      </section>

      {guestMode && <p className="text-xs text-amber-300">TOPへ戻るとゲストイベントの一時データは削除されます</p>}
      <button className="w-full rounded-2xl border border-zinc-500 py-3 text-zinc-200" onClick={() => void goTop()}>TOPへ戻る</button>

      {lineupEditor && <RoundLineupEditor key={`${eventId}:${lineupEditor.target}`} data={lineupEditor.data} target={lineupEditor.target} busy={lineupSaving} onClose={closeLineupEditor} onSave={commitLineupEditor} />}
      <AppDialog open={allHistoryOpen} title="全試合履歴" wide onClose={() => { if (document.querySelectorAll('dialog[open]').length <= 1) setAllHistoryOpen(false); }}>
        <p className="shrink-0 px-4 pt-3 text-xs text-zinc-400">最新Round {latestRoundNumber}を含む全{matches.length}試合</p>
        <div ref={expandedCardsHost} data-match-list="all" className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4" />
      </AppDialog>
      <FriendlyMatchCards cards={sortedMatches.map(match => ({ id: match.id, round: match.round_number, content: renderMatchCard(match) }))} latestRound={latestRoundNumber} moreCourts={moreCourts} expanded={allHistoryOpen} latestHost={latestCardsHost} pastHost={pastCardsHost} expandedHost={expandedCardsHost} />
      <AppDialog open={!!matchDeleteTarget} title="この試合を削除しますか？" busy={isDeletingMatch} onClose={cancelMatchDelete}>
        <div className="space-y-3 overflow-y-auto p-4">
          {matchDeleteTarget?.hasScore && <div className="space-y-1 text-sm text-red-300"><p>この試合にはスコアが入力されています。</p><p>削除すると戦績からも除外されます。</p><p>本当に削除しますか？</p></div>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2"><button type="button" disabled={isDeletingMatch} className="min-h-11 w-1/2 rounded-xl border border-zinc-600 py-2" onClick={cancelMatchDelete}>キャンセル</button><button type="button" disabled={isDeletingMatch} className="min-h-11 w-1/2 rounded-xl bg-red-500 py-2 font-semibold text-white disabled:opacity-40" onClick={() => void confirmMatchDelete()}>{isDeletingMatch ? "削除中…" : "削除"}</button></div>
        </div>
      </AppDialog>

      <AppDialog open={showCourtDialog} title="利用コート数を変更" busy={courtSaving} onClose={closeCourtDialog}>
        <div className="space-y-4 overflow-y-auto p-4">
          <p className="text-sm text-zinc-300">現在：{courtCount}面。変更は次Roundから適用し、過去の試合は変更しません。</p>
          {courtLoading ? <p role="status" className="text-sm">現在の設定を確認中…</p> : <div className="grid grid-cols-5 gap-2" role="group" aria-label="利用コート数を選択">{[1,2,3,4,5].map(count => <button type="button" key={count} disabled={courtSaving || !courtReady} aria-pressed={courtDraft === count} className={`min-h-12 rounded-xl border px-1 font-bold disabled:opacity-40 ${courtDraft === count ? "border-accent text-accent" : "border-zinc-600"}`} onClick={() => setCourtDraft(count)}>{count}面</button>)}</div>}
          {courtError && <p role="alert" className="text-sm text-red-400">{courtError}</p>}
          {courtSaving && <p role="status" className="text-sm">保存中…</p>}
          <div className="grid grid-cols-2 gap-2"><button type="button" disabled={courtSaving} className="min-h-12 rounded-xl border border-zinc-600" onClick={closeCourtDialog}>キャンセル</button><button type="button" disabled={courtSaving || courtLoading || !courtReady || eventStatus !== "active"} className="min-h-12 rounded-xl bg-accent font-bold text-black disabled:opacity-40" onClick={() => void saveCourtCount()}>保存</button></div>
        </div>
      </AppDialog>

      {deleteEventVideoId && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-sm rounded-2xl bg-card p-4"><p className="font-semibold">動画を削除しますか？</p><div className="mt-4 flex gap-2"><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => setDeleteEventVideoId(null)}>キャンセル</button><button className="w-1/2 rounded-xl bg-red-500 py-2 font-semibold text-white" onClick={() => void deleteEventVideoLink()}>動画を削除</button></div></div></div>}

      {showDeleteModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-sm rounded-2xl bg-card p-4"><p className="font-semibold">本当にこのイベントを削除しますか？</p><p className="mt-2 text-sm text-zinc-300">このイベントの試合結果・戦績はランキングに反映されなくなります。</p><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={deleteChecked} onChange={(e) => setDeleteChecked(e.target.checked)} /><span>この操作を実行して問題ないことを確認しました</span></label><div className="mt-4 flex gap-2"><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => setShowDeleteModal(false)}>キャンセル</button><button disabled={!deleteChecked} className="w-1/2 rounded-xl bg-red-500 py-2 disabled:bg-zinc-600" onClick={deleteEvent}>イベントを削除する</button></div></div></div>}

      <AppDialog open={showCloseModal} title="この開催を終了しますか？" busy={isClosingEvent} onClose={() => setShowCloseModal(false)}>
          <div className="space-y-3 overflow-y-auto p-4">
            <p className="text-sm text-zinc-300">終了するとランキング・MVPを確認し、共有リンクから結果を共有できます。</p>
            <p className="text-sm text-zinc-300">未確定の試合：{matches.filter(match => !hasEnteredFriendlyMatchScore(match)).length}件。未確定試合は正式な結果集計に含まれません。</p>
            {unsavedScoreCount > 0 && <p role="alert" className="text-sm text-amber-300">保存中・保存失敗のスコアがあります。保存完了・再試行後に終了してください。</p>}
            {(isGeneratingRound || courtSaving || isDeletingMatch) && <p role="alert" className="text-sm text-amber-300">Round生成・削除・コート数保存の完了後に終了してください。</p>}
            {usedFixedPairs && <div className="space-y-2 rounded-xl bg-zinc-800 p-3 text-sm">
              <p className="font-semibold">このイベントの戦績をどう扱いますか？</p>
              <label className="flex min-h-12 items-center gap-3"><input type="radio" name="fixed_stats_mode" disabled={isClosingEvent} checked={fixedCloseChoice === "record_only"} onChange={() => setFixedCloseChoice("record_only")} /><span>このイベント内だけに保存<small className="mt-1 block text-zinc-300">当日の結果は残しますが、通算戦績には反映しません。</small></span></label>
              <label className="flex min-h-12 items-center gap-3"><input type="radio" name="fixed_stats_mode" disabled={isClosingEvent} checked={fixedCloseChoice === "official"} onChange={() => setFixedCloseChoice("official")} /><span>グループ通算戦績に反映<small className="mt-1 block text-zinc-300">当日の結果をグループの通算ランキングにも反映します。</small></span></label>
            </div>}
            {eventMode === "manual" && (
              <div className="mb-4 space-y-2 rounded-xl bg-zinc-800 p-3 text-sm">
                <p className="font-semibold">このイベントの結果をグループ戦績に反映しますか？</p>
                <label className="flex items-center gap-2"><input type="radio" disabled={isClosingEvent} name="stats_mode" checked={closeStatsMode === "official"} onChange={() => setCloseStatsMode("official")} /><span>グループ戦績に反映する</span></label>
                <label className="flex items-center gap-2"><input type="radio" disabled={isClosingEvent} name="stats_mode" checked={closeStatsMode === "record_only"} onChange={() => setCloseStatsMode("record_only")} /><span>記録用として保存する</span></label>
              </div>
            )}
            <div className="flex gap-2">
              <button className="w-1/2 rounded-xl border border-zinc-600 py-3" disabled={isClosingEvent} onClick={() => setShowCloseModal(false)}>キャンセル</button>
              <button className="w-1/2 rounded-xl bg-accent py-3 font-semibold text-black disabled:opacity-40" disabled={isClosingEvent || isGeneratingRound || courtSaving || isDeletingMatch || fixedSaving || unsavedScoreCount > 0 || (usedFixedPairs && !fixedCloseChoice)} onClick={() => void closeEvent()}>{isClosingEvent ? "終了中…" : "終了する"}</button>
            </div>
          </div>
      </AppDialog>
    </main>
  );
}


function EditableEventTitle({ statusLabel, label, name, canEdit, isEditing, draft, onDraftChange, onStartEdit, onSave, onCancel }: { statusLabel: string; label: string; name: string; canEdit: boolean; isEditing: boolean; draft: string; onDraftChange: (value: string) => void; onStartEdit: () => void; onSave: () => void; onCancel: () => void }) {
  if (isEditing) {
    return (
      <div className="space-y-2 pr-14 sm:pr-0">
        <label className="text-xs font-semibold text-zinc-400">{label}</label>
        <input className="w-full rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-3 text-lg font-bold text-zinc-100 outline-none focus:border-accent" value={draft} onChange={(e) => onDraftChange(e.target.value)} maxLength={80} autoFocus />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="rounded-xl bg-accent py-2 text-sm font-bold text-black" onClick={onSave}>保存</button>
          <button type="button" className="rounded-xl border border-zinc-500 py-2 text-sm text-zinc-100" onClick={onCancel}>キャンセル</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 pr-14 sm:pr-0">
      <div className="min-w-0 flex-1"><h1 aria-label={`${label}：${name}`} title={name} className="line-clamp-2 break-words text-lg font-bold leading-6">{name}</h1>{statusLabel && <p className="text-[11px] leading-3 text-zinc-400">{statusLabel}</p>}</div>
      {canEdit && <button type="button" className="min-h-10 min-w-10 rounded-full bg-zinc-800/80 px-3 text-zinc-200 transition hover:bg-zinc-700 active:bg-zinc-600" onClick={onStartEdit} aria-label="イベント名を編集" title="イベント名を編集">✎</button>}
    </div>
  );
}
