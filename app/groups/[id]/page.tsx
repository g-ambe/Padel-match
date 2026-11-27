"use client";
import { activeGroupMembership, groupPreview, groupTabs, readGroupEvents, type GroupEvent, type GroupTab, type GroupStatTab } from "@/lib/group-detail";
import { readGroupOrigin, safeGroupReturn, readGroupEventReturn } from "@/lib/group-detail-navigation";
import { useSessionAccount } from "@/components/use-session-account";
import { readMyMemberships, readClubRoster, readPublicDirectory, readPublicClubMemberCount, readJoinRequestNames, type RosterMember } from "@/lib/group-read";
import { ClubOwnerTransfer, type OwnerState } from "@/components/club-owner-transfer";
import { PublicClubJoinDialog } from "@/components/public-club-join-dialog";
import { ClubMemberFields } from "@/components/club-member-fields";
import { GroupActionIcon } from "@/components/group-action-icon";
import { validMemberFieldState, type MemberFieldState } from "@/lib/club-member-fields";
import { canEditClubDisplayName, groupMemberLabel, type ClubNameMember, type ClubNameContext } from "@/lib/club-display-name";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";
import { firstMatchResult, getHistoricalGroupMatchTeams, hasEnteredFriendlyMatchScore } from "@/lib/friendly-match-results";
import { fetchGroupStatsHistory } from "@/lib/stats-history";
import { canDeleteGroup, canEditGroupProfile, canManageMembers, canManageTargetMember, toAppRole } from "@/lib/permissions";
import { profileErrorMessage, PlayerProfileError, saveClubMemberRole, setClubMemberActive, type ClubMemberSnapshot } from "@/lib/player-profiles";
import { effectiveJoinStatus, linkStatusLabel, profileLinkRpc, requestPlayerProfileLink, reviewPlayerProfileLink, type AccountCandidate, type LinkStatus, type ProfileLinkRequest, type ProfileMergePreview } from "@/lib/profile-links";
import { ProfileMergeSummary } from "@/components/profile-merge-summary";
import { FacilitySelector } from "@/components/facility-selector";
import type { Facility } from "@/lib/padel-facilities";
import { AppDialog } from "@/components/app-dialog";
import { GroupMemberAvatar, useGroupAvatarSession } from "@/components/group-member-avatar";
import { ClubInvitationManager } from "@/components/club-invitation-manager";

type Role = "main_admin" | "sub_admin" | "member";
type Member = ClubNameMember & {
  profile_id: string | null;
  display_name: string;
  public_unlinked?:boolean;
  field_state?:MemberFieldState|null;
};
type StatTab = GroupStatTab;
type IndividualMode = "総合ランキング" | "勝率ランキング";

type MainTab = GroupTab;
type Popup = { kind: "menu"|"settings"|"member"|"add"|"inactive"|"requests"|"links"|"events"|"allStats"|"statDetail"|"points"; id?:string };
type JoinRequest = { id: string; club_id: string; target_club_member_id: string | null; requester_auth_user_id: string; requester_player_profile_id: string | null; message: string | null; status: LinkStatus; created_at: string; expires_at: string | null; consent_at: string | null; requester_display_name_snapshot: string | null; requester_display_name: string; target_member_name: string | null; };


function getProfileRow(playerProfiles: any) {
  return Array.isArray(playerProfiles) ? playerProfiles[0] : playerProfiles;
}
const resolveDisplayName = (playerProfiles: any) => {
  const displayName = getProfileRow(playerProfiles)?.display_name;
  return typeof displayName === "string" && displayName.trim() ? displayName : "名称未設定";
};
function memberFieldState(r:RosterMember):MemberFieldState|null {
 const value={member_id:r.id,club_display_name:r.player_profiles?.club_display_name??null,public_name_choice:r.player_profiles?.public_name_choice,public_name_confirmed:r.player_profiles?.public_name_confirmed,public_name_enabled:r.player_profiles?.public_name_enabled,group_visibility:r.player_profiles?.group_visibility};
 return validMemberFieldState(value)?value:null;
}
const rosterMember = (r: RosterMember): Member => ({
  id:r.id, club_id:r.club_id, profile_id:r.profile_id, player_profile_id:r.player_profile_id,
  // Keep the existing profile-name value for unrelated management/join flows.
  display_name:resolveDisplayName(r.player_profiles),
  profile_display_name:resolveDisplayName(r.player_profiles),
  club_display_name:r.player_profiles?.club_display_name ?? null,
  public_name_confirmed:r.player_profiles?.public_name_confirmed === true,
  field_state:memberFieldState(r),
  linked_auth_user_id:r.player_profiles?.linked_auth_user_id ?? null,
  is_active:r.is_active, status:r.status, player_active:!r.player_profile_id||!!r.player_profiles?.is_active, role:r.role,
});
const formatRecord = (wins: number, losses: number, draws: number) => `${wins}勝${losses}敗${draws}分`;

