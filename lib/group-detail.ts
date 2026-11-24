import type { SupabaseClient } from "@supabase/supabase-js";
export type GroupTab = "概要" | "メンバー" | "戦績";
export type GroupStatTab = "個人" | "ペア" | "開催履歴";
export type GroupEvent = { id: string; name: string; date: string; status: string; href: string };
export const groupTabs = (internal: boolean): GroupTab[] => internal ? ["概要", "メンバー", "戦績"] : ["概要", "メンバー"];
export const groupPreview = <T,>(rows: readonly T[]) => ({ visible: rows.slice(0, 3), hasMore: rows.length > 3 });
export const activeGroupMembership = <T extends { club_id: string; is_active: boolean; status: string }>(rows: T[], clubId: string) => rows.find(m => m.club_id === clubId && m.is_active && m.status === "active");
// This reads only minimal hosted-event metadata, and only after membership is established.
// There is no safe public-event/count RPC in the current contract: do not query internal tables for visitors.
export async function readGroupEvents(db: SupabaseClient, clubId: string, internal: boolean): Promise<GroupEvent[]> {
  if (!internal) return [];
  const all=async (table:"events"|"official_events",columns:string)=>{
    const rows: any[]=[];
    for(let start=0;;start+=500){
      const page=await db.from(table).select(columns).eq("club_id",clubId).eq("is_deleted",false).order("created_at",{ascending:false}).order("id").range(start,start+499);
      if(page.error||!Array.isArray(page.data))throw new Error("開催情報を取得できませんでした。再読み込みしてください");
      rows.push(...page.data);if(page.data.length<500)return rows;
    }
  };
  const [ordinary, official]=await Promise.all([all("events","id,name,created_at,status,event_mode"),all("official_events","id,title,created_at,status")]);
  return [...ordinary.map(e => ({ id:e.id, name:e.name, date:e.created_at, status:e.status, href:`/${e.event_mode === "team" ? "team-matches" : "events"}/${e.id}` })),
    ...official.map(e => ({ id:e.id, name:e.title, date:e.created_at, status:e.status, href:`/official-matches/${e.id}` }))]
    .sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
