"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";
import { canDeleteGroup, canEditGroupProfile, canManageMembers, canSubAdminEditTarget, toAppRole } from "@/lib/permissions";

type Role = "main_admin" | "sub_admin" | "member";
type Member = {
  id: string;
  profile_id: string | null;
  player_profile_id: string;
  display_name: string;
  linked_auth_user_id: string | null;
  is_active: boolean;
  role: Role;
};
type AccountCandidate = {
  auth_user_id: string;
  display_name: string;
  email: string | null;
  created_at: string | null;
};
type StatTab = "個人ランキング" | "ペアランキング" | "イベント履歴";

type MainTab = "グループ管理" | "メンバー管理" | "グループ戦績";
type JoinRequest = { id: string; club_id: string; target_club_member_id: string | null; requester_auth_user_id: string; message: string | null; status: "pending" | "approved" | "rejected"; created_at: string; requester_display_name: string; requester_email: string | null; target_member_name: string | null; };

type Facility = { id: string; name: string; prefecture: string | null; address: string | null; };

function getProfileRow(playerProfiles: any) {
  return Array.isArray(playerProfiles) ? playerProfiles[0] : playerProfiles;
}
const resolveDisplayName = (playerProfiles: any) => {
  const displayName = getProfileRow(playerProfiles)?.display_name;
  return typeof displayName === "string" && displayName.trim() ? displayName : "名称未設定";
};

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
  const [linkId, setLinkId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState<Member | null>(null);
  const [confirmGroupDelete, setConfirmGroupDelete] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const [individualRows, setIndividualRows] = useState<any[]>([]);
  const [pairRows, setPairRows] = useState<any[]>([]);
  const [eventHistoryRows, setEventHistoryRows] = useState<any[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [targetMemberId, setTargetMemberId] = useState("");
  const [joinMessage, setJoinMessage] = useState("");
  const [isMemberOfGroup, setIsMemberOfGroup] = useState(false);
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
    const { data: events } = await s.from("events").select("id,name,created_at,status").eq("club_id", id).eq("status", "closed").eq("is_deleted", false).order("created_at", { ascending: false });
    const closedEventIds = (events ?? []).map((e: any) => e.id);
    if (!closedEventIds.length) {
      setIndividualRows([]); setPairRows([]); setEventHistoryRows([]); return;
    }

    const { data: participants } = await s.from("event_participants").select("id,event_id,player_profile_id,participant_type").in("event_id", closedEventIds);
    const memberParticipantIds = new Set((participants ?? []).filter((p: any) => p.participant_type !== "guest" && p.player_profile_id).map((p: any) => p.id));
    const participantMap = new Map((participants ?? []).map((p: any) => [p.id, p]));
    const profileIds = [...new Set((participants ?? []).map((p: any) => p.player_profile_id).filter(Boolean))];
    const { data: pps } = profileIds.length ? await s.from("player_profiles").select("id,display_name").in("id", profileIds) : { data: [] as any[] };
    const profileName = new Map((pps ?? []).map((p: any) => [p.id, p.display_name]));

    const { data: matches } = await s.from("matches").select("id,event_id,match_players(participant_id,team),match_results(score_a,score_b,winner_team)").in("event_id", closedEventIds);

    const pStats: Record<string, any> = {};
    const pairStats: Record<string, any> = {};

    for (const m of matches ?? []) {
      const res = m.match_results?.[0];
      if (!res) continue;
      const teamA = (m.match_players ?? []).filter((x: any) => x.team === "A").map((x: any) => x.participant_id).filter((id: string) => memberParticipantIds.has(id));
      const teamB = (m.match_players ?? []).filter((x: any) => x.team === "B").map((x: any) => x.participant_id).filter((id: string) => memberParticipantIds.has(id));

      const updPlayer = (pid: string, sA: number, sB: number, win: boolean) => {
        const prof = participantMap.get(pid)?.player_profile_id;
        if (!prof) return;
        if (!pStats[prof]) pStats[prof] = { name: profileName.get(prof) ?? "名称未設定", matches: 0, wins: 0, scored: 0, conceded: 0 };
        pStats[prof].matches += 1;
        if (win) pStats[prof].wins += 1;
        pStats[prof].scored += sA;
        pStats[prof].conceded += sB;
      };

      for (const pid of teamA) updPlayer(pid, res.score_a, res.score_b, res.winner_team === "A");
      for (const pid of teamB) updPlayer(pid, res.score_b, res.score_a, res.winner_team === "B");

      const updPair = (team: string[], sA: number, sB: number, win: boolean) => {
        if (team.length !== 2) return;
        const p1 = participantMap.get(team[0])?.player_profile_id;
        const p2 = participantMap.get(team[1])?.player_profile_id;
        if (!p1 || !p2) return;
        const [a, b] = [p1, p2].sort();
        const key = `${a}|${b}`;
        if (!pairStats[key]) pairStats[key] = { pairName: `${profileName.get(a) ?? "名称未設定"} / ${profileName.get(b) ?? "名称未設定"}`, matches: 0, wins: 0, scored: 0, conceded: 0 };
        pairStats[key].matches += 1;
        if (win) pairStats[key].wins += 1;
        pairStats[key].scored += sA;
        pairStats[key].conceded += sB;
      };

      updPair(teamA, res.score_a, res.score_b, res.winner_team === "A");
      updPair(teamB, res.score_b, res.score_a, res.winner_team === "B");
    }

    setIndividualRows(Object.values(pStats).filter((x: any) => x.matches >= 10).map((x: any) => ({ ...x, rate: (x.wins / x.matches) * 100, diff: x.scored - x.conceded, avgScored: x.scored / x.matches, avgConceded: x.conceded / x.matches })).sort((a: any, b: any) => b.rate - a.rate));
    setPairRows(Object.values(pairStats).map((x: any) => ({ ...x, rate: x.matches ? (x.wins / x.matches) * 100 : 0, diff: x.scored - x.conceded })).sort((a: any, b: any) => b.rate - a.rate));
    setEventHistoryRows((events ?? []).map((e: any) => ({ id: e.id, name: e.name, date: e.created_at, matchCount: (matches ?? []).filter((m: any) => m.event_id === e.id).length, participantCount: new Set((participants ?? []).filter((p: any) => p.event_id === e.id).map((p: any) => p.id)).size })));
  };

  const load = async () => {
    const s = getSupabaseClient();
    if (!s || !id) return;
    const { data: userRes } = await s.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) return;

    setLoading(true);
    const { data: adminRow } = await s.from("app_admins").select("id").eq("profile_id", uid).eq("is_active", true).maybeSingle();
    const superUser = !!adminRow;
    setIsSuperUser(superUser);

    const { data: group } = await s.from("clubs").select("name,description,is_active,image_url,main_facility_id,visibility").eq("id", id).maybeSingle();
    if (!group) { setError("この操作を行う権限がありません"); setLoading(false); return; }
    setGroupName(group.name ?? "グループ");
    setGroupDescription(group.description ?? "");
    setGroupNameInput(group.name ?? "");
    setGroupDescriptionInput(group.description ?? "");
    setGroupImageUrl((group as any).image_url ?? null);
    setFacilityId((group as any).main_facility_id ?? null);
    setVisibility(((group as any).visibility ?? "private") as "private" | "public");
    setVisibilityInput(((group as any).visibility ?? "private") as "private" | "public");

    const { data } = await s.from("club_members").select("id,profile_id,player_profile_id,is_active,role,player_profiles(id,display_name,linked_auth_user_id)").eq("club_id", id).order("created_at", { ascending: true });
    const rows: Member[] = (data ?? []).map((r: any) => ({
      id: r.id,
      profile_id: r.profile_id,
      player_profile_id: r.player_profile_id,
      display_name: resolveDisplayName(r.player_profiles),
      linked_auth_user_id: getProfileRow(r.player_profiles)?.linked_auth_user_id ?? null,
      is_active: r.is_active !== false,
      role: (r.role ?? "member") as Role
    }));

    const sorted = sortMembers(rows);
    setMembers(sorted.filter((m) => m.is_active));
    setInactiveMembers(sorted.filter((m) => !m.is_active));

    const me = rows.find((r) => (r.profile_id === uid || r.linked_auth_user_id === uid) && r.is_active);
    const canView = superUser || (group.is_active && ((group as any).visibility === "public" || !!me));
    if (!canView) { setError("この操作を行う権限がありません"); setLoading(false); return; }
    setMyProfileId(uid);
    setMyAuthUserId(uid);
    setMyRole(me?.role ?? "member");
    setIsMemberOfGroup(!!me);
    const { data: jrRows } = await s.from("join_requests").select("id,club_id,target_club_member_id,requester_auth_user_id,message,status,created_at").eq("club_id", id).order("created_at", { ascending: false });
    const requesterIds = [...new Set((jrRows ?? []).map((r: any) => r.requester_auth_user_id))];
    const { data: reqProfiles } = requesterIds.length ? await s.from("profiles").select("id,display_name,email").in("id", requesterIds) : { data: [] as any[] };
    const requesterMap = new Map((reqProfiles ?? []).map((r: any) => [r.id, r]));
    const memberNameMap = new Map(rows.map((m) => [m.id, m.display_name]));
    const normalizedReqs: JoinRequest[] = (jrRows ?? []).map((r: any) => ({
      ...r,
      requester_display_name: requesterMap.get(r.requester_auth_user_id)?.display_name ?? "名称未設定",
      requester_email: requesterMap.get(r.requester_auth_user_id)?.email ?? null,
      target_member_name: r.target_club_member_id ? (memberNameMap.get(r.target_club_member_id) ?? null) : null,
    }));
    setJoinRequests(normalizedReqs);
    setMyPendingRequest(normalizedReqs.find((r) => r.requester_auth_user_id === uid && r.status === "pending") ?? null);

    const { data: facilityRows, error: facilityErr } = await s.from("padel_facilities").select("id,name,prefecture,address").order("name", { ascending: true }).limit(500);
    if (facilityErr) setError("施設一覧の取得に失敗しました");
    setFacilities((facilityRows ?? []) as Facility[]);

    setLoading(false);
    await loadStats();
  };

  useEffect(() => { void load(); }, [id]);

  const activeMainAdmins = useMemo(() => members.filter((m) => m.role === "main_admin").length, [members]);

  const addMember = async () => { if (!canManage) return deny(); const s = getSupabaseClient(); if (!s || !id) return; const trimmed = name.trim(); if (!trimmed) return setError("メンバー名を入力してください"); if (members.some((m) => m.display_name.trim().toLowerCase() === trimmed.toLowerCase())) return setError("同じ名前のメンバーが既にいます"); setLoading(true); const { data: pp, error: pe } = await s.from("player_profiles").insert({ display_name: trimmed, linked_auth_user_id: linkId.trim() || null, is_active: true }).select("id").single(); if (pe || !pp?.id) { setError("メンバー追加に失敗しました"); setLoading(false); return; } await s.from("club_members").insert({ club_id: id, player_profile_id: pp.id, role: "member", is_active: true }); setMessage("更新しました"); setName(""); setLinkId(""); setLoading(false); await load(); };
  const updateMember = async (m: Member, newName: string, newRole: Role) => { const s = getSupabaseClient(); if (!s) return; const isLinkedSelf = !!myAuthUserId && m.linked_auth_user_id === myAuthUserId; if (!canManage && !isLinkedSelf) return deny(); const trimmed = newName.trim(); if (!trimmed) return setError("メンバー名を入力してください"); if (members.some((x) => x.id !== m.id && x.display_name.trim().toLowerCase() === trimmed.toLowerCase())) return setError("同じ名前のメンバーが既にいます"); setLoading(true); await s.from("player_profiles").update({ display_name: trimmed }).eq("id", m.player_profile_id); if (canManage) await s.from("club_members").update({ role: newRole }).eq("id", m.id); setMessage(isLinkedSelf ? "表示名を更新しました" : "更新しました"); setLoading(false); await load(); };
  const linkMemberAccount = async (m: Member, account: AccountCandidate) => {
    const s = getSupabaseClient(); if (!s) return; if (!canManage) return deny(); if (!id) return;
    setLoading(true);
    const { data: sameClubMembers } = await s
      .from("club_members")
      .select("id,player_profile_id,player_profiles!inner(linked_auth_user_id)")
      .eq("club_id", id)
      .eq("is_active", true);

    const duplicatedInSameClub = (sameClubMembers ?? []).some((row: any) => row.id !== m.id && row.player_profiles?.linked_auth_user_id === account.auth_user_id);
    if (duplicatedInSameClub) { setError("このアカウントはこのグループ内の別メンバーに既に紐づいています"); setLoading(false); return; }

    await s.from("player_profiles").update({ linked_auth_user_id: account.auth_user_id }).eq("id", m.player_profile_id);
    setMessage("紐づけました");
    setLoading(false);
    await load();
  };
  const unlinkMemberAccount = async (m: Member) => {
    const s = getSupabaseClient(); if (!s) return; if (!canManage) return deny();
    setLoading(true);
    await s.from("player_profiles").update({ linked_auth_user_id: null }).eq("id", m.player_profile_id);
    setMessage("紐づけを解除しました");
    setLoading(false);
    await load();
  };
  const doDeactivate = async () => { if (!confirmLeave) return; if (!canManage) return deny(); if (confirmLeave.role === "main_admin" && activeMainAdmins <= 1) return setError("メイン管理者は最低1人必要です"); const s = getSupabaseClient(); if (!s) return; setLoading(true); await s.from("club_members").update({ is_active: false }).eq("id", confirmLeave.id); setConfirmLeave(null); setConfirmChecked(false); setMessage("反映しました"); setLoading(false); await load(); };
  const restoreMember = async (m: Member) => { if (!canManage) return deny(); const s = getSupabaseClient(); if (!s) return; setLoading(true); await s.from("club_members").update({ is_active: true }).eq("id", m.id); setMessage("反映しました"); setLoading(false); await load(); };
  const doDeleteGroup = async () => { if (!canDeleteGroup) return deny(); const s = getSupabaseClient(); if (!s || !id) return; setLoading(true); await s.from("clubs").update({ is_active: false }).eq("id", id); setConfirmGroupDelete(false); setConfirmChecked(false); setMessage("反映しました"); setLoading(false); await load(); };
  const saveGroupName = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; const trimmed = groupNameInput.trim(); if (!trimmed) return setError("グループ名を入力してください"); if (trimmed === groupName) { setEditingGroupName(false); return; } setLoading(true); const { error: e } = await s.from("clubs").update({ name: trimmed }).eq("id", id); if (e) setError("グループ名の更新に失敗しました"); else setMessage("グループ名を更新しました"); setEditingGroupName(false); setLoading(false); await load(); };
  const saveGroupDescription = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; const trimmed = groupDescriptionInput.trim(); if (trimmed === groupDescription) { setEditingDescription(false); return; } setLoading(true); const { error: e } = await s.from("clubs").update({ description: trimmed || null }).eq("id", id); if (e) setError("グループ説明の更新に失敗しました"); else setMessage("更新しました"); setEditingDescription(false); setLoading(false); await load(); };
  const saveFacility = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; setLoading(true); const { error: e } = await s.from("clubs").update({ main_facility_id: facilityId }).eq("id", id); if (e) setError("メインの活動場所の更新に失敗しました"); else setMessage("メインの活動場所を更新しました"); setEditingFacility(false); setLoading(false); await load(); };
  const uploadGroupImage = async (file: File) => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; setLoading(true); const ext = file.name.split(".").pop() ?? "jpg"; const path = `${id}/${Date.now()}.${ext}`; const { error: upErr } = await s.storage.from("group-images").upload(path, file, { upsert: true }); if (upErr) { setError("画像アップロードに失敗しました"); setLoading(false); return; } const { data: pub } = s.storage.from("group-images").getPublicUrl(path); const { error: e } = await s.from("clubs").update({ image_url: pub.publicUrl }).eq("id", id); if (e) setError("画像の更新に失敗しました"); else setMessage("画像を更新しました"); setEditingImage(false); setLoading(false); await load(); };
  const saveVisibility = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; setLoading(true); const { error: e } = await s.from("clubs").update({ visibility: visibilityInput }).eq("id", id); if (e) setError("公開設定の更新に失敗しました"); else setMessage("公開設定を更新しました"); setEditingVisibility(false); setLoading(false); await load(); };



  const createNotifications = async (targets: string[], payload: { type: string; title: string; body?: string | null; relatedJoinRequestId?: string | null; }) => {
    const s = getSupabaseClient();
    if (!s || !id || targets.length === 0) return;
    const uniqueTargets = [...new Set(targets)];
    const rows = uniqueTargets.map((target) => ({
      target_auth_user_id: target,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      related_club_id: id,
      related_join_request_id: payload.relatedJoinRequestId ?? null,
    }));
    await s.from("notifications").insert(rows);
  };

  const submitJoinRequest = async () => {
    const s = getSupabaseClient(); if (!s || !id) return;
    const { data: userRes } = await s.auth.getUser(); const uid = userRes.user?.id; if (!uid) return setError("ログイン情報を確認できません");
    if (isMemberOfGroup) return setError("既にこのグループのメンバーです");
    if (myPendingRequest) return setError("申請中です");
    const { data: linkedProfile } = await s.from("player_profiles").select("id").eq("linked_auth_user_id", uid).maybeSingle();
    const { data: createdRequest, error: e } = await s.from("join_requests").insert({ club_id: id, target_club_member_id: targetMemberId || null, requester_auth_user_id: uid, requester_player_profile_id: linkedProfile?.id ?? null, message: joinMessage.trim() || null, status: "pending" }).select("id").single();
    if (e) return setError("加入申請に失敗しました");
    const { data: adminTargets } = await s.from("club_members").select("player_profiles!inner(linked_auth_user_id),role").eq("club_id", id).eq("is_active", true).in("role", ["main_admin", "sub_admin"]);
    const { data: superUsers } = await s.from("app_admins").select("profile_id").eq("is_active", true);
    const adminUids = (adminTargets ?? []).map((r: any) => r.player_profiles?.linked_auth_user_id).filter(Boolean);
    const superUids = (superUsers ?? []).map((r: any) => r.profile_id).filter(Boolean);
    await createNotifications([...adminUids, ...superUids], { type: "join_request_received", title: "加入申請されました", relatedJoinRequestId: createdRequest?.id ?? null });
    setMessage("加入申請を送信しました");
    setTargetMemberId(""); setJoinMessage("");
    await load();
  };

  const reviewJoinRequest = async (req: JoinRequest, next: "approved" | "rejected") => {
    const s = getSupabaseClient(); if (!s || !id) return; if (!canManage) return deny();
    const { data: userRes } = await s.auth.getUser(); const uid = userRes.user?.id; if (!uid) return;
    if (next === "approved") {
      const { data: sameClubMembers } = await s.from("club_members").select("id,player_profiles!inner(linked_auth_user_id)").eq("club_id", id).eq("is_active", true);
      const duplicated = (sameClubMembers ?? []).some((row: any) => row.player_profiles?.linked_auth_user_id === req.requester_auth_user_id && row.id !== req.target_club_member_id);
      if (duplicated) return setError("このアカウントはこのグループ内の別メンバーに既に紐づいています");
      if (req.target_club_member_id) {
        const { data: targetMember } = await s.from("club_members").select("player_profile_id").eq("id", req.target_club_member_id).maybeSingle();
        if (targetMember?.player_profile_id) await s.from("player_profiles").update({ linked_auth_user_id: req.requester_auth_user_id }).eq("id", targetMember.player_profile_id);
      } else {
        const { data: pp } = await s.from("player_profiles").select("id").eq("linked_auth_user_id", req.requester_auth_user_id).maybeSingle();
        let ppId = pp?.id;
        if (!ppId) { const { data: created } = await s.from("player_profiles").insert({ display_name: req.requester_display_name, linked_auth_user_id: req.requester_auth_user_id, is_active: true }).select("id").single(); ppId = created?.id; }
        if (ppId) await s.from("club_members").insert({ club_id: id, player_profile_id: ppId, role: "member", is_active: true });
      }
    }
    await s.from("join_requests").update({ status: next, reviewed_by_auth_user_id: uid, reviewed_at: new Date().toISOString() }).eq("id", req.id);
    await createNotifications([req.requester_auth_user_id], { type: next === "approved" ? "join_request_approved" : "join_request_rejected", title: next === "approved" ? "加入申請が承認されました" : "加入申請が否認されました", relatedJoinRequestId: req.id });
    setMessage(next === "approved" ? "承認しました" : "否認しました");
    await load();
  };


  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">{groupName} 設定</h1><Link href="/groups" className="rounded-lg border border-zinc-600 px-3 py-2 text-sm">戻る</Link></div>
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

      {tab === "メンバー管理" && <Card title="メンバー管理"><div className="space-y-2">{canManage && <><input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="メンバー名" value={name} onChange={(e) => setName(e.target.value)} /><input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="auth user id（任意）" value={linkId} onChange={(e) => setLinkId(e.target.value)} /><button disabled={loading} className="w-full rounded-xl bg-accent py-3 font-semibold text-black disabled:bg-zinc-600" onClick={addMember}>メンバー追加</button></>}<div className="space-y-2">{members.map((m) => <MemberRow key={m.id} member={m} editable={canManage} currentRole={myRole} isSuperUser={isSuperUser} loading={loading} myAuthUserId={myAuthUserId} canViewRole={isSuperUser || isMemberOfGroup} onSave={updateMember} onLink={linkMemberAccount} onUnlink={unlinkMemberAccount} onDeactivate={(x) => { if (!canManage) return deny(); setConfirmLeave(x); setConfirmChecked(false); }} />)}</div><div className="mt-4"><p className="mb-2 text-sm font-semibold">退会済みメンバー</p>{inactiveMembers.length === 0 ? <p className="text-sm text-zinc-400">該当なし</p> : <div className="space-y-2">{inactiveMembers.map((m) => <div key={m.id} className="rounded-xl bg-zinc-800 p-3"><div className="flex items-center justify-between"><p className="font-semibold">{m.display_name}</p>{canManage && <button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => void restoreMember(m)}>復帰</button>}</div></div>)}</div>}</div></div></Card>}

      {tab === "グループ戦績" && <Card title="グループ戦績"><div className="flex gap-2 text-xs"><button className={`rounded-lg px-2 py-2 ${statTab === "個人ランキング" ? "bg-accent text-black" : "bg-zinc-800"}`} onClick={() => setStatTab("個人ランキング")}>個人ランキング</button><button className={`rounded-lg px-2 py-2 ${statTab === "ペアランキング" ? "bg-accent text-black" : "bg-zinc-800"}`} onClick={() => setStatTab("ペアランキング")}>ペアランキング</button><button className={`rounded-lg px-2 py-2 ${statTab === "イベント履歴" ? "bg-accent text-black" : "bg-zinc-800"}`} onClick={() => setStatTab("イベント履歴")}>イベント履歴</button></div><div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">{statTab === "個人ランキング" && (individualRows.length === 0 ? <p className="text-sm text-zinc-300">まだ戦績がありません</p> : individualRows.map((r: any, i: number) => <div key={i} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-semibold">{i + 1}位 {r.name}</p><p>試合 {r.matches} / 勝利 {r.wins} / 勝率 {r.rate.toFixed(1)}%</p><p>得点 {r.scored} / 失点 {r.conceded} / 得失点差 {r.diff}</p><p>平均得点 {r.avgScored.toFixed(1)} / 平均失点 {r.avgConceded.toFixed(1)}</p></div>))}{statTab === "ペアランキング" && (pairRows.length === 0 ? <p className="text-sm text-zinc-300">まだ戦績がありません</p> : pairRows.map((r: any, i: number) => <div key={i} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-semibold">{i + 1}位 {r.pairName}</p><p>試合 {r.matches} / 勝利 {r.wins} / 勝率 {r.rate.toFixed(1)}%</p><p>得点 {r.scored} / 失点 {r.conceded} / 得失点差 {r.diff}</p></div>))}{statTab === "イベント履歴" && (eventHistoryRows.length === 0 ? <p className="text-sm text-zinc-300">まだ戦績がありません</p> : eventHistoryRows.map((e: any) => <div key={e.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-semibold">{e.name}</p><p>開催日 {new Date(e.date).toLocaleDateString("ja-JP")}</p><p>試合数 {e.matchCount} / 参加人数 {e.participantCount}</p><Link className="mt-1 inline-block text-xs underline" href={`/events/${e.id}`}>詳細を見る</Link></div>))}</div></Card>}


      {!isMemberOfGroup && visibility === "public" && <Card title="加入申請"><div className="space-y-2"><p className="text-xs text-zinc-300">紐づけたいメンバー</p><select className="w-full rounded-xl bg-zinc-800 p-3" value={targetMemberId} onChange={(e) => setTargetMemberId(e.target.value)}><option value="">未選択</option>{members.filter((m) => !m.linked_auth_user_id).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select><textarea className="w-full rounded-xl bg-zinc-800 p-3" placeholder="メッセージ" value={joinMessage} onChange={(e) => setJoinMessage(e.target.value)} />{myPendingRequest ? <p className="text-sm text-zinc-300">申請中です</p> : <button disabled={loading} className="w-full rounded-xl bg-accent py-2 text-black" onClick={() => void submitJoinRequest()}>申請する</button>}</div></Card>}

      {canManage && <Card title="加入申請一覧"><div className="space-y-2">{joinRequests.filter((r) => r.status === "pending").length === 0 ? <p className="text-sm text-zinc-400">該当なし</p> : joinRequests.filter((r) => r.status === "pending").map((r) => <div key={r.id} className="rounded-xl bg-zinc-800 p-3"><p className="font-semibold">{r.requester_display_name}</p><p className="text-xs text-zinc-300">{r.requester_email ?? "メール未設定"}</p><p className="text-xs text-zinc-300">希望メンバー: {r.target_member_name ?? "未選択"}</p><p className="text-xs text-zinc-300">メッセージ: {r.message ?? "なし"}</p><div className="mt-2 flex gap-2"><button className="w-1/2 rounded-lg bg-accent py-2 text-black" onClick={() => void reviewJoinRequest(r, "approved")}>承認</button><button className="w-1/2 rounded-lg border border-zinc-500 py-2" onClick={() => void reviewJoinRequest(r, "rejected")}>否認</button></div></div>)}</div></Card>}

      {confirmLeave && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-sm rounded-2xl bg-card p-4"><p className="font-semibold">本当に非表示/退会にしますか？</p><p className="mt-2 text-sm text-zinc-300">この操作を行うと、このメンバーは通常表示されなくなります。{confirmLeave.profile_id === myProfileId ? "（自分自身です）" : ""}</p><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} /><span>問題ないことを確認しました</span></label><div className="mt-4 flex gap-2"><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => setConfirmLeave(null)}>キャンセル</button><button disabled={!confirmChecked || loading} className="w-1/2 rounded-xl bg-red-500 py-2 disabled:bg-zinc-600" onClick={() => void doDeactivate()}>非表示/退会する</button></div></div></div>}
      {confirmGroupDelete && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-sm rounded-2xl bg-card p-4"><p className="font-semibold">本当にグループを削除しますか？</p><p className="mt-2 text-sm text-zinc-300">この操作は重要な操作です。イベント履歴や戦績に影響する可能性があります。</p><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} /><span>問題ないことを確認しました</span></label><div className="mt-4 flex gap-2"><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => setConfirmGroupDelete(false)}>キャンセル</button><button disabled={!confirmChecked || loading} className="w-1/2 rounded-xl bg-red-500 py-2 disabled:bg-zinc-600" onClick={() => void doDeleteGroup()}>グループを削除する</button></div></div></div>}
    </main>
  );
}

function MemberRow({ member, editable, currentRole, isSuperUser, loading, myAuthUserId, canViewRole, onSave, onLink, onUnlink, onDeactivate }: { member: Member; editable: boolean; currentRole: Role; isSuperUser: boolean; loading: boolean; myAuthUserId: string | null; canViewRole: boolean; onSave: (m: Member, n: string, r: Role) => Promise<void>; onLink: (m: Member, account: AccountCandidate) => Promise<void>; onUnlink: (m: Member) => Promise<void>; onDeactivate: (m: Member) => void; }) {
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
  const canEditSelfNameOnly = !editable && isLinkedSelf;
  const cannotEdit = !editable || !canSubAdminEditTarget({ isSuperUser, myRole: currentRole }, member.role);
  const hideRoleAndOps = !canViewRole;
  const isSuper = !!member.linked_auth_user_id;
  const searchAccounts = async () => {
    const s = getSupabaseClient();
    const q = search.trim();
    setSearchError("");
    setSearched(true);
    if (!s || !q) { setCandidates([]); return; }
    setSearching(true);
    const { data, error } = await s.from("profiles").select("id,display_name,email,created_at").or(`display_name.ilike.%${q}%,email.ilike.%${q}%`).order("created_at", { ascending: false }).limit(10);
    setSearching(false);
    if (error) { setSearchError("アカウント検索に失敗しました"); return; }
    const rows = (data ?? []).map((x: any) => ({ auth_user_id: x.id, display_name: x.display_name ?? "名称未設定", email: x.email ?? null, created_at: x.created_at ?? null }));
    setCandidates(rows);
  };

  return (
    <div className="rounded-xl bg-zinc-800 p-3">
      <p className="text-xs text-zinc-400">在籍</p>
      {editing ? (
        <div className="space-y-2">
          <input className="w-full rounded-lg bg-zinc-700 p-2" value={n} onChange={(e) => setN(e.target.value)} />
          {!canEditSelfNameOnly && !hideRoleAndOps && <select className="w-full rounded-lg bg-zinc-700 p-2" value={r} onChange={(e) => setR(e.target.value as Role)}>
            <option value="main_admin">メイン管理者</option><option value="sub_admin">サブ管理者</option><option value="member">メンバー</option>
          </select>}
          <div className="flex gap-2">
            <button disabled={loading} className="w-1/2 rounded-lg bg-accent py-2 text-black disabled:bg-zinc-600" onClick={async () => { await onSave(member, n, r); setEditing(false); }}>保存</button>
            <button className="w-1/2 rounded-lg border border-zinc-500 py-2" onClick={() => setEditing(false)}>キャンセル</button>
          </div>
          {!canEditSelfNameOnly && !hideRoleAndOps && <div className="mt-2 rounded-lg border border-zinc-600 p-2">
            <p className="mb-1 text-xs text-zinc-300">アカウントを検索</p>
            <div className="flex gap-2">
              <input className="w-full rounded-lg bg-zinc-700 p-2 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="名前・メールで検索" />
              <button className="rounded-lg border border-zinc-500 px-3 text-sm" onClick={() => void searchAccounts()}>検索</button>
            </div>
            {searching ? <p className="mt-2 text-xs text-zinc-400">検索中...</p> : searchError ? <p className="mt-2 text-xs text-red-400">{searchError}</p> : (searched && candidates.length === 0) ? <p className="mt-2 text-xs text-zinc-400">候補が見つかりません</p> : (
              <div className="mt-2 space-y-1">{candidates.map((c) => <button key={c.auth_user_id} className={`w-full rounded-lg p-2 text-left text-xs ${selected?.auth_user_id === c.auth_user_id ? "bg-zinc-600" : "bg-zinc-700"}`} onClick={() => setSelected(c)}><p className="font-semibold">{c.display_name}</p><p>{c.email ?? "メール未設定"}</p></button>)}</div>
            )}
            {selected && <div className="mt-2 rounded-lg bg-zinc-700 p-2 text-xs"><p>選択中: {selected.display_name}</p><p>{selected.email ?? "メール未設定"}</p></div>}
            <div className="mt-2 flex gap-2">
              <button disabled={!selected || loading} className="w-1/2 rounded-lg bg-accent py-2 text-xs text-black disabled:bg-zinc-600" onClick={async () => { if (!selected) return; await onLink(member, selected); }}>このアカウントを紐づける</button>
              <button disabled={!member.linked_auth_user_id || loading} className="w-1/2 rounded-lg border border-zinc-500 py-2 text-xs disabled:text-zinc-500" onClick={async () => { await onUnlink(member); }}>紐づけ解除</button>
            </div>
          </div>}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-2"><p className="font-semibold">{member.display_name}</p>{isLinkedSelf && <span className="rounded-full bg-emerald-500/30 px-2 py-0.5 text-[11px] text-emerald-200">あなた</span>}{canViewRole && <span className="rounded-full bg-blue-600/30 px-2 py-0.5 text-[11px] text-blue-200">{roleLabel[member.role]}</span>}{canViewRole && isSuper && <span className="rounded-full bg-amber-500/30 px-2 py-0.5 text-[11px] text-amber-200">スーパーユーザー</span>}</div>
          <p className="text-xs text-zinc-300">連携: {member.linked_auth_user_id ?? "未設定"}</p>
          {(!cannotEdit || canEditSelfNameOnly) && !hideRoleAndOps && <div className="flex gap-2"><button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => setEditing(true)}>編集</button>{!canEditSelfNameOnly && !cannotEdit && <button className="rounded border border-red-500 px-3 py-1 text-sm text-red-300" onClick={() => onDeactivate(member)}>非表示/退会</button>}</div>}
        </div>
      )}
    </div>
  );
}
