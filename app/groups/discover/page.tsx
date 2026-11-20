"use client";
import { readMyMemberships } from "@/lib/group-read";

import { GroupEntryLink, useGroupOriginRestore } from "@/components/group-entry-link";
import { useSessionAccount } from "@/components/use-session-account";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

type Group = { id: string; name: string; description: string | null; is_active: boolean; visibility: "private" | "public" };

export default function DiscoverGroupsPage() {
  const router = useRouter(),account=useSessionAccount();
  const [loaded,setLoaded]=useState(false);
  useGroupOriginRestore(account.id,loaded);
  const [publicGroups, setPublicGroups] = useState<Group[]>([]);
  const [error,setError]=useState("");

  useEffect(() => {
    const load = async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) return router.replace("/");

      const memberRows = (await readMyMemberships(supabase)).filter(m=>m.is_active);
      const memberClubIds = new Set(memberRows.map(m=>m.club_id));
      const { data: publicClubs } = await supabase.from("clubs").select("id,name,description,is_active,visibility").eq("is_active", true).eq("visibility", "public");
      setLoaded(true);setPublicGroups(((publicClubs ?? []) as Group[]).filter((g) => !memberClubIds.has(g.id)));
    };
    void load().catch(()=>setError("グループを取得できませんでした。再度読み込んでください"));
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">グループを探す</h1>
      {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
      <Card title="公開グループ">
        <div className="space-y-2">
          {publicGroups.length === 0 ? <p className="rounded-xl bg-zinc-800 p-3 text-sm text-zinc-300">公開グループはありません</p> : publicGroups.map((g) => (
            <GroupEntryLink origin="discover" groupId={g.id} key={g.id} className="block rounded-xl bg-zinc-800 p-3">
              <p className="font-semibold">{g.name}</p>
              <p className="text-xs text-zinc-300">{g.description || "説明なし"}</p>
            </GroupEntryLink>
          ))}
        </div>
      </Card>
    </main>
  );
}
