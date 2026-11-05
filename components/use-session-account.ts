"use client";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";

// 画面の表示用。書込み時のgetUser確認とDB側の既存権限判定は各処理に残す。
export function useSessionAccount() {
  const [account, setAccount] = useState<{ ready: boolean; id: string | null }>({ ready: false, id: null });
  useEffect(() => {
    let active = true;
    const s = getSupabaseClient();
    if (!s) { setAccount({ ready: true, id: null }); return; }
    const { data } = s.auth.onAuthStateChange((_event, session) => { if (active) setAccount({ ready: true, id: session?.user.id ?? null }); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  return account;
}
