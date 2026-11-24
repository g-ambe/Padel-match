"use client";
import { useEffect, useRef, useState } from "react";
import { ProfileAvatar } from "./profile-avatar";
import { getSupabaseClient } from "@/lib/supabase";
import { readMyMemberships } from "@/lib/group-read";
import { fetchGroupAvatar, GroupAvatarSession, type GroupAvatar } from "@/lib/group-member-avatars";

export function useGroupAvatarSession(club: string, account: string | null, enabled: boolean, roster: string) {
  const [session, setSession] = useState<GroupAvatarSession | null>(null);
  const [visit, setVisit] = useState(0);
  const current = useRef<GroupAvatarSession | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const clear = () => { generation.current++; current.current?.dispose(); current.current = null; setSession(null); };
    const visibility = () => { clear(); if (document.visibilityState === "visible") setVisit(v => v + 1); };
    const resume = () => { clear(); if (document.visibilityState === "visible") setVisit(v => v + 1); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", resume);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", clear); window.removeEventListener("pageshow", resume); clear(); };
  }, []);
  useEffect(() => {
    let stopped = false;
    const revision = ++generation.current;
    current.current?.dispose(); current.current = null; setSession(null);
    const db = getSupabaseClient();
    if (enabled && account && db && document.visibilityState === "visible") {
      void (async () => {
        const auth = await db.auth.getUser();
        if (auth.error || auth.data.user?.id !== account) return;
        const memberships = await readMyMemberships(db);
        if (stopped || revision !== generation.current || document.visibilityState !== "visible"
          || !memberships.some(m => m.club_id === club && m.is_active)) return;
        const next = new GroupAvatarSession(async (member, signal) => {
          const { data } = await db.auth.getSession();
          if (signal.aborted || data.session?.user.id !== account || !data.session.access_token) throw new Error("ログイン情報を確認してください");
          return fetchGroupAvatar(club, member, data.session.access_token, signal);
        });
        current.current = next; setSession(next);
      })().catch(() => { /* 所属を確認できなければ標準アイコンのまま。 */ });
    }
    return () => { stopped = true; generation.current++; current.current?.dispose(); current.current = null; };
  }, [club, account, enabled, roster, visit]);
  return session;
}

function StandardMemberIcon() {
  return <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-400"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg></span>;
}
export function GroupMemberAvatar({ member, session }: {
  member: { id: string; is_active: boolean; player_active: boolean; linked_auth_user_id: string | null };
  session: GroupAvatarSession | null;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const [intersection, setIntersection] = useState<{ session: GroupAvatarSession; visible: boolean } | null>(null);
  const [image, setImage] = useState<{ session: GroupAvatarSession; value: GroupAvatar } | null>(null);
  const eligible = member.is_active && member.player_active && !!member.linked_auth_user_id;
  useEffect(() => {
    const target = node.current;
    if (!target || !eligible || !session || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => setIntersection({ session, visible: entries.some(entry => entry.isIntersecting) }), { rootMargin: "0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [session, eligible]);
  useEffect(() => {
    setImage(null);
    if (!session || !eligible || intersection?.session !== session || !intersection.visible) return;
    return session.watch(member.id, value => setImage(value ? { session, value } : null));
  }, [session, eligible, intersection, member.id]);
  const photo = eligible && session === image?.session ? image.value : null;
  return <span ref={node} className="block h-9 w-9 shrink-0" aria-hidden="true">
    {photo ? <ProfileAvatar image={photo.url} name="" position={photo.position} className="h-9 w-9" onImageError={() => setImage(null)}/> : <StandardMemberIcon/>}
  </span>;
}
