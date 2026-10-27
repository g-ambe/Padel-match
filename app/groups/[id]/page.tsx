"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";
import { getHistoricalGroupMatchTeams, hasEnteredFriendlyMatchScore } from "@/lib/friendly-match-results";
import { canDeleteGroup, canEditGroupProfile, canManageMembers, canManageTargetMember, toAppRole } from "@/lib/permissions";
import { fetchLegacyMemberProfiles, profileErrorMessage, PlayerProfileError, saveClubMemberRole, saveUnlinkedClubMemberName, setClubMemberActive, type ClubMemberSnapshot } from "@/lib/player-profiles";
import { effectiveJoinStatus, linkStatusLabel, profileLinkRpc, requestPlayerProfileLink, reviewPlayerProfileLink, type AccountCandidate, type LinkStatus, type ProfileLinkRequest, type ProfileMergePreview } from "@/lib/profile-links";
import { ProfileMergeSummary } from "@/components/profile-merge-summary";

type Role = "main_admin" | "sub_admin" | "member";
type Member = {
  id: string;
  profile_id: string | null;
  player_profile_id: string;
  display_name: string;
  linked_auth_user_id: string | null;
  is_active: boolean;
  player_active: boolean;
  role: Role;
};
type StatTab = "個人ランキング" | "ペアランキング" | "イベント履歴";
type IndividualMode = "総合ランキング" | "勝率ランキング";

type MainTab = "グループ管理" | "メンバー管理" | "グループ戦績";
type JoinRequest = { id: string; club_id: string; target_club_member_id: string | null; requester_auth_user_id: string; requester_player_profile_id: string | null; message: string | null; status: LinkStatus; created_at: string; expires_at: string | null; consent_at: string | null; requester_display_name_snapshot: string | null; requester_display_name: string; target_member_name: string | null; };

type Facility = { id: string; name: string; prefecture: string | null; address: string | null; };

function getProfileRow(playerProfiles: any) {
  return Array.isArray(playerProfiles) ? playerProfiles[0] : playerProfiles;
}
const resolveDisplayName = (playerProfiles: any) => {
  const displayName = getProfileRow(playerProfiles)?.display_name;
  return typeof displayName === "string" && displayName.trim() ? displayName : "名称未設定";
};
const formatRecord = (wins: number, losses: number, draws: number) => `${wins}勝${losses}敗${draws}分`;

