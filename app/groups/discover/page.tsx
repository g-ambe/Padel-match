"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

type Group = { id: string; name: string; description: string | null; is_active: boolean; visibility: "private" | "public" };

export default function DiscoverGroupsPage() {
  const router = useRouter();
  const [publicGroups, setPublicGroups] = useState<Group[]>([]);

  useEffect(() => {
    const load = async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) return router.replace("/");

      const { data: linkedProfiles } = await supabase.from("player_profiles").select("id").eq("linked_auth_user_id", userId);
      const linkedProfileIds = (linkedProfiles ?? []).map((p: any) => p.id).filter(Boolean);
      let memberRows: any[] = [];
      if (linkedProfileIds.length) {
        const { data } = await supabase.from("club_members").select("club_id").in("player_profile_id", linkedProfileIds).eq("is_active", true);
        memberRows = data ?? [];
      }
      if (!memberRows.length) {
        const { data } = await supabase.from("club_members").select("club_id").eq("profile_id", userId).eq("is_active", true);
        memberRows = data ?? [];
      }
      const memberClubIds = new Set((memberRows ?? []).map((r: any) => r.club_id).filter(Boolean));
      const { data: publicClubs } = await supabase.from("clubs").select("id,name,description,is_active,visibility").eq("is_active", true).eq("visibility", "public");
      setPublicGroups(((publicClubs ?? []) as Group[]).filter((g) => !memberClubIds.has(g.id)));
    };
    void load();
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">グループを探す</h1>
      <Card title="公開グループ">
        <div className="space-y-2">
          {publicGroups.length === 0 ? <p className="rounded-xl bg-zinc-800 p-3 text-sm text-zinc-300">公開グループはありません</p> : publicGroups.map((g) => (
            <Link key={g.id} href={`/groups/${g.id}`} className="block rounded-xl bg-zinc-800 p-3">
              <p className="font-semibold">{g.name}</p>
              <p className="text-xs text-zinc-300">{g.description || "説明なし"}</p>
            </Link>
          ))}
        </div>
      </Card>
    </main>
  );
}
