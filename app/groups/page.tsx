"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

type Group = { id: string; name: string; description: string | null; is_active: boolean; visibility: "private" | "public" };

export default function GroupsPage() {
  const router = useRouter();
  const [memberGroups, setMemberGroups] = useState<Group[]>([]);

  const load = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) { router.replace("/"); return; }

    const { data: adminRow } = await supabase.from("app_admins").select("id").eq("profile_id", userId).eq("is_active", true).maybeSingle();
    const isSuperUser = !!adminRow;

    if (isSuperUser) {
      const { data } = await supabase.from("clubs").select("id,name,description,is_active,visibility").order("created_at", { ascending: false });
      const all = (data ?? []) as Group[];
      const { data: linkedProfilesForSuper } = await supabase
        .from("player_profiles")
        .select("id")
        .eq("linked_auth_user_id", userId);
      const linkedProfileIdsForSuper = (linkedProfilesForSuper ?? []).map((p: any) => p.id).filter(Boolean);
      const { data: memberRowsForSuper } = linkedProfileIdsForSuper.length
        ? await supabase
            .from("club_members")
            .select("club_id")
            .in("player_profile_id", linkedProfileIdsForSuper)
            .eq("is_active", true)
        : await supabase
            .from("club_members")
            .select("club_id")
            .eq("profile_id", userId)
            .eq("is_active", true);
      const memberClubIdSet = new Set((memberRowsForSuper ?? []).map((r: any) => r.club_id).filter(Boolean));
      const memberships = all.filter((g) => g.is_active && memberClubIdSet.has(g.id));
      const publics = all.filter((g) => g.is_active && g.visibility === "public" && !memberClubIdSet.has(g.id));
      setMemberGroups(memberships);
      return;
    }

    const { data: linkedProfiles } = await supabase
      .from("player_profiles")
      .select("id")
      .eq("linked_auth_user_id", userId);

    const linkedProfileIds = (linkedProfiles ?? []).map((p: any) => p.id).filter(Boolean);

    let memberRows: any[] = [];
    if (linkedProfileIds.length) {
      const { data } = await supabase
        .from("club_members")
        .select("clubs(id,name,description,is_active,visibility)")
        .in("player_profile_id", linkedProfileIds)
        .eq("is_active", true)
        .eq("clubs.is_active", true);
      memberRows = data ?? [];
      console.log("[groups] current auth user id:", userId);
      console.log("[groups] matched player_profile ids:", linkedProfileIds);
      console.log("[groups] loaded club_members count:", memberRows.length);
    }

    if (!memberRows.length) {
      const { data } = await supabase
        .from("club_members")
        .select("clubs(id,name,description,is_active,visibility)")
        .eq("profile_id", userId)
        .eq("is_active", true)
        .eq("clubs.is_active", true);
      memberRows = data ?? [];
    }


    const ownedRows: Group[] = memberRows.map((r: any) => r.clubs).filter(Boolean);
    const memberMap = new Map<string, Group>();
    for (const g of ownedRows) memberMap.set(g.id, g);
    const memberRowsUnique = [...memberMap.values()];

    console.log("[groups] loaded member groups count:", memberRowsUnique.length);
    setMemberGroups(memberRowsUnique);
  };

  useEffect(() => { void load(); }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">所属グループ閲覧・設定</h1>
      <Card title="所属グループ">
        <div className="space-y-2">
          {memberGroups.length === 0 ? <p className="rounded-xl bg-zinc-800 p-3 text-sm text-zinc-300">所属グループがありません</p> : memberGroups.map((g) => (
            <Link key={g.id} href={`/groups/${g.id}`} className="block rounded-xl bg-zinc-800 p-3">
              <p className="font-semibold">{g.name}{!g.is_active ? "（非表示）" : ""}</p>
              <p className="text-xs text-zinc-300">{g.description || "説明なし"}</p>
            </Link>
          ))}
        </div>
      </Card>
    </main>
  );
}