const roleLabel: Record<Role, string> = { main_admin: "メイン管理者", sub_admin: "サブ管理者", member: "メンバー" };
const roleRank: Record<Role, number> = { main_admin: 0, sub_admin: 1, member: 2 };

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<MainTab>("グループ管理");
  const [statTab, setStatTab] = useState<StatTab>("個人ランキング");
  const [groupName, setGroupName] = useState("グループ");
  const [groupDescription, setGroupDescription] = useState("");
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [groupDescriptionInput, setGroupDescriptionInput] = useState("");
  const [groupImageUrl, setGroupImageUrl] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [facilityInput, setFacilityInput] = useState("");
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [editingFacility, setEditingFacility] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [editingVisibility, setEditingVisibility] = useState(false);
  const [visibilityInput, setVisibilityInput] = useState<"private" | "public">("private");
  const filteredFacilities = facilities.filter((f) => { const q = facilityInput.trim().toLowerCase(); if (!q) return true; return [f.name, f.prefecture ?? "", f.address ?? ""].some((v) => v.toLowerCase().includes(q)); });

  const [members, setMembers] = useState<Member[]>([]);
  const [inactiveMembers, setInactiveMembers] = useState<Member[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [myAuthUserId, setMyAuthUserId] = useState<string | null>(null);
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [myRole, setMyRole] = useState<Role>("member");

  const [name, setName] = useState("");
  const pendingMemberProfile = useRef<{ id: string; name: string } | null>(null);
  const [linkRequests, setLinkRequests] = useState<ProfileLinkRequest[]>([]);
  const [joinPreview, setJoinPreview] = useState<ProfileMergePreview | null>(null);
  const [joinConsent, setJoinConsent] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState<Member | null>(null);
  const [confirmGroupDelete, setConfirmGroupDelete] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const [individualRows, setIndividualRows] = useState<any[]>([]);
  const [pairRows, setPairRows] = useState<any[]>([]);
  const [eventHistoryRows, setEventHistoryRows] = useState<any[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [individualMode, setIndividualMode] = useState<IndividualMode>("総合ランキング");
  const [targetMemberId, setTargetMemberId] = useState("");
  const [joinMessage, setJoinMessage] = useState("");
  const [isMemberOfGroup, setIsMemberOfGroup] = useState(false);
  const [canViewGroup, setCanViewGroup] = useState(false);
  const [myPendingRequest, setMyPendingRequest] = useState<JoinRequest | null>(null);

  const roleCtx = { isSuperUser, myRole };
  const canManage = canManageMembers(roleCtx);
  const canDeleteGroupAction = canDeleteGroup(roleCtx);
  const appRole = toAppRole(roleCtx);

  const deny = () => setError("この操作を行う権限がありません");

  const sortMembers = (rows: Member[]) => [...rows].sort((a, b) => {
    const d = roleRank[a.role] - roleRank[b.role];
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });

  const loadStats = async () => {
    const s = getSupabaseClient();
    if (!s || !id) return;
    const { data: events, error: eventsError } = await s.from("events").select("id,name,created_at,status").eq("club_id", id).eq("status", "closed").eq("is_deleted", false).eq("stats_mode", "official").order("created_at", { ascending: false });
    if (eventsError) { setError("過去のイベントを取得できませんでした"); return; }
    const closedEventIds = (events ?? []).map((e: any) => e.id);
    if (!closedEventIds.length) {
      setIndividualRows([]); setPairRows([]); setEventHistoryRows([]); return;
    }

    const { data: membersRaw, error: membersError } = await s.from("club_members").select("player_profile_id,profile_id,is_active").eq("club_id", id);
    const { data: participantRows, error: participantsError } = await s.from("event_participants").select("id,event_id,profile_id,player_profile_id,participant_type,guest_name").in("event_id", closedEventIds);
    const legacyAccounts = [...new Set([...(membersRaw ?? []).map((m: any) => m.profile_id), ...(participantRows ?? []).filter((p: any) => !p.player_profile_id).map((p: any) => p.profile_id)].filter(Boolean))];
    let legacyProfiles: Awaited<ReturnType<typeof fetchLegacyMemberProfiles>>;
    try { legacyProfiles = await fetchLegacyMemberProfiles(s, legacyAccounts); }
    catch { setError("旧形式の所属を確認できませんでした"); return; }
    const idsOfMember = (m: any): string[] => m.player_profile_id ? [m.player_profile_id] : [m.profile_id, legacyProfiles.get(m.profile_id)?.id].filter(Boolean);
    const memberProfileSet = new Set((membersRaw ?? []).flatMap(idsOfMember));
    const currentProfileSet = new Set((membersRaw ?? []).filter((m: any) => m.is_active).flatMap(idsOfMember));
    const participants = (participantRows ?? []).map((p: any) => ({ ...p, player_profile_id: p.player_profile_id ?? legacyProfiles.get(p.profile_id)?.id ?? p.profile_id }));
    if (membersError || participantsError) { setError("戦績の所属・参加履歴を取得できませんでした"); return; }
    const memberParticipantIds = new Set((participants ?? []).filter((p: any) => p.participant_type !== "guest" && p.player_profile_id && memberProfileSet.has(p.player_profile_id)).map((p: any) => p.id));
    const participantMap = new Map((participants ?? []).map((p: any) => [p.id, p]));
    const profileIds = [...new Set((participants ?? []).map((p: any) => p.player_profile_id).filter(Boolean))];
    const { data: pps, error: namesError } = profileIds.length ? await s.from("player_profiles").select("id,display_name").in("id", profileIds) : { data: [] as any[], error: null };
    if (namesError) { setError("戦績の選手名を取得できませんでした"); return; }
    const profileName = new Map<string, string>((pps ?? []).map((p: any) => [p.id, p.display_name]));
    for (const participant of participants) if (participant.player_profile_id && participant.guest_name && !profileName.has(participant.player_profile_id)) profileName.set(participant.player_profile_id, participant.guest_name);

    const { data: matches, error: matchesError } = await s.from("matches").select("id,event_id,completed,match_players(participant_id,team),match_results(score_a,score_b,winner_team)").in("event_id", closedEventIds);

    if (matchesError) { setError("過去の試合結果を取得できませんでした"); return; }
    const pStats: Record<string, any> = {};
    const pairStats: Record<string, any> = {};

    for (const m of matches ?? []) {
      const res = m.match_results?.[0];
      if (!hasEnteredFriendlyMatchScore({ completed: m.completed, result: res })) continue;
      const historicalTeams = getHistoricalGroupMatchTeams(m.match_players ?? [], memberParticipantIds);
      if (!historicalTeams) continue;
      const { teamA, teamB } = historicalTeams;

      const updPlayer = (pid: string, sA: number, sB: number) => {
        const prof = participantMap.get(pid)?.player_profile_id;
        if (!prof) return;
        if (!pStats[prof]) pStats[prof] = { playerId: prof, name: profileName.get(prof) ?? "名称未設定", matches: 0, wins: 0, losses: 0, draws: 0, scored: 0, conceded: 0 };
        pStats[prof].matches += 1;
        if (sA > sB) pStats[prof].wins += 1;
        else if (sA < sB) pStats[prof].losses += 1;
        else pStats[prof].draws += 1;
        pStats[prof].scored += sA;
        pStats[prof].conceded += sB;
      };

      for (const pid of teamA) updPlayer(pid, res.score_a, res.score_b);
      for (const pid of teamB) updPlayer(pid, res.score_b, res.score_a);

      const updPair = (team: string[], sA: number, sB: number) => {
        if (team.length !== 2) return;
        const p1 = participantMap.get(team[0])?.player_profile_id;
        const p2 = participantMap.get(team[1])?.player_profile_id;
        if (!p1 || !p2) return;
        const [a, b] = [p1, p2].sort();
        const key = `${a}|${b}`;
        if (!pairStats[key]) pairStats[key] = { playerIds: [a, b], pairName: `${profileName.get(a) ?? "名称未設定"} / ${profileName.get(b) ?? "名称未設定"}`, matches: 0, wins: 0, losses: 0, draws: 0, scored: 0, conceded: 0 };
        pairStats[key].matches += 1;
        if (sA > sB) pairStats[key].wins += 1;
        else if (sA < sB) pairStats[key].losses += 1;
        else pairStats[key].draws += 1;
        pairStats[key].scored += sA;
        pairStats[key].conceded += sB;
      };

      updPair(teamA, res.score_a, res.score_b);
      updPair(teamB, res.score_b, res.score_a);
    }

    const indivBase = Object.values(pStats).map((x: any) => ({ ...x, rate: x.matches ? (x.wins / x.matches) * 100 : 0, diff: x.scored - x.conceded, matchPoints: x.wins * 3 + x.draws, avgScored: x.matches ? x.scored / x.matches : 0, avgConceded: x.matches ? x.conceded / x.matches : 0 }));
    const maxMatches = Math.max(1, ...indivBase.map((x: any) => x.matches));
    const maxDiff = Math.max(1, ...indivBase.map((x: any) => Math.max(0, x.diff)));
    const indiv = indivBase.map((x: any) => {
      const matchScore = (x.matches / maxMatches) * 100;
      const diffScore = (Math.max(0, x.diff) / maxDiff) * 100;
      const totalPoint = x.rate * 0.7 + matchScore * 0.2 + diffScore * 0.1;
      return { ...x, totalPoint, isReference: x.matches < 3 };
    });
    setIndividualRows(indiv.filter(row => currentProfileSet.has(row.playerId)));
    setPairRows(
      Object.values(pairStats)
        .filter(row => row.playerIds.every((playerId: string) => currentProfileSet.has(playerId)))
        .map((x: any) => ({ ...x, rate: x.matches ? (x.wins / x.matches) * 100 : 0, diff: x.scored - x.conceded, matchPoints: x.wins * 3 + x.draws, avgDiff: x.matches ? (x.scored - x.conceded) / x.matches : 0 }))
        .sort((a: any, b: any) => b.matchPoints - a.matchPoints || b.wins - a.wins || b.rate - a.rate || b.diff - a.diff || b.scored - a.scored || b.draws - a.draws || a.matches - b.matches || a.pairName.localeCompare(b.pairName, "ja"))
    );
    setEventHistoryRows((events ?? []).map((e: any) => ({ id: e.id, name: e.name, date: e.created_at, matchCount: (matches ?? []).filter((m: any) => m.event_id === e.id).length, participantCount: new Set((participants ?? []).filter((p: any) => p.event_id === e.id).map((p: any) => p.id)).size })));
  };

  const load = async () => {
    const s = getSupabaseClient();
    if (!s || !id) { setError("グループの設定を確認できません"); setLoading(false); return; }
    const { data: userRes, error: authError } = await s.auth.getUser();
    const uid = userRes.user?.id;
    if (authError || !uid) { setCanViewGroup(false); setError("ログイン情報を確認できません"); setLoading(false); return; }

    setLoading(true);
    const { data: adminRow } = await s.from("app_admins").select("id").eq("profile_id", uid).eq("is_active", true).maybeSingle();
    const superUser = !!adminRow || userRes.user?.email?.toLowerCase() === "testuser01@example.com";
    setIsSuperUser(superUser);

    const { data: group } = await s.from("clubs").select("name,description,is_active,image_url,main_facility_id,visibility").eq("id", id).maybeSingle();
    if (!group) { setCanViewGroup(false); setMyRole("member"); setIsMemberOfGroup(false); setError("この操作を行う権限がありません"); setLoading(false); return; }
    setGroupName(group.name ?? "グループ");
    setGroupDescription(group.description ?? "");
    setGroupNameInput(group.name ?? "");
    setGroupDescriptionInput(group.description ?? "");
    setGroupImageUrl((group as any).image_url ?? null);
    setFacilityId((group as any).main_facility_id ?? null);
    setVisibility(((group as any).visibility ?? "private") as "private" | "public");
    setVisibilityInput(((group as any).visibility ?? "private") as "private" | "public");

    const { data, error: memberLoadError } = await s.from("club_members").select("id,profile_id,player_profile_id,is_active,role,player_profiles(id,display_name,linked_auth_user_id,is_active)").eq("club_id", id).order("created_at", { ascending: true });
    if (memberLoadError || !Array.isArray(data)) { setError("メンバーの取得に失敗しました"); setLoading(false); return; }
    let legacyMembers: Awaited<ReturnType<typeof fetchLegacyMemberProfiles>>;
    try { legacyMembers = await fetchLegacyMemberProfiles(s, data.filter(r => !r.player_profile_id).map(r => r.profile_id)); }
    catch { setError("旧形式のメンバー情報を取得できませんでした"); setLoading(false); return; }
    let rows: Member[] = (data ?? []).map((r: any) => {
      const profile = getProfileRow(r.player_profiles) ?? legacyMembers.get(r.profile_id);
      return {
      id: r.id,
      profile_id: r.profile_id,
      player_profile_id: r.player_profile_id,
      display_name: resolveDisplayName(profile),
      linked_auth_user_id: profile?.linked_auth_user_id ?? null,
      is_active: r.is_active !== false,
      player_active: !r.player_profile_id || !!profile?.is_active,
      role: (r.role ?? "member") as Role
    }; });

    const hasMembershipAccess = superUser || rows.some(r => r.is_active && (r.profile_id === uid || r.linked_auth_user_id === uid));
    if (!hasMembershipAccess && group.visibility === "public") {
      const { data: candidates, error: candidateError } = await s.rpc("get_public_join_candidates", { p_club: id });
      if (candidateError) { setError("加入候補の取得に失敗しました"); setLoading(false); return; }
      rows = (candidates ?? []).map((candidate: any) => ({ ...candidate, profile_id: null, linked_auth_user_id: null, role: "member", is_active: true, player_active: true }));
    }
    const sorted = sortMembers(rows);
    setMembers(sorted.filter((m) => m.is_active && m.player_active));
    setInactiveMembers(sorted.filter((m) => !m.is_active && m.player_active));

    const me = rows.find((r) => (r.profile_id === uid || r.linked_auth_user_id === uid) && r.is_active);
    const canView = superUser || (group.is_active && ((group as any).visibility === "public" || !!me));
    setCanViewGroup(!!canView);
    setMyRole(me?.role ?? "member");
    setIsMemberOfGroup(!!me);
    if (!canView) { setError("この操作を行う権限がありません"); setLoading(false); return; }
    setMyProfileId(uid);
    setMyAuthUserId(uid);
    const { data: jrRows, error: requestError } = await s.from("join_requests").select("id,club_id,target_club_member_id,requester_auth_user_id,requester_player_profile_id,message,status,created_at,expires_at,consent_at,requester_display_name_snapshot").eq("club_id", id).order("created_at", { ascending: false });
    const requesterIds = [...new Set((jrRows ?? []).map((r: any) => r.requester_auth_user_id))];
    const { data: reqProfiles } = requesterIds.length ? await s.from("profiles").select("id,display_name").in("id", requesterIds) : { data: [] as any[] };
    const requesterMap = new Map((reqProfiles ?? []).map((r: any) => [r.id, r]));
    const memberNameMap = new Map(rows.map((m) => [m.id, m.display_name]));
    const normalizedReqs: JoinRequest[] = (jrRows ?? []).map((r: any) => ({
      ...r,
      status: effectiveJoinStatus(r),
      requester_display_name: r.requester_display_name_snapshot ?? requesterMap.get(r.requester_auth_user_id)?.display_name ?? "名称未設定",
      target_member_name: r.target_club_member_id ? (memberNameMap.get(r.target_club_member_id) ?? null) : null,
    }));
    if (requestError) setError("加入申請を取得できませんでした。DBの適用状態を確認してください");
    setJoinRequests(normalizedReqs);
    if (superUser || me?.role === "main_admin" || me?.role === "sub_admin") {
      try { setLinkRequests(await profileLinkRpc<ProfileLinkRequest[]>(s, "list_player_profile_link_requests", { p_club_id: id })); }
      catch (cause) { setError(profileErrorMessage(cause)); }
    }
    setMyPendingRequest(normalizedReqs.find((r) => r.requester_auth_user_id === uid && r.status === "pending") ?? null);

    const { data: facilityRows, error: facilityErr } = await s.from("padel_facilities").select("id,name,prefecture,address").order("name", { ascending: true }).limit(500);
    if (facilityErr) setError("施設一覧の取得に失敗しました");
    setFacilities((facilityRows ?? []) as Facility[]);

    await loadStats();
    setLoading(false);
  };

  useEffect(() => { void load(); }, [id]);
  useEffect(() => {
    let active = true;
    setJoinPreview(null); setJoinConsent(false); setPreviewLoading(false);
    const s = getSupabaseClient();
    if (s && targetMemberId) {
      setPreviewLoading(true);
      void profileLinkRpc<ProfileMergePreview>(s, "preview_profile_join", { p_club_id: id, p_member_id: targetMemberId })
        .then(data => { if (active) setJoinPreview(data); })
        .catch(cause => { if (active) setError(profileErrorMessage(cause)); })
        .finally(() => { if (active) setPreviewLoading(false); });
    }
    return () => { active = false; };
  }, [id, targetMemberId]);

  const activeMainAdmins = useMemo(() => members.filter((m) => m.role === "main_admin").length, [members]);
  const rankedIndividuals = useMemo(() => {
    const base = [...individualRows];
    if (individualMode === "総合ランキング") {
      return base.sort((a: any, b: any) => b.totalPoint - a.totalPoint || b.matchPoints - a.matchPoints || b.rate - a.rate || b.wins - a.wins || b.draws - a.draws || b.diff - a.diff || a.matches - b.matches);
    }
    return base.sort((a: any, b: any) => b.rate - a.rate || b.wins - a.wins || b.draws - a.draws || b.diff - a.diff || b.scored - a.scored || b.matches - a.matches);
  }, [individualRows, individualMode]);
  const targetIndividuals = useMemo(() => rankedIndividuals.filter((r: any) => !r.isReference), [rankedIndividuals]);
  const referenceIndividuals = useMemo(() => rankedIndividuals.filter((r: any) => r.isReference), [rankedIndividuals]);

  const addMember = async () => {
    if (!canManage) return deny();
    const s = getSupabaseClient(); if (!s || !id || loading) return;
    const trimmed = name.trim();
    if (!trimmed) return setError("メンバー名を入力してください");
    if (members.some((m) => m.display_name.trim().toLowerCase() === trimmed.toLowerCase())) return setError("同じ名前のメンバーが既にいます");
    setLoading(true); setError(""); setMessage("");
    try {
      if (!pendingMemberProfile.current || pendingMemberProfile.current.name !== trimmed) pendingMemberProfile.current = { id: crypto.randomUUID(), name: trimmed };
      await profileLinkRpc<string>(s, "add_provisional_club_member", { p_club_id: id, p_display_name: trimmed, p_operation_id: pendingMemberProfile.current.id });
      pendingMemberProfile.current = null;
      setMessage("未連携のメンバーを追加しました"); setName("");
      await load();
    } catch (cause) {
      console.error("グループのメンバー追加に失敗しました", cause);
      setError(profileErrorMessage(cause));
    } finally { setLoading(false); }
  };
  const memberSnapshot = (member: Member): ClubMemberSnapshot => ({ id: member.id, club_id: id, player_profile_id: member.player_profile_id, role: member.role, is_active: member.is_active });
  const logMemberError = (label: string, cause: unknown) => {
    const error = cause instanceof Error && cause.cause ? cause.cause : cause;
    const detail = error as { message?: string; code?: string; details?: string; hint?: string };
    console.error(label, { message: detail?.message, code: detail?.code, details: detail?.details, hint: detail?.hint });
  };
  const renameMember = async (member: Member, newName: string) => {
    const s = getSupabaseClient(); if (!s || loading) return false;
    if (!canManageTargetMember(roleCtx, member.role)) { deny(); return false; }
    if (member.linked_auth_user_id !== null) { setError("アカウント連携済みの選手名は、本人のプロフィール画面から変更できます"); return false; }
    const trimmed = newName.trim();
    if (!trimmed) { setError("メンバー名を入力してください"); return false; }
    if (members.some(row => row.id !== member.id && row.display_name.trim().toLowerCase() === trimmed.toLowerCase())) { setError("同じ名前のメンバーが既にいます"); return false; }
    setLoading(true); setError(""); setMessage("");
    try {
      await saveUnlinkedClubMemberName(s, memberSnapshot(member), trimmed);
      setMessage("選手名を更新しました"); await load(); return true;
    } catch (cause) { logMemberError("選手名の更新に失敗しました", cause); setError(profileErrorMessage(cause)); return false; }
    finally { setLoading(false); }
  };
  const changeMemberRole = async (member: Member, role: Role) => {
    const s = getSupabaseClient(); if (!s || loading) return false;
    if (!canManageTargetMember(roleCtx, member.role) || !canManageTargetMember(roleCtx, role)) { deny(); return false; }
    setLoading(true); setError(""); setMessage("");
    try {
      await saveClubMemberRole(s, memberSnapshot(member), role);
      setMessage("役職を更新しました"); await load(); return true;
    } catch (cause) { logMemberError("役職の更新に失敗しました", cause); setError(profileErrorMessage(cause)); return false; }
    finally { setLoading(false); }
  };
  const linkMemberAccount = async (m: Member, account: AccountCandidate) => {
    const s = getSupabaseClient(); if (!s) return; if (!canManage) return deny(); if (!id || loading) return;
    setLoading(true); setError(""); setMessage("");
    try {
      await requestPlayerProfileLink(s, id, m.id, account.auth_user_id);
      setMessage("本人に連携申請を送信しました。承認後に所属・戦績を引き継ぎます");
      await load();
    } catch (cause) {
      console.error("メンバーのアカウント連携に失敗しました", cause);
      setError(profileErrorMessage(cause));
    } finally { setLoading(false); }
  };
  const doDeactivate = async () => {
    if (!confirmLeave || !confirmChecked || loading) return;
    if (!canManageTargetMember(roleCtx, confirmLeave.role)) return deny();
    if (confirmLeave.role === "main_admin" && activeMainAdmins <= 1) return setError("メイン管理者は最低1人必要です");
    const s = getSupabaseClient(); if (!s) return;
    setLoading(true); setError(""); setMessage("");
    try {
      await setClubMemberActive(s, memberSnapshot(confirmLeave), false);
      setConfirmLeave(null); setConfirmChecked(false);
      setMessage("非表示／退会にしました"); await load();
    } catch (cause) { logMemberError("非表示／退会に失敗しました", cause); setError(`非表示／退会に失敗しました。${profileErrorMessage(cause)}`); }
    finally { setLoading(false); }
  };
  const restoreMember = async (member: Member) => {
    const s = getSupabaseClient(); if (!s || loading) return;
    if (!canManageTargetMember(roleCtx, member.role)) return deny();
    setLoading(true); setError(""); setMessage("");
    try {
      await setClubMemberActive(s, memberSnapshot(member), true);
      setMessage("復帰しました"); await load();
    } catch (cause) { logMemberError("復帰に失敗しました", cause); setError(`復帰に失敗しました。${profileErrorMessage(cause)}`); }
    finally { setLoading(false); }
  };
  const doDeleteGroup = async () => { if (!canDeleteGroupAction) return deny(); const s = getSupabaseClient(); if (!s || !id) return; setLoading(true); const { error: deleteError } = await s.from("clubs").update({ is_active: false }).eq("id", id).select("id").single(); if (deleteError) { setLoading(false); return setError("グループの論理削除に失敗しました"); } setConfirmGroupDelete(false); setConfirmChecked(false); setMessage("反映しました"); setLoading(false); await load(); };
  const saveGroupName = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; const trimmed = groupNameInput.trim(); if (!trimmed) return setError("グループ名を入力してください"); if (trimmed === groupName) { setEditingGroupName(false); return; } setLoading(true); const { error: e } = await s.from("clubs").update({ name: trimmed }).eq("id", id); if (e) setError("グループ名の更新に失敗しました"); else setMessage("グループ名を更新しました"); setEditingGroupName(false); setLoading(false); await load(); };
  const saveGroupDescription = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; const trimmed = groupDescriptionInput.trim(); if (trimmed === groupDescription) { setEditingDescription(false); return; } setLoading(true); const { error: e } = await s.from("clubs").update({ description: trimmed || null }).eq("id", id); if (e) setError("グループ説明の更新に失敗しました"); else setMessage("更新しました"); setEditingDescription(false); setLoading(false); await load(); };
  const saveFacility = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; setLoading(true); const { error: e } = await s.from("clubs").update({ main_facility_id: facilityId }).eq("id", id); if (e) setError("メインの活動場所の更新に失敗しました"); else setMessage("メインの活動場所を更新しました"); setEditingFacility(false); setLoading(false); await load(); };
  const uploadGroupImage = async (file: File) => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; setLoading(true); const ext = file.name.split(".").pop() ?? "jpg"; const path = `${id}/${Date.now()}.${ext}`; const { error: upErr } = await s.storage.from("group-images").upload(path, file, { upsert: true }); if (upErr) { setError("画像アップロードに失敗しました"); setLoading(false); return; } const { data: pub } = s.storage.from("group-images").getPublicUrl(path); const { error: e } = await s.from("clubs").update({ image_url: pub.publicUrl }).eq("id", id); if (e) setError("画像の更新に失敗しました"); else setMessage("画像を更新しました"); setEditingImage(false); setLoading(false); await load(); };
  const saveVisibility = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; setLoading(true); const { error: e } = await s.from("clubs").update({ visibility: visibilityInput }).eq("id", id); if (e) setError("公開設定の更新に失敗しました"); else setMessage("公開設定を更新しました"); setEditingVisibility(false); setLoading(false); await load(); };



  const submitJoinRequest = async () => {
    const s = getSupabaseClient(); if (!s || !id || loading) return;
    if (isMemberOfGroup) return setError("既にこのグループのメンバーです");
    if (myPendingRequest) return setError("申請中です");
    if (targetMemberId && (!joinPreview || !joinConsent || previewLoading)) return setError("引き継ぐ内容を確認して同意してください");
    setLoading(true); setError(""); setMessage("");
    try {
      await profileLinkRpc<string>(s, "submit_profile_join_request", { p_club_id: id, p_member_id: targetMemberId || null, p_message: joinMessage.trim() || null, p_review_token: joinPreview?.review_token ?? null });
      setMessage("加入申請を送信しました"); setTargetMemberId(""); setJoinMessage(""); setJoinConsent(false);
      await load();
    } catch (cause) { setError(profileErrorMessage(cause)); }
    finally { setLoading(false); }
  };

  const reviewJoinRequest = async (req: JoinRequest, next: "approved" | "rejected" | "cancelled") => {
    const s = getSupabaseClient(); if (!s || !id || loading) return;
    if (!canManage && !(next === "cancelled" && req.requester_auth_user_id === myAuthUserId)) return deny();
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await profileLinkRpc<{ status: LinkStatus }>(s, "review_profile_join_request", { p_request_id: req.id, p_decision: next });
      setMessage(result.status === "approved" ? "承認しました" : linkStatusLabel[result.status]);
      await load();
    } catch (cause) { setError(profileErrorMessage(cause)); }
    finally { setLoading(false); }
  };
  const cancelLinkRequest = async (request: ProfileLinkRequest) => {
    const s = getSupabaseClient(); if (!s || loading) return;
    setLoading(true); setError("");
    try { const result = await reviewPlayerProfileLink(s, request.id, "cancelled"); setMessage(result.status === "cancelled" ? "連携申請を取り消しました" : `申請は${linkStatusLabel[result.status]}です`); await load(); }
    catch (cause) { setError(profileErrorMessage(cause)); }
    finally { setLoading(false); }
  };

  if (!canViewGroup) return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4"><Card title="グループ">{message && <p role="status" className="mb-2 text-sm text-emerald-400">{message}</p>}<p className="text-sm text-zinc-300">{loading ? "読み込み中..." : error || "このグループを表示する権限がありません"}</p><Link href="/groups" className="mt-3 inline-block text-sm underline">所属グループへ戻る</Link></Card></main>;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <div className="relative min-h-10"><h1 className="pr-28 pt-1 text-xl font-bold">{groupName} 設定</h1><Link href="/groups" className="absolute right-14 top-0 rounded-lg border border-zinc-600 px-3 py-2 text-sm">戻る</Link></div>
      <p className="text-sm text-zinc-300">あなたの権限：{appRole === "super_user" ? "スーパーユーザー" : roleLabel[myRole]}</p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {message && <p className="text-sm text-emerald-400">{message}</p>}
      {loading && <p className="text-xs text-zinc-400">処理中...</p>}

      <div className="grid grid-cols-3 gap-2 text-xs">
        {(["グループ管理", "メンバー管理", "グループ戦績"] as MainTab[]).map((t) => (
          <button key={t} className={`rounded-lg px-2 py-2 ${tab === t ? "bg-accent text-black" : "bg-zinc-800 text-zinc-200"}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "グループ管理" && <Card title="グループ管理"><div className="space-y-3">{/* TODO: グループ画像機能は将来再公開予定。現時点ではUIのみ非表示。 */}<div><p className="mb-1 text-xs text-zinc-400">グループ名</p>{editingGroupName ? <div className="space-y-2"><input className="w-full rounded-xl bg-zinc-800 p-3" value={groupNameInput} onChange={(e) => setGroupNameInput(e.target.value)} /><div className="flex gap-2"><button disabled={loading} className="w-1/2 rounded-xl bg-accent py-2 text-black disabled:bg-zinc-600" onClick={() => void saveGroupName()}>保存</button><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => { setEditingGroupName(false); setGroupNameInput(groupName); }}>キャンセル</button></div></div> : <div className="flex items-center justify-between"><p>{groupName}</p>{canDeleteGroupAction && <button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => setEditingGroupName(true)}>編集</button>}</div>}</div><div><p className="mb-1 text-xs text-zinc-400">グループ説明</p>{editingDescription ? <div className="space-y-2"><textarea className="w-full rounded-xl bg-zinc-800 p-3" value={groupDescriptionInput} onChange={(e) => setGroupDescriptionInput(e.target.value)} /><div className="flex gap-2"><button disabled={loading} className="w-1/2 rounded-xl bg-accent py-2 text-black disabled:bg-zinc-600" onClick={() => void saveGroupDescription()}>保存</button><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => { setEditingDescription(false); setGroupDescriptionInput(groupDescription); }}>キャンセル</button></div></div> : <div className="flex items-center justify-between"><p className="text-sm text-zinc-300">{groupDescription || "説明なし"}</p>{canDeleteGroupAction && <button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => setEditingDescription(true)}>編集</button>}</div>}</div><div><p className="mb-1 text-xs text-zinc-400">メインの活動場所</p>{editingFacility ? <div className="space-y-2"><input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="施設名・都道府県・住所で検索" value={facilityInput} onChange={(e) => setFacilityInput(e.target.value)} /><select className="w-full rounded-xl bg-zinc-800 p-3" value={facilityId ?? ""} onChange={(e) => setFacilityId(e.target.value || null)}><option value="">未選択</option>{filteredFacilities.map((f) => <option key={f.id} value={f.id}>{f.name}{f.prefecture ? ` / ${f.prefecture}` : ""}</option>)}</select>{filteredFacilities.length === 0 && <p className="text-xs text-zinc-400">候補が見つかりません</p>}<div className="flex gap-2"><button disabled={loading} className="w-1/2 rounded-xl bg-accent py-2 text-black" onClick={() => void saveFacility()}>保存</button><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => setEditingFacility(false)}>キャンセル</button></div></div> : <div className="flex items-center justify-between"><p className="text-sm text-zinc-300">{facilities.find((f) => f.id === facilityId)?.name ?? "未選択"}</p>{canDeleteGroupAction && <button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => setEditingFacility(true)}>編集</button>}</div>}</div><div><p className="mb-1 text-xs text-zinc-400">公開設定</p>{editingVisibility ? <div className="space-y-2"><select className="w-full rounded-xl bg-zinc-800 p-3" value={visibilityInput} onChange={(e) => setVisibilityInput(e.target.value as "private" | "public")}><option value="private">非公開</option><option value="public">公開</option></select><div className="flex gap-2"><button disabled={loading} className="w-1/2 rounded-xl bg-accent py-2 text-black" onClick={() => void saveVisibility()}>保存</button><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => { setEditingVisibility(false); setVisibilityInput(visibility); }}>キャンセル</button></div></div> : <div className="flex items-center justify-between"><p className="text-sm text-zinc-300">現在: {visibility === "public" ? "公開" : "非公開"}</p>{canDeleteGroupAction && <button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => setEditingVisibility(true)}>編集</button>}</div>}</div>{canDeleteGroupAction && <button className="w-full rounded-xl border border-red-500 py-3 text-red-300" onClick={() => { setConfirmGroupDelete(true); setConfirmChecked(false); }}>グループ削除</button>}</div></Card>}

      {tab === "メンバー管理" && <Card title="メンバー管理"><div className="space-y-2">{canManage && <><input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="メンバー名" value={name} onChange={(e) => setName(e.target.value)} /><p className="text-xs text-zinc-400">未連携の仮登録選手として追加します。アカウント連携には本人承認が必要です。</p><button disabled={loading} className="w-full rounded-xl bg-accent py-3 font-semibold text-black disabled:bg-zinc-600" onClick={addMember}>メンバー追加</button></>}<div className="space-y-2">{members.map((m) => <MemberRow key={m.id} member={m} editable={canManage} currentRole={myRole} isSuperUser={isSuperUser} loading={loading} myAuthUserId={myAuthUserId} canViewRole={isSuperUser || isMemberOfGroup} onRename={renameMember} onRole={changeMemberRole} onLink={linkMemberAccount} clubId={id} pending={linkRequests.some(r => r.source_player_profile_id === m.player_profile_id && r.status === "pending")} onDeactivate={(x) => { if (!canManageTargetMember(roleCtx, x.role)) return deny(); setError(""); setConfirmLeave(x); setConfirmChecked(false); }} />)}</div><div className="mt-4"><p className="mb-2 text-sm font-semibold">退会済みメンバー</p>{inactiveMembers.length === 0 ? <p className="text-sm text-zinc-400">該当なし</p> : <div className="space-y-2">{inactiveMembers.map((m) => <div key={m.id} className="rounded-xl bg-zinc-800 p-3"><div className="flex items-center justify-between"><p className="font-semibold">{m.display_name}</p>{canManageTargetMember(roleCtx, m.role) && <button disabled={loading} className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => void restoreMember(m)}>復帰</button>}</div></div>)}</div>}</div></div></Card>}

      {tab === "グループ戦績" && (
        <Card title="グループ戦績">
          <div className="flex gap-2 text-xs">
            <button className={`rounded-lg px-2 py-2 ${statTab === "個人ランキング" ? "bg-accent text-black" : "bg-zinc-800"}`} onClick={() => setStatTab("個人ランキング")}>個人ランキング</button>
            <button className={`rounded-lg px-2 py-2 ${statTab === "ペアランキング" ? "bg-accent text-black" : "bg-zinc-800"}`} onClick={() => setStatTab("ペアランキング")}>ペアランキング</button>
            <button className={`rounded-lg px-2 py-2 ${statTab === "イベント履歴" ? "bg-accent text-black" : "bg-zinc-800"}`} onClick={() => setStatTab("イベント履歴")}>イベント履歴</button>
          </div>
          <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {statTab === "個人ランキング" && (
              <>
                {individualRows.length === 0 ? (
                  <p className="text-sm text-zinc-300">まだ戦績がありません</p>
                ) : (
                  <>
                    <div className="mb-2 flex gap-2 text-xs">
                      <button className={`rounded-lg px-2 py-2 ${individualMode === "総合ランキング" ? "bg-accent text-black" : "bg-zinc-800"}`} onClick={() => setIndividualMode("総合ランキング")}>総合ランキング</button>
                      <button className={`rounded-lg px-2 py-2 ${individualMode === "勝率ランキング" ? "bg-accent text-black" : "bg-zinc-800"}`} onClick={() => setIndividualMode("勝率ランキング")}>勝率ランキング</button>
                    </div>
                    {targetIndividuals.length === 0 ? (
                      <p className="text-sm text-zinc-300">ランキング対象のメンバーがいません</p>
                    ) : (
                      <>
                        <p className="text-xs text-zinc-400">ランキング対象</p>
                        {targetIndividuals.map((r: any, i: number) => (
                          <div key={`t-${i}`} className="rounded-xl bg-zinc-800 p-3 text-sm">
                            <p className="font-semibold">{i + 1}位 {r.name}</p>
                            <p>試合 {r.matches} / {formatRecord(r.wins, r.losses, r.draws)} / 勝率 {r.rate.toFixed(1)}%</p>
                            <p>得点 {r.scored} / 失点 {r.conceded} / 得失点差 {r.diff}</p>
                            <p>1試合平均得点 {r.avgScored.toFixed(1)} / 1試合平均失点 {r.avgConceded.toFixed(1)}</p>
                            <p>総合ポイント {r.totalPoint.toFixed(1)} / 勝点 {r.matchPoints}</p>
                          </div>
                        ))}
                      </>
                    )}
                    {referenceIndividuals.length > 0 && (
                      <>
                        <p className="mt-2 text-xs text-zinc-400">参考記録（3試合未満）</p>
                        <p className="text-xs text-amber-300">参考記録のみ表示しています</p>
                        {referenceIndividuals.map((r: any, i: number) => (
                          <div key={`r-${i}`} className="rounded-xl border border-amber-600/40 bg-zinc-800 p-3 text-sm">
                            <p className="font-semibold">{r.name}（参考記録）</p>
                            <p>試合 {r.matches} / {formatRecord(r.wins, r.losses, r.draws)} / 勝率 {r.rate.toFixed(1)}%</p>
                            <p>得点 {r.scored} / 失点 {r.conceded} / 得失点差 {r.diff}</p>
                            <p>1試合平均得点 {r.avgScored.toFixed(1)} / 1試合平均失点 {r.avgConceded.toFixed(1)}</p>
                            <p>総合ポイント {r.totalPoint.toFixed(1)} / 勝点 {r.matchPoints}</p>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </>
            )}
            {statTab === "ペアランキング" && (
              pairRows.length === 0 ? <p className="text-sm text-zinc-300">まだ戦績がありません</p> : pairRows.map((r: any, i: number) => (
                <div key={i} className="rounded-xl bg-zinc-800 p-3 text-sm">
                  <p className="font-semibold">{i + 1}位 {r.pairName}</p>
                  <p>試合 {r.matches} / {formatRecord(r.wins, r.losses, r.draws)} / 勝率 {r.rate.toFixed(1)}%</p>
                  <p>得点 {r.scored} / 失点 {r.conceded} / 得失点差 {r.diff}</p>
                  <p>1試合平均得失点差 {r.avgDiff.toFixed(1)}</p>
                </div>
              ))
            )}
            {statTab === "イベント履歴" && (
              eventHistoryRows.length === 0 ? <p className="text-sm text-zinc-300">まだ戦績がありません</p> : eventHistoryRows.map((e: any) => (
                <div key={e.id} className="rounded-xl bg-zinc-800 p-3 text-sm">
                  <p className="font-semibold">{e.name}</p>
                  <p>開催日 {new Date(e.date).toLocaleDateString("ja-JP")}</p>
                  <p>試合数 {e.matchCount} / 参加人数 {e.participantCount}</p>
                  <Link className="mt-1 inline-block text-xs underline" href={`/events/${e.id}`}>詳細を見る</Link>
                </div>
              ))
            )}
          </div>
        </Card>
      )}


      {!isMemberOfGroup && visibility === "public" && <Card title="加入申請"><div className="space-y-3">
        <p className="text-xs text-zinc-300">本人の仮登録選手を選ぶ場合は、引き継ぐ内容への同意が必要です。</p>
        <select aria-label="加入時に引き継ぐ仮登録選手" disabled={loading || !!myPendingRequest} className="w-full rounded-xl bg-zinc-800 p-3" value={targetMemberId} onChange={e => setTargetMemberId(e.target.value)}><option value="">選択しない（正規プロフィールで加入）</option>{members.filter(m => !m.linked_auth_user_id).map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>
        {previewLoading && <p className="text-xs text-zinc-400">引き継ぐ内容を確認中...</p>}
        {joinPreview && <><ProfileMergeSummary preview={joinPreview} /><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={joinConsent} onChange={e => setJoinConsent(e.target.checked)} /><span>この仮登録選手が自分であり、管理者の承認後に表示された所属・戦績を引き継ぐことに同意します</span></label></>}
        <textarea disabled={loading} className="w-full rounded-xl bg-zinc-800 p-3" placeholder="メッセージ" value={joinMessage} onChange={e => setJoinMessage(e.target.value)} />
        <p className="text-xs text-zinc-400">正規プロフィールが未作成の場合は、<Link href="/profile" className="underline">プロフィール画面</Link>で作成してください。申請は7日で期限切れになります。</p>
        {myPendingRequest ? <p className="text-sm text-zinc-300">申請中です</p> : <button disabled={loading || previewLoading || (!!targetMemberId && (!joinConsent || !joinPreview?.target_profile_id))} className="w-full rounded-xl bg-accent py-2 text-black disabled:bg-zinc-600" onClick={() => void submitJoinRequest()}>申請する</button>}
      </div></Card>}
      {joinRequests.some(r => r.requester_auth_user_id === myAuthUserId) && <Card title="自分の加入申請"><div className="space-y-2">{joinRequests.filter(r => r.requester_auth_user_id === myAuthUserId).map(r => <div key={r.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p>{linkStatusLabel[r.status]}</p><p className="text-xs text-zinc-400">対象：{r.target_member_name ?? "正規プロフィールで加入"}</p>{r.status === "pending" && <button disabled={loading} onClick={() => void reviewJoinRequest(r,"cancelled")} className="mt-2 rounded-lg border border-zinc-500 p-2">申請を取り消す</button>}</div>)}</div></Card>}
      {canManage && <Card title="連携申請一覧"><div className="space-y-2">{linkRequests.length === 0 ? <p className="text-sm text-zinc-400">該当なし</p> : linkRequests.map(r => <div key={r.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><Link href={`/profile/links/${r.id}`} className="underline">{r.source_display_name} / {linkStatusLabel[r.status]}</Link>{r.status === "pending" && <button disabled={loading} className="mt-2 block rounded-lg border border-zinc-500 p-2" onClick={() => void cancelLinkRequest(r)}>申請を取り消す</button>}</div>)}</div></Card>}
      {canManage && <Card title="加入申請一覧"><div className="space-y-2">{joinRequests.length === 0 ? <p className="text-sm text-zinc-400">該当なし</p> : joinRequests.map(r => <div key={r.id} className="rounded-xl bg-zinc-800 p-3"><p className="font-semibold">{r.requester_display_name}</p><p className="text-xs text-zinc-300">{linkStatusLabel[r.status]} / 希望メンバー：{r.target_member_name ?? "正規プロフィールで加入"}</p>{r.target_club_member_id && <p className="text-xs text-amber-200">{r.consent_at ? "本人の統合同意を記録済み" : "旧申請：本人の同意を再確認して再申請が必要です"}</p>}<p className="text-xs text-zinc-300">メッセージ：{r.message ?? "なし"}</p>{r.status === "pending" && <div className="mt-2 flex gap-2"><button disabled={loading} className="w-1/2 rounded-lg bg-accent py-2 text-black" onClick={() => void reviewJoinRequest(r,"approved")}>承認</button><button disabled={loading} className="w-1/2 rounded-lg border border-zinc-500 py-2" onClick={() => void reviewJoinRequest(r,"rejected")}>拒否</button></div>}</div>)}</div></Card>}

      {confirmLeave && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="leave-title" aria-describedby="leave-description" className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-4 overflow-y-auto rounded-xl bg-card p-5" onKeyDown={event => { if (event.key === "Escape" && !loading) { setConfirmLeave(null); setConfirmChecked(false); } }}>
          <h2 id="leave-title" className="font-semibold">{confirmLeave.display_name}さんを非表示／退会にしますか？</h2>
          <p id="leave-description" className="text-sm text-zinc-300">このグループの在籍一覧から除外されます。アカウントや過去の試合履歴は削除されません。後から復帰できます。</p>
          <label className="flex items-center gap-2 text-sm"><input autoFocus type="checkbox" checked={confirmChecked} disabled={loading} onChange={event => setConfirmChecked(event.target.checked)} />内容を確認しました</label>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2"><button disabled={loading} className="w-1/2 rounded-lg border border-zinc-500 p-3" onClick={() => { setConfirmLeave(null); setConfirmChecked(false); }}>キャンセル</button><button disabled={loading || !confirmChecked} className="w-1/2 rounded-lg bg-red-600 p-3 text-white disabled:opacity-50" onClick={() => void doDeactivate()}>非表示／退会する</button></div>
        </div>
      </div>}
    </main>
  );
}

function MemberRow({ member, editable, currentRole, isSuperUser, loading, myAuthUserId, canViewRole, onRename, onRole, onLink, clubId, pending, onDeactivate }: { member: Member; editable: boolean; currentRole: Role; isSuperUser: boolean; loading: boolean; myAuthUserId: string | null; canViewRole: boolean; onRename: (m: Member, name: string) => Promise<boolean>; onRole: (m: Member, role: Role) => Promise<boolean>; onLink: (m: Member, account: AccountCandidate) => Promise<void>; clubId: string; pending: boolean; onDeactivate: (m: Member) => void; }) {
  const [editing, setEditing] = useState(false);
  const [n, setN] = useState(member.display_name);
  const [r, setR] = useState<Role>(member.role);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<AccountCandidate[]>([]);
  const [selected, setSelected] = useState<AccountCandidate | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searched, setSearched] = useState(false);
  const isLinkedSelf = !!myAuthUserId && member.linked_auth_user_id === myAuthUserId;
  const cannotEdit = !editable || !canManageTargetMember({ isSuperUser, myRole: currentRole }, member.role);
  const hideRoleAndOps = !canViewRole;
  useEffect(() => { if (!editing) { setN(member.display_name); setR(member.role); } }, [member.display_name, member.role, editing]);
  const searchAccounts = async () => {
    const s = getSupabaseClient();
    const q = search.trim();
    setSearchError("");
    setSearched(true);
    if (!s || !q) { setCandidates([]); return; }
    setSearching(true);
    setCandidates([]); setSelected(null);
    try { setCandidates(await profileLinkRpc<AccountCandidate[]>(s, "find_profile_link_account", { p_club_id: clubId, p_email: q })); }
    catch (cause) { setSearchError(profileErrorMessage(cause)); }
    finally { setSearching(false); }
  };

  return (
    <div className="rounded-xl bg-zinc-800 p-3">
      <p className="text-xs text-zinc-400">在籍 / {member.linked_auth_user_id ? "連携済み" : pending ? "承認待ち" : "未連携"}</p>
      {editing ? (
        <div className="space-y-2">
          {member.linked_auth_user_id !== null ? <><p className="font-semibold">{member.display_name}</p><p className="text-xs text-zinc-300">アカウント連携済みの選手名は、本人のプロフィール画面から変更できます</p></> : <div className="space-y-2"><label className="block text-xs" htmlFor={`member-name-${member.id}`}>選手名</label><input id={`member-name-${member.id}`} className="w-full rounded-lg bg-zinc-700 p-2" value={n} onChange={e => setN(e.target.value)} /><button disabled={loading} className="w-full rounded-lg bg-accent py-2 text-black" onClick={() => void onRename(member,n)}>選手名を保存</button></div>}
          {!hideRoleAndOps && <div className="space-y-2"><label className="block text-xs" htmlFor={`member-role-${member.id}`}>役職</label><select id={`member-role-${member.id}`} className="w-full rounded-lg bg-zinc-700 p-2" value={r} onChange={e => setR(e.target.value as Role)}><option value="main_admin" disabled={!canManageTargetMember({isSuperUser,myRole:currentRole},"main_admin")}>メイン管理者</option><option value="sub_admin">サブ管理者</option><option value="member">メンバー</option></select><button disabled={loading} className="w-full rounded-lg border border-zinc-500 py-2" onClick={() => void onRole(member,r)}>役職を保存</button></div>}
          <button disabled={loading} className="w-full rounded-lg border border-zinc-500 py-2" onClick={() => setEditing(false)}>閉じる</button>
          {!member.linked_auth_user_id && !pending && !hideRoleAndOps && <div className="mt-2 rounded-lg border border-zinc-600 p-2">
            <p className="mb-1 text-xs text-zinc-300">本人から確認したメールアドレス</p>
            <div className="flex gap-2">
              <input className="w-full rounded-lg bg-zinc-700 p-2 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} type="email" placeholder="メールアドレスを完全一致で入力" />
              <button className="rounded-lg border border-zinc-500 px-3 text-sm" onClick={() => void searchAccounts()}>検索</button>
            </div>
            {searching ? <p className="mt-2 text-xs text-zinc-400">検索中...</p> : searchError ? <p className="mt-2 text-xs text-red-400">{searchError}</p> : (searched && candidates.length === 0) ? <p className="mt-2 text-xs text-zinc-400">候補が見つかりません</p> : (
              <div className="mt-2 space-y-1">{candidates.map((c) => <button key={c.auth_user_id} className={`w-full rounded-lg p-2 text-left text-xs ${selected?.auth_user_id === c.auth_user_id ? "bg-zinc-600" : "bg-zinc-700"}`} onClick={() => setSelected(c)}><p className="font-semibold">{c.display_name}</p><p>{c.identifier}</p></button>)}</div>
            )}
            {selected && <div className="mt-2 rounded-lg bg-zinc-700 p-2 text-xs"><p>選択中: {selected.display_name}</p><p>{selected.identifier}</p></div>}
            <div className="mt-2 flex gap-2">
              <button disabled={!selected || loading} className="w-1/2 rounded-lg bg-accent py-2 text-xs text-black disabled:bg-zinc-600" onClick={async () => { if (!selected) return; await onLink(member, selected); }}>連携申請を送信する</button>
            </div>
          </div>}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-2"><p className="font-semibold">{member.display_name}</p>{isLinkedSelf && <span className="rounded-full bg-emerald-500/30 px-2 py-0.5 text-[11px] text-emerald-200">あなた</span>}{canViewRole && <span className="rounded-full bg-blue-600/30 px-2 py-0.5 text-[11px] text-blue-200">{roleLabel[member.role]}</span>}</div>
          {!cannotEdit && !hideRoleAndOps && <div className="flex gap-2"><button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => setEditing(true)}>編集</button>{!cannotEdit && <button className="rounded border border-red-500 px-3 py-1 text-sm text-red-300" onClick={() => onDeactivate(member)}>非表示／退会</button>}</div>}
        </div>
      )}
    </div>
  );
}
