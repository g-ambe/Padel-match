"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { profileErrorMessage } from "@/lib/player-profiles";
import { linkStatusLabel, profileLinkRpc, type ProfileLinkRequest } from "@/lib/profile-links";

export function ProfileLinkRequests() {
  const [rows, setRows] = useState<ProfileLinkRequest[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const s = getSupabaseClient();
    if (s) void profileLinkRpc<ProfileLinkRequest[]>(s, "list_player_profile_link_requests", { p_club_id: null })
      .then(data => { if (active) setRows(data); }).catch(cause => { if (active) setError(profileErrorMessage(cause)); });
    return () => { active = false; };
  }, []);
  return <div className="space-y-2 text-sm"><p className="font-semibold">選手プロフィールの連携申請</p>{error && <p role="alert" className="text-xs text-red-400">{error}</p>}{rows.length === 0 && !error && <p className="text-xs text-zinc-400">連携申請はありません</p>}{rows.map(r => <Link key={r.id} href={`/profile/links/${r.id}`} className="block rounded-xl bg-zinc-800 p-3"><p>{r.club_name} / {r.source_display_name}</p><p className="mt-1 text-xs text-amber-200">{linkStatusLabel[r.status]}{r.status === "pending" ? "：内容を確認してください" : ""}</p></Link>)}</div>;
}
