import type { SupabaseClient } from "@supabase/supabase-js";
import { readMyMemberships } from "./group-read";
export type MemberGroup = { id: string; name: string; description: string | null; is_active: boolean; visibility: "private" | "public" };
export async function readMemberGroups(supabase: SupabaseClient) {
 const {data,error}=await supabase.auth.getUser();
 if(error)throw new Error("所属グループを取得できませんでした。再読み込みしてください。");
 if(!data.user)return{uid:"",groups:[] as MemberGroup[]};
 const ids=[...new Set((await readMyMemberships(supabase)).filter(m=>m.is_active).map(m=>m.club_id))];
 if(!ids.length)return{uid:data.user.id,groups:[] as MemberGroup[]};
 const result=await supabase.from("clubs").select("id,name,description,is_active,visibility").in("id",ids).eq("is_active",true);
 if(result.error||!Array.isArray(result.data))throw new Error("所属グループを取得できませんでした。再読み込みしてください。");
 return{uid:data.user.id,groups:result.data as MemberGroup[]};
}