const roleLabel: Record<Role, string> = { main_admin: "メイン管理者", sub_admin: "サブ管理者", member: "メンバー" };
const roleRank: Record<Role, number> = { main_admin: 0, sub_admin: 1, member: 2 };

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>(), account = useSessionAccount();
  return account.ready ? <GroupDetail key={`${id}:${account.id}`} id={id} accountId={account.id}/> : <main className="p-4">読み込み中...</main>;
}
function GroupDetail({ id, accountId }: {id:string;accountId:string|null}) {
  const router = useRouter();
  const groupDeleteInFlight = useRef(false), leavingPage = useRef(false), alive = useRef(true), loadVersion = useRef(0);
  const [popups,setPopups]=useState<Popup[]>([]), [selectedMemberId,setSelectedMemberId]=useState<string|null>(null);
  const [descriptionExpanded,setDescriptionExpanded]=useState(false),[overviewEvents,setOverviewEvents]=useState<GroupEvent[]>([]);
  const [eventsError,setEventsError]=useState(""),[statsError,setStatsError]=useState("");
  const [ownerPanel,setOwnerPanel]=useState(false),[returnPath,setReturnPath]=useState("/profile#profile-groups");
  const popup = popups.at(-1), popupScroll=useRef<HTMLDivElement>(null), returnApplied=useRef(false);
  const tabScroll = useRef<Partial<Record<MainTab,number>>>({}),popupPositionsOnReturn=useRef<{depth:number;top:number}|null>(null);
  const popupStackRef=useRef<Popup[]>([]);popupStackRef.current=popups;
  const pushPopup=(next:Popup)=>{setMessage("");const stack=[...popupStackRef.current,next];popupStackRef.current=stack;setPopups(stack);history.pushState({...history.state,h21:{...history.state?.h21,id,account:accountId,stack,depth:0,hops:(history.state?.h21?.hops??0)+1}},"",location.href);};
  const popPopup=()=>{setMessage("");if(history.state?.h21?.id===id&&(history.state.h21.hops??0)>0)history.back();else {const stack=popupStackRef.current.slice(0,-1);setPopups(stack);history.replaceState({...history.state,h21:{...history.state?.h21,stack}},"",location.href);}};
  const [ownerDetail,setOwnerDetail]=useState(false),[ownerDismiss,setOwnerDismiss]=useState(0);
  const [ownerState, setOwnerState] = useState<OwnerState>("unknown");
  const [tab, setTab] = useState<MainTab>("概要");
  const [statTab, setStatTab] = useState<StatTab>("個人");
  const [groupName, setGroupName] = useState("グループ");
  const [groupDescription, setGroupDescription] = useState("");
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [groupDescriptionInput, setGroupDescriptionInput] = useState("");
  const [groupImageUrl, setGroupImageUrl] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [facilityInput,setFacilityInput]=useState<string|null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityError,setFacilityError]=useState("");
  const [editingFacility, setEditingFacility] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [editingVisibility, setEditingVisibility] = useState(false);
  const [visibilityInput, setVisibilityInput] = useState<"private" | "public">("private");


  const [members, setMembers] = useState<Member[]>([]);
  const [publicMemberCount,setPublicMemberCount]=useState<number|null>(null),[memberCountError,setMemberCountError]=useState("");
  const [inactiveMembers, setInactiveMembers] = useState<Member[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [myMemberId, setMyMemberId] = useState<string | null>(null);
  const [myAuthUserId, setMyAuthUserId] = useState<string | null>(null);
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [myRole, setMyRole] = useState<Role>("member");

  const [name, setName] = useState("");
  const [newMemberEmail,setNewMemberEmail]=useState("");
  const [invitePrefill,setInvitePrefill]=useState<{memberId:string;email:string}|null>(null);
  const pendingMemberProfile = useRef<{ id: string; name: string } | null>(null);
  const [linkRequests, setLinkRequests] = useState<ProfileLinkRequest[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState<Member | null>(null);
  const [confirmSelfLeave, setConfirmSelfLeave] = useState(false);
  const [selfLeaveConfirmed, setSelfLeaveConfirmed] = useState(false);
  const [selfLeaveBusy, setSelfLeaveBusy] = useState(false);
  const [selfLeaveError, setSelfLeaveError] = useState("");
  const [confirmGroupDelete, setConfirmGroupDelete] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const [individualRows, setIndividualRows] = useState<any[]>([]);
  const [pairRows, setPairRows] = useState<any[]>([]);
  const [eventHistoryRows, setEventHistoryRows] = useState<any[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [individualMode, setIndividualMode] = useState<IndividualMode>("総合ランキング");
  const [isMemberOfGroup, setIsMemberOfGroup] = useState(false);
  const [canViewGroup, setCanViewGroup] = useState(false);
  const [myPendingRequest, setMyPendingRequest] = useState<JoinRequest | null>(null);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [joinSubmitted, setJoinSubmitted] = useState(false);
  const avatarSession = useGroupAvatarSession(id, accountId,
    tab === "メンバー" && isMemberOfGroup && canViewGroup && !loading && !error,
    members.map(m => `${m.id}:${m.is_active}:${m.player_active}:${m.linked_auth_user_id}`).join("|"));

  const roleCtx = { isSuperUser, myRole };
  const nameContext = { ...roleCtx, clubId: id, userId: myAuthUserId, visibility };
  const canManage = canManageMembers(roleCtx);
  const canDeleteGroupAction = canDeleteGroup(roleCtx);
  const appRole = toAppRole(roleCtx);

  const deny = () => setError("この操作を行う権限がありません");

  const sortMembers = (rows: Member[]) => [...rows].sort((a, b) => {
    const d = roleRank[a.role] - roleRank[b.role];
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });

  const loadStats = async (valid:()=>boolean = ()=>alive.current) => {
    const s = getSupabaseClient();
    if (!s || !id) return;
    let history: Awaited<ReturnType<typeof fetchGroupStatsHistory>>;
    try {
      history = await fetchGroupStatsHistory(s, id);
    } catch (cause) {
      if (!valid()) return;
      console.error("戦績の試合履歴取得に失敗しました", cause);
      setIndividualRows([]); setPairRows([]); setEventHistoryRows([]);
      setStatsError("戦績の試合履歴を取得できませんでした。再度読み込んでください");
      return;
    }
    if (!valid()) return;
    setStatsError("");
    const { events, membersRaw, participants, pps, matches } = history;
    const memberProfileSet = new Set((membersRaw ?? []).map((m: any) => m.player_profile_id).filter(Boolean));
    const currentProfileSet = new Set((membersRaw ?? []).filter((m: any) => m.is_active).map((m: any) => m.player_profile_id).filter(Boolean));
    const memberParticipantIds = new Set((participants ?? []).filter((p: any) => p.participant_type !== "guest" && p.player_profile_id && memberProfileSet.has(p.player_profile_id)).map((p: any) => p.id));
    const participantMap = new Map((participants ?? []).map((p: any) => [p.id, p]));
    const profileName = new Map((pps ?? []).map((p: any) => [p.id, p.display_name]));

    const pStats: Record<string, any> = {};
    const pairStats: Record<string, any> = {};

    for (const m of matches ?? []) {
      const res = firstMatchResult(m.match_results);
      if (!res || !hasEnteredFriendlyMatchScore({ completed: m.completed, result: res })) continue;
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
    const s=getSupabaseClient(),version=++loadVersion.current,valid=()=>alive.current&&loadVersion.current===version;
    setLoading(true);setError("");setPublicMemberCount(null);setMemberCountError("");
    if(!s||!id){setError("グループの設定を確認できません");setLoading(false);return;}
    const {data:auth,error:authError}=await s.auth.getUser();
    if(!valid())return;
    const uid=auth.user?.id;
    if(authError||!uid||uid!==accountId){setCanViewGroup(false);setError("ログインしてグループを確認してください");setLoading(false);return;}
    // Resolve own active membership before any roster, statistics or management fetch.
    const own=activeGroupMembership(await readMyMemberships(s),id);
    if(!valid())return;
    const {data:group,error:groupError}=await s.from("clubs").select("name,description,is_active,main_facility_id,visibility").eq("id",id).maybeSingle();
    if(!valid())return;
    if(groupError||!group||(!own&&(!group.is_active||group.visibility!=="public"))){setCanViewGroup(false);setError("このグループを表示できません");setLoading(false);return;}
    setGroupName(group.name??"グループ");setGroupDescription(group.description??"");setGroupNameInput(group.name??"");setGroupDescriptionInput(group.description??"");
    setFacilityId(group.main_facility_id??null);setFacilityInput(group.main_facility_id??null);setVisibility(group.visibility??"private");setVisibilityInput(group.visibility??"private");
    setMyMemberId(own?.id??null);setMyRole((own?.role??"member") as Role);setIsMemberOfGroup(!!own);if(!own)setTab(t=>t==="戦績"?"概要":t);setMyAuthUserId(uid);setMyProfileId(uid);
    let superUser=false;
    if(own){const {data:a}=await s.from("app_admins").select("id").eq("profile_id",uid).eq("is_active",true).maybeSingle();superUser=!!a||auth.user?.email?.toLowerCase()==="testuser01@example.com";}
    if(!valid())return;
    setIsSuperUser(superUser);
    const data=own? (await readClubRoster(s,id)).map(rosterMember) : (await readPublicDirectory(s,id)).map(r=>({id:r.reference,club_id:id,profile_id:null,player_profile_id:null,display_name:r.display_name,profile_display_name:"",club_display_name:null,public_name_confirmed:false,linked_auth_user_id:null,is_active:true,status:"active",player_active:true,role:"member" as Role,public_unlinked:r.is_unlinked}));
    if(!valid())return;
    const sorted=sortMembers(data);setMembers(sorted.filter(m=>m.is_active&&m.player_active));setInactiveMembers(own?sorted.filter(m=>!m.is_active&&m.player_active):[]);
    setCanViewGroup(true);
    if(!own&&group.visibility==="public"){
      try{const count=await readPublicClubMemberCount(s,id);if(!valid())return;setPublicMemberCount(count);}
      catch{if(!valid())return;setMemberCountError("所属人数を取得できませんでした");}
    }
    // Management DTOs are not read for public visitors. The one exception is their own H17 request, loaded on demand.
    setJoinRequests([]);setLinkRequests([]);setMyPendingRequest(null);
    if(own&&(superUser||own.role==="main_admin"||own.role==="sub_admin")){
      const {data:jr,error:je}=await s.rpc("get_club_join_requests",{p_club_id:id});if(je)throw new Error("加入申請を取得できませんでした");
      const names=(jr??[]).length?await readJoinRequestNames(s,id):[];
      if(!valid())return;
      const namesById=new Map(names.map(r=>[r.id,r.display_name])),memberNames=new Map(data.map(m=>[m.id,m.display_name]));
      setJoinRequests((jr??[]).map((r:any)=>({...r,status:effectiveJoinStatus(r),requester_display_name:r.requester_display_name_snapshot??namesById.get(r.requester_auth_user_id)??"名称未設定",target_member_name:memberNames.get(r.target_club_member_id)??null})));
      const links=await profileLinkRpc<ProfileLinkRequest[]>(s,"list_player_profile_link_requests",{p_club_id:id});if(!valid())return;setLinkRequests(links);
    }
    const facilityQuery=s.from("padel_facilities").select("id,name,prefecture,address,aliases,availability,usage_note");
    const {data:facilitiesData,error:fe}=await (own&&(superUser||own.role==="main_admin")?facilityQuery.order("name").limit(500):facilityQuery.eq("id",group.main_facility_id??"00000000-0000-0000-0000-000000000000"));
    if(!valid())return;
    if(fe){setFacilityError("施設候補を取得できませんでした。登録済みの値は保持しています。");}else{setFacilities((facilitiesData??[]) as Facility[]);setFacilityError("");}
    if(own){
      try{const events=await readGroupEvents(s,id,true);if(!valid())return;setOverviewEvents(events);setEventsError("");}catch{if(valid())setEventsError("開催情報を取得できませんでした。再読み込みしてください");}
      await loadStats(valid);
    }else{setOverviewEvents([]);setIndividualRows([]);setPairRows([]);setEventHistoryRows([]);}
    if(valid())setLoading(false);
  };
  const refreshGroup=async()=>{try{await load();}catch{if(alive.current){setError("グループ情報を取得できませんでした。再度読み込んでください");setLoading(false);setCanViewGroup(false);}}};
  useEffect(()=>{alive.current=true;void refreshGroup();return()=>{alive.current=false;loadVersion.current++;};},[id]);
  useEffect(()=>{
    const q=new URLSearchParams(location.search),origin=readGroupOrigin(sessionStorage,q.get("entry"),accountId);
    setReturnPath(origin?`${origin.path}?groupRestore=${q.get("entry")}${origin.path==="/profile"?"#profile-groups":""}`:safeGroupReturn(q.get("from")));
    if(q.get("tab")==="stats")setTab("戦績");
  },[id,accountId]);
  useEffect(()=>{
    if(loading||!canViewGroup||returnApplied.current)return;
    returnApplied.current=true;
    const q=new URLSearchParams(location.search),r=readGroupEventReturn(sessionStorage,q.get("groupView"),accountId);
    if(!r||r.group.split("?")[0]!==`/groups/${id}`)return;
    if(groupTabs(isMemberOfGroup).includes(r.tab as MainTab))setTab(r.tab as MainTab);
    if(isMemberOfGroup){if(["個人","ペア","開催履歴"].includes(r.stat))setStatTab(r.stat as StatTab);if(["総合ランキング","勝率ランキング"].includes(r.mode))setIndividualMode(r.mode as IndividualMode);setPopups(r.popups.filter((p:any)=>p&&["events","allStats","statDetail","points"].includes(p.kind)) as Popup[]);}
    const restored=isMemberOfGroup?r.popups.filter((p:any)=>p&&["events","allStats","statDetail","points"].includes(p.kind)):[];
    history.replaceState({...history.state,h21:{id,account:accountId,tab:r.tab,stat:r.stat,mode:r.mode,stack:[],depth:0,hops:0}},"",location.href);
    restored.forEach((_,i)=>history.pushState({...history.state,h21:{...history.state.h21,stack:restored.slice(0,i+1),hops:i+1}},"",location.href));
    if(restored.length)popupPositionsOnReturn.current={depth:restored.length,top:r.inside};
    requestAnimationFrame(()=>{window.scrollTo(0,r.y);if(popupScroll.current)popupScroll.current.scrollTop=r.inside;});
  },[loading,canViewGroup,isMemberOfGroup]);
  const changeTab=(next:MainTab)=>{tabScroll.current[tab]=scrollY;setTab(next);setPopups([]);requestAnimationFrame(()=>window.scrollTo(0,tabScroll.current[next]??0));};
  const openEvent=(href:string)=>{
    const token=crypto.randomUUID();
    try{sessionStorage.setItem(`padel_group_event_v1:${token}`,JSON.stringify({account:accountId,group:location.pathname+location.search,path:href,tab,stat:statTab,mode:individualMode,popups,y:document.body.style.position==="fixed"?-(parseFloat(document.body.style.top)||0):scrollY,inside:popupScroll.current?.scrollTop??0}));}catch{return router.push(href);}
    router.push(`${href}?groupReturn=${token}`);
  };
  const checkOwnJoin=async()=>{
    const s=getSupabaseClient();if(!s||!myAuthUserId)return;
    setLoading(true);setError("");
    try{const {data,error:e}=await s.rpc("get_club_join_requests",{p_club_id:id});if(e)throw e;
      const own=(data??[]).filter((r:any)=>r.requester_auth_user_id===myAuthUserId).map((r:any)=>({...r,status:effectiveJoinStatus(r),requester_display_name:r.requester_display_name_snapshot??"",target_member_name:null}));
      setJoinRequests(own);setMyPendingRequest(own.find((r:any)=>r.status==="pending")??null);setJoinDialogOpen(!own.some((r:any)=>r.status==="pending"));
    }catch{setError("本人の申請状況を確認できません。再読み込みしてください");}finally{setLoading(false);}
  };

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
      const createdMember=await profileLinkRpc<string>(s, "add_provisional_club_member", { p_club_id: id, p_display_name: trimmed, p_operation_id: pendingMemberProfile.current.id });
      if(typeof createdMember!=="string"||!/^[0-9a-f-]{36}$/i.test(createdMember))throw new Error("メンバーの登録結果を確認できません");
      pendingMemberProfile.current = null;
      const email=newMemberEmail.trim();setInvitePrefill(email?{memberId:createdMember,email}:null);
      setMessage("未連携のメンバーを追加しました"); setName("");setNewMemberEmail("");
      await load();
      if(email){setSelectedMemberId(createdMember);pushPopup({kind:"member",id:createdMember});}
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
  const changeMemberRole = async (member: Member, role: Role) => {
    if (member.linked_auth_user_id === myAuthUserId && role !== "main_admin" && ownerState !== "other") {
      setError("オーナーの引継ぎ完了を確認してから役職を変更してください"); return false;
    }
    const s = getSupabaseClient(); if (!s || loading) return false;
    if (!canManageTargetMember(roleCtx, member.role) || !canManageTargetMember(roleCtx, role)) { deny(); return false; }
    setLoading(true); setError(""); setMessage("");
    try {
      await saveClubMemberRole(s, memberSnapshot(member), role);
      await load(); return true;
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
    if (confirmLeave.linked_auth_user_id === myAuthUserId && ownerState !== "other") return setError("オーナーの引継ぎ完了を確認してから退会してください");
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
  const leaveMyClub = async () => {
    if (!id || !myMemberId || !isMemberOfGroup || !selfLeaveConfirmed || selfLeaveBusy || loading) return;
    if (ownerState !== "other") { setSelfLeaveError("オーナーの引継ぎ完了を確認してから退会してください"); return; }
    const s = getSupabaseClient();
    if (!s) { setSelfLeaveError("退会の準備ができませんでした"); return; }
    setSelfLeaveBusy(true); setSelfLeaveError("");
    try {
      // Only the server resolves identity, owner and last-main guards. The UI
      // never performs a direct club_members UPDATE and never touches history.
      const { data, error: leaveError } = await s.rpc("leave_my_club", {
        p_club_id: id, p_member_id: myMemberId,
      });
      if (leaveError || data !== myMemberId) {
        const owner = leaveError?.message?.includes("オーナー");
        const lastMain = leaveError?.message?.includes("メイン管理者");
        setSelfLeaveError(owner
          ? "オーナーの引継ぎが完了してから退会してください"
          : lastMain
            ? "メイン管理者は最低1人必要です。先に管理権限を引き継いでください"
            : "退会できませんでした。所属状態を確認して再度お試しください");
        return;
      }
      leavingPage.current=true;setConfirmSelfLeave(false); setSelfLeaveConfirmed(false);
      router.replace("/profile#profile-groups");
    } catch {
      setSelfLeaveError("通信に失敗しました。所属状態を確認して再度お試しください");
    } finally { setSelfLeaveBusy(false); }
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
  const doDeleteGroup = async () => {
    if (!canDeleteGroupAction) return deny();
    if (!confirmGroupDelete || !confirmChecked || loading || groupDeleteInFlight.current) return;
    const s = getSupabaseClient();
    if (!s || !id) return setError("接続情報を取得できません。再読み込みしてお試しください");
    groupDeleteInFlight.current = true;
    setLoading(true); setError(""); setMessage("");
    try {
      const { data, error: deleteError } = await s.from("clubs").update({ is_active: false })
        .eq("id", id).eq("is_active", true).select("id").single();
      if (deleteError || data?.id !== id) {
        setError("グループを削除できませんでした。権限と現在の状態を確認し、再読み込みしてください");
        return;
      }
      leavingPage.current=true;setConfirmGroupDelete(false); setConfirmChecked(false);
      router.push("/profile#profile-groups");
    } catch {
      setError("グループ削除の通信に失敗しました。再読み込みして状態を確認してください");
    } finally {
      groupDeleteInFlight.current = false; setLoading(false);
    }
  };
  const saveGroupName = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; const trimmed = groupNameInput.trim(); if (!trimmed) return setError("グループ名を入力してください"); if (trimmed === groupName) { setEditingGroupName(false); return; } setLoading(true); const { error: e } = await s.from("clubs").update({ name: trimmed }).eq("id", id); if (e) { setError("グループ名の更新に失敗しました"); setLoading(false); return; } else setMessage(""); setEditingGroupName(false); setLoading(false); await load(); };
  const saveGroupDescription = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; const trimmed = groupDescriptionInput.trim(); if (trimmed === groupDescription) { setEditingDescription(false); return; } setLoading(true); const { error: e } = await s.from("clubs").update({ description: trimmed || null }).eq("id", id); if (e) { setError("グループ説明の更新に失敗しました"); setLoading(false); return; } else setMessage(""); setEditingDescription(false); setLoading(false); await load(); };
  const saveFacility = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; setLoading(true); const { error: e } = await s.from("clubs").update({ main_facility_id: facilityInput }).eq("id", id); if (e) { setError("ホームコートの更新に失敗しました"); setLoading(false); return; } else setMessage(""); setEditingFacility(false); setLoading(false); await load(); };
  const uploadGroupImage = async (file: File) => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; setLoading(true); const ext = file.name.split(".").pop() ?? "jpg"; const path = `${id}/${Date.now()}.${ext}`; const { error: upErr } = await s.storage.from("group-images").upload(path, file, { upsert: true }); if (upErr) { setError("画像アップロードに失敗しました"); setLoading(false); return; } const { data: pub } = s.storage.from("group-images").getPublicUrl(path); const { error: e } = await s.from("clubs").update({ image_url: pub.publicUrl }).eq("id", id); if (e) setError("画像の更新に失敗しました"); else setMessage("画像を更新しました"); setEditingImage(false); setLoading(false); await load(); };
  const saveVisibility = async () => { if (!canEditGroupProfile(roleCtx)) return deny(); const s = getSupabaseClient(); if (!s || !id) return; setLoading(true); const { error: e } = await s.from("clubs").update({ visibility: visibilityInput }).eq("id", id); if (e) { setError("公開設定の更新に失敗しました"); setLoading(false); return; } else setMessage(""); setEditingVisibility(false); setLoading(false); await load(); };



  const reviewJoinRequest = async (req: JoinRequest, next: "approved" | "rejected" | "cancelled") => {
    const s = getSupabaseClient(); if (!s || !id || loading) return;
    if (!canManage && !(next === "cancelled" && req.requester_auth_user_id === myAuthUserId)) return deny();
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await profileLinkRpc<{ status: LinkStatus }>(s, "review_profile_join_request", { p_request_id: req.id, p_decision: next });
      setMessage(result.status === "approved" ? "承認しました" : linkStatusLabel[result.status]);
      if(result.status === "cancelled")setJoinSubmitted(false);
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

  const selectedMember=[...members,...inactiveMembers].find(m=>m.id===(popup?.kind==="member"?popup.id:selectedMemberId));
  const childOpen=confirmSelfLeave||confirmGroupDelete||!!confirmLeave||joinDialogOpen||ownerPanel;
  const popupPositions=useRef<number[]>([]);if(popupPositionsOnReturn.current){popupPositions.current[popupPositionsOnReturn.current.depth]=popupPositionsOnReturn.current.top;popupPositionsOnReturn.current=null;}
  const childDepth=ownerDetail?2:childOpen?1:0,priorDepth=useRef(0);
  const closeChildRef=useRef<(depth:number)=>void>(()=>{});
  closeChildRef.current=depth=>{
    if(depth<2&&ownerDetail){setOwnerDismiss(n=>n+1);setOwnerDetail(false);}
    if(depth===0){setConfirmSelfLeave(false);setConfirmGroupDelete(false);setConfirmLeave(null);setJoinDialogOpen(false);setOwnerPanel(false);}
  };
  useEffect(()=>{
    const saved=history.state?.h21;
    if(saved?.id===id&&saved.account===accountId){
      if(groupTabs(isMemberOfGroup).includes(saved.tab))setTab(saved.tab);
      if(["個人","ペア","開催履歴"].includes(saved.stat))setStatTab(saved.stat);
      if(["総合ランキング","勝率ランキング"].includes(saved.mode))setIndividualMode(saved.mode);
      if(Array.isArray(saved.stack))setPopups(saved.stack.filter((p:Popup)=>p&&(isMemberOfGroup||p.kind==="member")&&["menu","settings","member","add","inactive","requests","links","events","allStats","statDetail","points"].includes(p.kind)));
    }else history.replaceState({...history.state,h21:{id,account:accountId,stack:[],depth:0,hops:0}},"",location.href);
    const back=(event:PopStateEvent)=>{const state=event.state?.h21;if(state?.id!==id||state.account!==accountId)return;
      if(popupStackRef.current.at(-1)?.kind==="settings"&&state.stack?.at(-1)?.kind!=="settings"){setEditingGroupName(false);setEditingDescription(false);setEditingFacility(false);setEditingVisibility(false);}
      closeChildRef.current(state.depth??0);setPopups(Array.isArray(state.stack)?state.stack.filter((p:Popup)=>p&&(isMemberOfGroup||p.kind==="member")):[]);
      if(groupTabs(isMemberOfGroup).includes(state.tab))setTab(state.tab);
    };
    window.addEventListener("popstate",back);return()=>window.removeEventListener("popstate",back);
  },[id,accountId,isMemberOfGroup]);
  useEffect(()=>{
    const state=history.state?.h21;if(state?.id!==id||leavingPage.current)return;
    if(childDepth>priorDepth.current&&(state.depth??0)<childDepth)history.pushState({...history.state,h21:{...state,depth:childDepth,stack:popups,hops:(state.hops??0)+1}},"",location.href);
    else if(childDepth<priorDepth.current&&(state.depth??0)>childDepth)history.go(childDepth-(state.depth??0));
    priorDepth.current=childDepth;
  },[childDepth]);
  useEffect(()=>{if(history.state?.h21?.id===id)history.replaceState({...history.state,h21:{...history.state.h21,tab,stat:statTab,mode:individualMode}},"",location.href);},[tab,statTab,individualMode]);
  useEffect(()=>{if(popup&&!childOpen)requestAnimationFrame(()=>{if(popupScroll.current)popupScroll.current.scrollTop=popupPositions.current[popups.length]??0;});},[popup,childOpen]);
  const memberButton=(m:Member)=><button key={m.id} type="button" data-member-id={m.id} className="flex min-h-14 w-full items-center gap-3 py-2 text-left" onClick={()=>{setSelectedMemberId(m.id);pushPopup({kind:"member",id:m.id});}}>
    <GroupMemberAvatar member={m} session={avatarSession}/>
    <span className="min-w-0 flex-1 break-words text-sm font-semibold">{m.public_unlinked!==undefined?m.display_name:groupMemberLabel(m)}</span>
    {(isMemberOfGroup||isSuperUser)&&<span className="shrink-0 text-[11px] text-zinc-400">{roleLabel[m.role]}</span>}
    {(!m.linked_auth_user_id&&m.public_unlinked!==false)&&<span className="shrink-0 text-[11px] text-zinc-400">未連携</span>}<GroupActionIcon name="right" className="shrink-0 text-zinc-400"/>
  </button>;
  const eventRows=(events:GroupEvent[])=><div className="divide-y divide-zinc-700">{events.map(e=><button type="button" key={e.href} onClick={()=>openEvent(e.href)} className="block min-h-14 w-full py-3 text-left"><span className="block break-words text-sm font-semibold">{e.name}</span><span className="text-xs text-zinc-400">{new Date(e.date).toLocaleDateString("ja-JP")} / {e.status==="closed"?"終了":e.status==="active"?"開催中":"開催情報"}<GroupActionIcon name="right" className="ml-1 inline-block"/></span></button>)}</div>;
  const statRows=statTab==="個人"?[...targetIndividuals,...referenceIndividuals]:statTab==="ペア"?pairRows:eventHistoryRows;
  const statKey=(r:any)=>statTab==="個人"?r.playerId:statTab==="ペア"?r.playerIds.join("|"):r.id;
  const statButton=(r:any,i:number)=><button type="button" key={statKey(r)} className="min-h-14 w-full rounded-xl bg-zinc-800 p-3 text-left text-sm" onClick={()=>pushPopup({kind:"statDetail",id:statKey(r)})}>
    <GroupActionIcon name="right" className="float-right ml-2 mt-2 text-zinc-400"/><span className="block break-words font-semibold">{statTab==="開催履歴"?r.name:`${r.isReference?"参考記録":`${i+1}位`} ${r.name??r.pairName}`}</span>
    <span className="block text-xs text-zinc-400">{statTab==="開催履歴"?`${new Date(r.date).toLocaleDateString("ja-JP")} / 試合 ${r.matchCount}`:`${formatRecord(r.wins,r.losses,r.draws)} / 勝率 ${r.rate.toFixed(1)}%`}</span>
  </button>;
  const detailStat=statRows.find(r=>statKey(r)===popup?.id);
  const closePopup=()=>{if(popup?.kind==="settings"){setEditingGroupName(false);setGroupNameInput(groupName);setEditingDescription(false);setGroupDescriptionInput(groupDescription);setEditingFacility(false);setFacilityInput(facilityId);setEditingVisibility(false);setVisibilityInput(visibility);}if(popup?.kind==="add"){setName("");setNewMemberEmail("");}if(popup?.kind==="member")setInvitePrefill(null);popPopup();requestAnimationFrame(()=>{if(popupScroll.current)popupScroll.current.scrollTop=popupPositions.current[popups.length-1]??0;});};
  const popupTitle=popup?({menu:"グループの操作",settings:"グループ設定",member:"メンバー詳細",add:"メンバーを追加",inactive:"退会済みメンバー",requests:"加入申請",links:"連携申請",events:"開催一覧",allStats:`${statTab}の全件`,statDetail:"戦績の詳細",points:"総合ptについて"})[popup.kind]:"";
  if (!canViewGroup) return <main className="mx-auto min-h-screen w-full max-w-md space-y-4 p-4"><Card title="グループ"><p role={error?"alert":"status"} className="text-sm">{loading?"読み込み中...":error||"このグループを表示できません"}</p><button disabled={loading} className="mt-3 min-h-11 text-sm underline" onClick={()=>void refreshGroup()}>再読み込み</button></Card><Link href={returnPath} scroll={!returnPath.includes("groupRestore=")} className="block min-h-11 py-3 text-sm underline">戻る</Link></main>;
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
    <header className="flex min-h-11 items-start gap-2 pr-11"><Link href={returnPath} scroll={!returnPath.includes("groupRestore=")} aria-label="戻る" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg"><GroupActionIcon name="left"/></Link><div className="min-w-0 flex-1"><h1 className="break-words text-xl font-bold">{groupName}</h1><p className="text-xs text-zinc-400">{visibility==="public"?"公開グループ":"非公開グループ"}</p></div>{isMemberOfGroup&&<button type="button" aria-label="グループの操作" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-zinc-700" onClick={()=>pushPopup({kind:"menu"})}><GroupActionIcon name="settings"/></button>}</header>
    {error&&<p role="alert" className="break-words text-sm text-red-400">{error}</p>}{message&&<p role="status" className="text-sm text-emerald-400">{message}</p>}
    {loading&&<p role="status" className="text-xs text-zinc-400">処理中...</p>}
    <div role="tablist" aria-label="グループ詳細" className={`grid gap-2 ${isMemberOfGroup?"grid-cols-3":"grid-cols-2"}`}>{groupTabs(isMemberOfGroup).map(t=><button key={t} role="tab" aria-selected={tab===t} className={`min-h-11 rounded-xl p-2 text-sm ${tab===t?"bg-accent text-black":"bg-zinc-800 text-zinc-200"}`} onClick={()=>changeTab(t)}>{t}</button>)}</div>
    {tab==="概要"&&<>
      <Card title="グループ紹介"><p className="whitespace-pre-wrap break-words text-sm text-zinc-300">{groupDescription?(descriptionExpanded?groupDescription:groupDescription.slice(0,140))+(groupDescription.length>140&&!descriptionExpanded?"…":""):"紹介文は未設定です"}</p>{groupDescription.length>140&&<button aria-expanded={descriptionExpanded} className="flex min-h-11 items-center gap-1 text-xs text-zinc-400" onClick={()=>setDescriptionExpanded(v=>!v)}>{descriptionExpanded?"閉じる":"もっと見る"}<GroupActionIcon name={descriptionExpanded?"up":"down"}/></button>}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm"><dt className="text-zinc-400">活動施設</dt><dd className="break-words">{facilities.find(f=>f.id===facilityId)?.name??"未設定"}</dd><dt className="text-zinc-400">所属人数</dt><dd>{isMemberOfGroup?`${members.length}人`:publicMemberCount!==null?`${publicMemberCount}人`:loading?"確認中…":"不明"}</dd><dt className="text-zinc-400">公開状態</dt><dd>{visibility==="public"?"公開":"非公開"}</dd></dl>
        {!isMemberOfGroup&&memberCountError&&<div className="mt-2"><p role="alert" className="text-sm text-red-400">{memberCountError}</p><button type="button" disabled={loading} className="min-h-11 text-sm underline disabled:opacity-50" onClick={()=>void refreshGroup()}>所属人数を再読み込み</button></div>}
      </Card>
      <Card title={<span className="flex items-center justify-between gap-2"><span>最近の開催</span>{isMemberOfGroup&&!eventsError&&groupPreview(overviewEvents).hasMore&&<button className="flex min-h-11 shrink-0 items-center gap-1 text-xs font-normal text-zinc-400" onClick={()=>pushPopup({kind:"events"})}>すべて見る<GroupActionIcon name="right"/></button>}</span>}>{isMemberOfGroup?<>{eventsError?<p role="alert" className="text-sm text-red-400">{eventsError}</p>:overviewEvents.length?eventRows(groupPreview(overviewEvents).visible):<p className="text-sm text-zinc-400">開催はありません</p>}</>:<p className="text-sm text-zinc-400">開催情報は所属後に確認できます。</p>}</Card>
    </>}
    {tab==="メンバー"&&<Card title="メンバー"><div className="divide-y divide-zinc-700">{members.map(memberButton)}</div>{!members.length&&<p className="text-sm text-zinc-400">表示できるメンバーはいません</p>}{canManage&&isMemberOfGroup&&<div className="mt-3 grid grid-cols-2 gap-2"><button className="min-h-11 rounded-xl border border-zinc-600 p-2 text-sm" onClick={()=>pushPopup({kind:"add"})}>メンバー追加</button><button className="min-h-11 rounded-xl border border-zinc-600 p-2 text-sm" onClick={()=>pushPopup({kind:"requests"})}>加入申請</button></div>}</Card>}
    {tab==="戦績"&&isMemberOfGroup&&<Card title="グループ戦績">
      <div className="grid grid-cols-3 gap-2">{(["個人","ペア","開催履歴"] as StatTab[]).map(t=><button type="button" key={t} className={`min-h-11 rounded-xl p-2 text-xs ${statTab===t?"bg-accent text-black":"bg-zinc-800"}`} onClick={()=>setStatTab(t)}>{t}</button>)}</div>
      {statTab==="個人"&&<div className="my-3 flex flex-wrap items-center gap-2 text-xs">{(["総合ランキング","勝率ランキング"] as IndividualMode[]).map(m=><button key={m} className={`min-h-11 rounded-xl px-2 ${individualMode===m?"bg-accent text-black":"bg-zinc-800"}`} onClick={()=>setIndividualMode(m)}>{m}</button>)}<button type="button" aria-label="総合ptの説明" className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-zinc-400" onClick={()=>pushPopup({kind:"points"})}><GroupActionIcon name="info"/>ptの説明</button></div>}
      {statsError?<p role="alert" className="mt-3 text-sm text-red-400">{statsError}</p>:<div className="mt-3 space-y-2">{groupPreview(statRows).visible.map(statButton)}{!statRows.length&&<p className="text-sm text-zinc-400">まだ戦績がありません</p>}{groupPreview(statRows).hasMore&&<button className="ml-auto flex min-h-11 items-center gap-1 text-sm text-zinc-400" onClick={()=>pushPopup({kind:"allStats"})}><span>すべて見る</span><GroupActionIcon name="right" className="inline-block"/></button>}</div>}
    </Card>}
    {!isMemberOfGroup&&visibility==="public"&&<Card title="加入申請"><p className="text-sm text-zinc-300">このグループで使う表示名と公開内容を確認して申請します。</p>{myPendingRequest||joinSubmitted?<p className="mt-2 text-sm">申請中です</p>:<button type="button" disabled={loading} className="mt-3 min-h-11 w-full rounded-xl bg-accent p-3 text-sm text-black disabled:opacity-50" onClick={()=>void checkOwnJoin()}>加入申請を確認</button>}
      {joinRequests.some(r => r.requester_auth_user_id === myAuthUserId) && <Card title="自分の加入申請"><div className="space-y-2">{joinRequests.filter(r => r.requester_auth_user_id === myAuthUserId).map(r => <div key={r.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p>{linkStatusLabel[r.status]}</p><p className="text-xs text-zinc-400">対象：{r.target_member_name ?? "正規プロフィールで加入"}</p>{r.status === "pending" && <button disabled={loading} onClick={() => void reviewJoinRequest(r,"cancelled")} className="mt-2 rounded-lg border border-zinc-500 p-2">申請を取り消す</button>}</div>)}</div></Card>}
    </Card>}
    <AppDialog open={!!popup&&!childOpen} title={popupTitle} busy={loading} onClose={closePopup}>
      <div ref={popupScroll} data-group-scroll onScroll={e=>{popupPositions.current[popups.length]=e.currentTarget.scrollTop;}} className="space-y-4 overflow-y-auto overscroll-contain p-4">
        {popups.length>1&&<button type="button" disabled={loading} className="min-h-11 text-sm underline" onClick={closePopup}><GroupActionIcon name="left" className="mr-1 inline-block"/>一つ戻る</button>}
        {popup?.kind==="menu"&&<div className="space-y-2"><p className="text-xs text-zinc-400">あなたの権限：{appRole==="super_user"?"スーパーユーザー":roleLabel[myRole]}</p>
          {canDeleteGroupAction&&<button className="min-h-11 w-full rounded-xl border border-zinc-600 p-3 text-left" onClick={()=>pushPopup({kind:"settings"})}>グループ設定</button>}
          {canManage&&<><button className="min-h-11 w-full rounded-xl border border-zinc-600 p-3 text-left" onClick={()=>pushPopup({kind:"add"})}>メンバー追加</button><button className="min-h-11 w-full rounded-xl border border-zinc-600 p-3 text-left" onClick={()=>pushPopup({kind:"requests"})}>加入申請</button><button className="min-h-11 w-full rounded-xl border border-zinc-600 p-3 text-left" onClick={()=>pushPopup({kind:"links"})}>連携申請</button><button className="min-h-11 w-full rounded-xl border border-zinc-600 p-3 text-left" onClick={()=>pushPopup({kind:"inactive"})}>退会済みメンバー</button></>}
          <button className="min-h-11 w-full rounded-xl border border-zinc-600 p-3 text-left" onClick={()=>setOwnerPanel(true)}>オーナー引継ぎ</button>
          {ownerState!=="other"&&<p className="text-xs text-zinc-400">{ownerState==="owner"?"オーナーは引継ぎ完了後に退会できます。":"退会前にオーナー引継ぎ状況を確認してください。"}</p>}
          <button type="button" disabled={loading||selfLeaveBusy||ownerState!=="other"} className="min-h-11 w-full rounded-xl border border-red-500 p-3 text-red-300 disabled:opacity-50" onClick={()=>{setConfirmSelfLeave(true);setSelfLeaveConfirmed(false);setSelfLeaveError("");}}>このグループを退会する</button>
        </div>}
      {popup?.kind === "settings" && <Card title="グループ設定"><div className="space-y-3">{/* TODO: グループ画像機能は将来再公開予定。現時点ではUIのみ非表示。 */}<div><p className="mb-1 text-xs text-zinc-400">グループ名</p>{editingGroupName ? <div className="space-y-2"><input className="w-full rounded-xl bg-zinc-800 p-3" value={groupNameInput} onChange={(e) => setGroupNameInput(e.target.value)} /><div className="flex gap-2"><button disabled={loading} className="w-1/2 rounded-xl bg-accent py-2 text-black disabled:bg-zinc-600" onClick={() => void saveGroupName()}>保存</button><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => { setEditingGroupName(false); setGroupNameInput(groupName); }}>キャンセル</button></div></div> : <div className="flex items-center justify-between"><p>{groupName}</p>{canDeleteGroupAction && <button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => {setGroupNameInput(groupName);setEditingGroupName(true);}}>編集</button>}</div>}</div><div><p className="mb-1 text-xs text-zinc-400">グループ説明</p>{editingDescription ? <div className="space-y-2"><textarea className="w-full rounded-xl bg-zinc-800 p-3" value={groupDescriptionInput} onChange={(e) => setGroupDescriptionInput(e.target.value)} /><div className="flex gap-2"><button disabled={loading} className="w-1/2 rounded-xl bg-accent py-2 text-black disabled:bg-zinc-600" onClick={() => void saveGroupDescription()}>保存</button><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => { setEditingDescription(false); setGroupDescriptionInput(groupDescription); }}>キャンセル</button></div></div> : <div className="flex items-center justify-between"><p className="text-sm text-zinc-300">{groupDescription || "説明なし"}</p>{canDeleteGroupAction && <button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => {setGroupDescriptionInput(groupDescription);setEditingDescription(true);}}>編集</button>}</div>}</div><div><p className="mb-1 text-xs text-zinc-400">ホームコート（任意）</p>{editingFacility ? <div className="space-y-2"><FacilitySelector facilities={facilities} value={facilityInput} onChange={setFacilityInput} groupByPrefecture error={facilityError} disabled={loading}/><div className="flex gap-2"><button disabled={loading} className="w-1/2 rounded-xl bg-accent py-2 text-black" onClick={() => void saveFacility()}>保存</button><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => {setEditingFacility(false);setFacilityInput(facilityId);}}>キャンセル</button></div></div> : <div className="flex items-center justify-between"><p className="text-sm text-zinc-300">{facilities.find((f) => f.id === facilityId)?.name ?? "未選択"}</p>{canDeleteGroupAction && <button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => {setFacilityInput(facilityId);setEditingFacility(true);}}>編集</button>}</div>}</div><div><p className="mb-1 text-xs text-zinc-400">公開設定</p>{editingVisibility ? <div className="space-y-2"><select className="w-full rounded-xl bg-zinc-800 p-3" value={visibilityInput} onChange={(e) => setVisibilityInput(e.target.value as "private" | "public")}><option value="private">非公開</option><option value="public">公開</option></select><div className="flex gap-2"><button disabled={loading} className="w-1/2 rounded-xl bg-accent py-2 text-black" onClick={() => void saveVisibility()}>保存</button><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => { setEditingVisibility(false); setVisibilityInput(visibility); }}>キャンセル</button></div></div> : <div className="flex items-center justify-between"><p className="text-sm text-zinc-300">現在: {visibility === "public" ? "公開" : "非公開"}</p>{canDeleteGroupAction && <button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => setEditingVisibility(true)}>編集</button>}</div>}</div>{canDeleteGroupAction && <button className="w-full rounded-xl border border-red-500 py-3 text-red-300" onClick={() => { setConfirmGroupDelete(true); setConfirmChecked(false); }}>グループ削除</button>}</div></Card>}


        {popup?.kind==="add"&&canManage&&<div className="space-y-3"><label htmlFor="new-member-name" className="block text-sm">メンバー名</label><input id="new-member-name" className="min-h-11 w-full rounded-xl bg-zinc-800 p-3" placeholder="メンバー名" value={name} onChange={e=>setName(e.target.value)}/><label htmlFor="new-member-email" className="block text-sm">メールアドレス（任意）</label><input id="new-member-email" type="email" autoComplete="off" className="min-h-11 w-full rounded-xl bg-zinc-800 p-3" value={newMemberEmail} onChange={e=>setNewMemberEmail(e.target.value)}/><p className="text-xs text-zinc-400">追加後、入力したアドレスで本人確認を進めます。名前だけでも登録できます。</p><button disabled={loading} className="min-h-11 w-full rounded-xl bg-accent p-3 text-black disabled:opacity-50" onClick={()=>void addMember()}>メンバー追加</button></div>}
        {popup?.kind==="inactive"&&canManage&&<div className="divide-y divide-zinc-700">{inactiveMembers.map(memberButton)}{!inactiveMembers.length&&<p className="text-sm text-zinc-400">該当なし</p>}</div>}
        {popup?.kind==="member"&&selectedMember&&(isMemberOfGroup||selectedMember.public_unlinked!==undefined)&&<>
          {selectedMember.is_active?<MemberRow key={selectedMember.id} onInviteRequest={load} initialInviteEmail={invitePrefill?.memberId===selectedMember.id?invitePrefill.email:""} ownerProtected={selectedMember.linked_auth_user_id===myAuthUserId&&ownerState!=="other"} member={selectedMember} editable={canManage&&isMemberOfGroup} currentRole={myRole} isSuperUser={isSuperUser} loading={loading} myAuthUserId={myAuthUserId} canViewRole={isMemberOfGroup} nameEditable={isMemberOfGroup&&canEditClubDisplayName(selectedMember,nameContext)} nameContext={nameContext} onFieldSaved={result=>setMembers(rows=>rows.map(row=>row.id===result.member_id&&row.club_id===id?{...row,club_display_name:result.club_display_name,public_name_confirmed:result.public_name_confirmed,field_state:result}:row))} onSelfLeave={()=>{setSelfLeaveConfirmed(false);setSelfLeaveError("");setConfirmSelfLeave(true);}} onFieldReload={async()=>{const s=getSupabaseClient();if(!s)return null;const row=(await readClubRoster(s,id)).find(row=>row.id===selectedMember.id);if(!row)return null;const next=rosterMember(row);if(next.field_state)setVisibility(next.field_state.group_visibility);setMembers(rows=>rows.map(old=>old.id===next.id?next:old));return next.field_state??null;}} onRole={changeMemberRole} onLink={linkMemberAccount} clubId={id} pending={linkRequests.some(r=>r.source_player_profile_id===selectedMember.player_profile_id&&r.status==="pending")} onDeactivate={x=>{if(!canManageTargetMember(roleCtx,x.role))return deny();setError("");setConfirmLeave(x);setConfirmChecked(false);}}/>:<><p className="break-words font-semibold">{selectedMember.display_name}</p>{canManageTargetMember(roleCtx,selectedMember.role)&&<button disabled={loading} className="min-h-11 rounded-xl border border-zinc-500 p-3" onClick={()=>void restoreMember(selectedMember)}>復帰</button>}</>}
          {!isMemberOfGroup&&selectedMember.public_unlinked&&<button disabled={loading} className="min-h-11 w-full rounded-xl bg-accent p-3 text-black" onClick={()=>void checkOwnJoin()}>本人として加入申請を確認</button>}
        </>}
      {canManage && popup?.kind === "links" && <Card title="連携申請一覧"><div className="space-y-2">{linkRequests.length === 0 ? <p className="text-sm text-zinc-400">該当なし</p> : linkRequests.map(r => <div key={r.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><Link href={`/profile/links/${r.id}`} className="underline">{r.source_display_name} / {linkStatusLabel[r.status]}</Link>{r.status === "pending" && <button disabled={loading} className="mt-2 block rounded-lg border border-zinc-500 p-2" onClick={() => void cancelLinkRequest(r)}>申請を取り消す</button>}</div>)}</div></Card>}
      {canManage && popup?.kind === "requests" && <Card title="加入申請一覧"><div className="space-y-2">{joinRequests.length === 0 ? <p className="text-sm text-zinc-400">該当なし</p> : joinRequests.map(r => <div key={r.id} className="rounded-xl bg-zinc-800 p-3"><p className="font-semibold">{r.requester_display_name}</p><p className="text-xs text-zinc-300">{linkStatusLabel[r.status]} / 希望メンバー：{r.target_member_name ?? "正規プロフィールで加入"}</p>{r.target_club_member_id && <p className="text-xs text-amber-200">{r.consent_at ? "本人の統合同意を記録済み" : "旧申請：本人の同意を再確認して再申請が必要です"}</p>}<p className="text-xs text-zinc-300">メッセージ：{r.message ?? "なし"}</p>{r.status === "pending" && <div className="mt-2 flex gap-2"><button disabled={loading} className="w-1/2 rounded-lg bg-accent py-2 text-black" onClick={() => void reviewJoinRequest(r,"approved")}>承認</button><button disabled={loading} className="w-1/2 rounded-lg border border-zinc-500 py-2" onClick={() => void reviewJoinRequest(r,"rejected")}>拒否</button></div>}</div>)}</div></Card>}


        {popup?.kind==="events"&&isMemberOfGroup&&eventRows(overviewEvents)}
        {popup?.kind==="allStats"&&isMemberOfGroup&&<div className="space-y-2">{statRows.map(statButton)}</div>}
        {popup?.kind==="points"&&isMemberOfGroup&&<div className="space-y-3 text-sm"><p>総合ptは勝率70%・出場割合20%・得失ゲーム差10%です。</p><p>出場割合はグループ内の最多試合数、得失ゲーム差は正の最大差に対する割合で評価します。負の差は0として扱います。</p><p>勝点は勝利3点・引分1点で、総合ptとは別の指標です。3試合未満は参考記録です。</p></div>}
        {popup?.kind==="statDetail"&&isMemberOfGroup&&detailStat&&<div className="space-y-2 text-sm">
          <p className="break-words font-semibold">{detailStat.name??detailStat.pairName}{detailStat.isReference?"（参考記録・3試合未満）":""}</p>
          {statTab==="開催履歴"?<><p>開催日 {new Date(detailStat.date).toLocaleDateString("ja-JP")}</p><p>試合数 {detailStat.matchCount} / 参加人数 {detailStat.participantCount}</p><button className="min-h-11 text-sm underline" onClick={()=>openEvent(`/events/${detailStat.id}`)}>開催詳細へ<GroupActionIcon name="right" className="inline-block"/></button></>:<><p>試合 {detailStat.matches} / {formatRecord(detailStat.wins,detailStat.losses,detailStat.draws)} / 勝率 {detailStat.rate.toFixed(1)}%</p><p>得点 {detailStat.scored} / 失点 {detailStat.conceded} / 得失点差 {detailStat.diff}</p>{statTab==="個人"?<><p>1試合平均得点 {detailStat.avgScored.toFixed(1)} / 平均失点 {detailStat.avgConceded.toFixed(1)}</p><p>総合pt {detailStat.totalPoint.toFixed(1)} / 勝点 {detailStat.matchPoints}</p><button className="min-h-11 text-xs underline" onClick={()=>pushPopup({kind:"points"})}><GroupActionIcon name="info" className="mr-1 inline-block"/>ptの説明</button></>:<p>1試合平均得失点差 {detailStat.avgDiff.toFixed(1)} / 勝点 {detailStat.matchPoints}</p>}</>}
        </div>}
        {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}{message&&<p role="status" className="text-sm text-emerald-400">{message}</p>}
      </div>
    </AppDialog>
    {isMemberOfGroup&&myMemberId&&<ClubOwnerTransfer key={`${id}:${myAuthUserId}`} clubId={id} panelOpen={ownerPanel} onPanelClose={()=>setOwnerPanel(false)} onDetailOpenChange={setOwnerDetail} detailDismiss={ownerDismiss} onOwnerState={setOwnerState} onGroupRefresh={refreshGroup}/>}
      {joinDialogOpen && !isMemberOfGroup && visibility === "public" && <PublicClubJoinDialog key={id}
        context={{ clubId: id, userId: myAuthUserId, visibility, isMember: isMemberOfGroup, hasPendingRequest: !!myPendingRequest || joinSubmitted }}
        candidates={members.filter(member => member.public_unlinked === true).map(member => ({ reference: member.id, display_name: member.display_name, is_unlinked: true }))}
        onClose={() => setJoinDialogOpen(false)}
        onSubmitted={() => {
          setJoinDialogOpen(false); setJoinSubmitted(true); setMessage("加入申請を送信しました");
          void checkOwnJoin().catch(() => { setError("申請は送信済みですが、申請状況を取得できません。再送せずページを再読み込みしてください"); setLoading(false); });
        }} />}
      <AppDialog open={confirmSelfLeave} title="グループを退会しますか？" busy={selfLeaveBusy}
        onClose={() => { setConfirmSelfLeave(false); setSelfLeaveConfirmed(false); setSelfLeaveError(""); }}>
        <div className="space-y-4 overflow-y-auto p-4">
          <p className="text-sm text-zinc-200">「{groupName}」の在籍一覧から外れます。過去の試合・戦績と本人プロフィール、他のグループの所属は残ります。</p>
          <p className="text-xs text-zinc-400">オーナーは引継ぎを完了してから退会できます。最後のメイン管理者も退会できません。</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selfLeaveConfirmed} disabled={selfLeaveBusy}
              onChange={(event) => setSelfLeaveConfirmed(event.target.checked)} />
            内容を確認しました
          </label>
          {selfLeaveError && <p role="alert" className="text-sm text-red-300">{selfLeaveError}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={selfLeaveBusy} className="min-h-11 rounded-xl border border-zinc-500 p-3"
              onClick={() => { setConfirmSelfLeave(false); setSelfLeaveConfirmed(false); setSelfLeaveError(""); }}>キャンセル</button>
            <button type="button" disabled={selfLeaveBusy || !selfLeaveConfirmed || loading}
              className="min-h-11 rounded-xl bg-red-600 p-3 text-white disabled:opacity-50"
              onClick={() => void leaveMyClub()}>{selfLeaveBusy ? "退会処理中..." : "退会する"}</button>
          </div>
        </div>
      </AppDialog>

      <AppDialog open={confirmGroupDelete} title="グループを削除しますか？" busy={loading} onClose={() => { setConfirmGroupDelete(false); setConfirmChecked(false); }}>
        <div className="space-y-4 overflow-y-auto p-4">
          <p className="break-words text-sm">「{groupName}」をグループ一覧から非表示にします。グループと過去の試合データ自体は残ります。</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmChecked} disabled={loading} onChange={event => setConfirmChecked(event.target.checked)} />内容を確認しました</label>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={loading} className="rounded-lg border border-zinc-500 p-3" onClick={() => { setConfirmGroupDelete(false); setConfirmChecked(false); }}>キャンセル</button>
            <button type="button" disabled={loading || !confirmChecked} className="rounded-lg bg-red-600 p-3 text-white disabled:opacity-50" onClick={() => void doDeleteGroup()}>{loading ? "削除中..." : "削除する"}</button>
          </div>
        </div>
      </AppDialog>
      <AppDialog open={!!confirmLeave} title="メンバーを非表示／退会にしますか？" busy={loading} onClose={()=>{setConfirmLeave(null);setConfirmChecked(false);}}>
        <div className="space-y-4 overflow-y-auto p-4">
          <p className="break-words">{confirmLeave?.display_name}さんを在籍一覧から外します。アカウントや過去の試合履歴は残り、後から復帰できます。</p>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={confirmChecked} disabled={loading} onChange={e=>setConfirmChecked(e.target.checked)}/>内容を確認しました</label>
          {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="grid grid-cols-2 gap-2"><button disabled={loading} className="min-h-11 rounded-xl border border-zinc-500 p-3" onClick={()=>{setConfirmLeave(null);setConfirmChecked(false);}}>キャンセル</button><button disabled={loading||!confirmChecked} className="min-h-11 rounded-xl bg-red-600 p-3 text-white disabled:opacity-50" onClick={()=>void doDeactivate()}>非表示／退会する</button></div>
        </div>
      </AppDialog>
  </main>;
}

function MemberRow({ member, onInviteRequest, initialInviteEmail, ownerProtected, editable, currentRole, isSuperUser, loading, myAuthUserId, canViewRole, nameEditable, nameContext, onFieldSaved, onFieldReload, onSelfLeave, onRole, onLink, clubId, pending, onDeactivate }: { member: Member; onInviteRequest:()=>Promise<void>; initialInviteEmail:string; ownerProtected: boolean; editable: boolean; currentRole: Role; isSuperUser: boolean; loading: boolean; myAuthUserId: string | null; canViewRole: boolean; nameEditable: boolean; nameContext:ClubNameContext; onFieldSaved:(state:MemberFieldState)=>void; onFieldReload:()=>Promise<MemberFieldState|null>; onSelfLeave:()=>void; onRole: (m: Member, role: Role) => Promise<boolean>; onLink: (m: Member, account: AccountCandidate) => Promise<void>; clubId: string; pending: boolean; onDeactivate: (m: Member) => void; }) {
  const [editing, setEditing] = useState(false);
  const [r, setR] = useState<Role>(member.role);
  const [roleEditing,setRoleEditing]=useState(false),[roleSaved,setRoleSaved]=useState(false);
  const roleTimer=useRef<ReturnType<typeof setTimeout>|null>(null),roleInFlight=useRef(false),rowAlive=useRef(true);
  useEffect(()=>{rowAlive.current=true;return()=>{rowAlive.current=false;if(roleTimer.current)clearTimeout(roleTimer.current);};},[]);
  const selectRole=async(role:Role)=>{if(roleInFlight.current||loading)return;setR(role);if(role===member.role){setRoleEditing(false);return;}roleInFlight.current=true;setRoleSaved(false);try{if(await onRole(member,role)){if(!rowAlive.current)return;setRoleEditing(false);setRoleSaved(true);roleTimer.current=setTimeout(()=>setRoleSaved(false),2500);}}finally{roleInFlight.current=false;}};
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<AccountCandidate[]>([]);
  const [selected, setSelected] = useState<AccountCandidate | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searched, setSearched] = useState(false);
  const isLinkedSelf = !!myAuthUserId && member.linked_auth_user_id === myAuthUserId;
  const cannotEdit = !editable || !canManageTargetMember({ isSuperUser, myRole: currentRole }, member.role);
  const hideRoleAndOps = !canViewRole;
  useEffect(() => { if (!editing) setR(member.role); }, [member.role, editing]);
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
      <p className="text-xs text-zinc-400">在籍 / {member.linked_auth_user_id || member.public_unlinked===false ? "連携済み" : pending ? "承認待ち" : "未連携"}</p>
      {editing ? (
        <div className="space-y-2">
          <p className="break-words font-semibold">{groupMemberLabel(member)}</p>
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
          <div className="flex min-w-0 flex-wrap items-center gap-2"><p className="min-w-0 break-words font-semibold">{member.public_unlinked !== undefined ? member.display_name : groupMemberLabel(member)}</p>{isLinkedSelf && <span className="app-badge badge-self">あなた</span>}{canViewRole && <span className="app-badge badge-role">{roleLabel[member.role]}</span>}</div>
          {!cannotEdit && !hideRoleAndOps && !member.linked_auth_user_id && <div className="flex gap-2"><button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => setEditing(true)}>従来の本人連携検索</button></div>}
        </div>
      )}
      {!cannotEdit&&!hideRoleAndOps&&!member.linked_auth_user_id&&!pending&&<ClubInvitationManager key={`${myAuthUserId}:${clubId}:${member.id}`} clubId={clubId} memberId={member.id} initialEmail={initialInviteEmail} onRequested={onInviteRequest}/>}
      {nameEditable && !hideRoleAndOps && <ClubMemberFields member={member} context={nameContext} state={member.field_state??null} onSaved={onFieldSaved} onReload={onFieldReload}/>}
      {!cannotEdit&&!hideRoleAndOps&&<div className="mt-3 flex min-h-11 items-center justify-between gap-2"><span className="text-xs text-zinc-400">役職</span>{roleEditing?<select aria-label="役職" disabled={loading||ownerProtected} className="min-h-11 min-w-0 rounded-lg bg-zinc-700 p-2" value={r} onChange={e=>void selectRole(e.target.value as Role)}><option value="main_admin" disabled={!canManageTargetMember({isSuperUser,myRole:currentRole},"main_admin")}>メイン管理者</option><option value="sub_admin">サブ管理者</option><option value="member">メンバー</option></select>:<span className="flex items-center gap-2">{roleLabel[member.role]}{roleSaved&&<span role="status" aria-label="役職を保存しました" className="text-emerald-500"><GroupActionIcon name="check"/></span>}<button type="button" aria-label="役職を編集" disabled={loading||ownerProtected} className="flex min-h-11 min-w-11 items-center justify-center disabled:opacity-40" onClick={()=>{setR(member.role);setRoleEditing(true);}}><GroupActionIcon name="pencil"/></button></span>}</div>}
      {!nameEditable&&!hideRoleAndOps&&member.linked_auth_user_id&&member.field_state&&<p className="mt-2 text-sm text-zinc-400">未所属者への表示：{member.field_state.public_name_enabled?"公開":"非公開"}</p>}
      {ownerProtected&&!hideRoleAndOps&&<p className="mt-2 text-xs text-zinc-400">オーナーの引継ぎ完了を確認するまで降格・退会はできません。</p>}
      {!hideRoleAndOps&&(isLinkedSelf||!cannotEdit)&&<div className="mt-6 border-t border-zinc-700 pt-3"><button disabled={loading||ownerProtected} className="min-h-11 w-full rounded-lg text-sm text-red-300 disabled:opacity-40" onClick={()=>isLinkedSelf?onSelfLeave():onDeactivate(member)}>{isLinkedSelf?"このグループを退会する":"非表示／退会"}</button></div>}
    </div>
  );
}
