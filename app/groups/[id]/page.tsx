"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

type Role = "main_admin" | "sub_admin" | "member";
type Member = { id: string; profile_id: string | null; player_profile_id: string; display_name: string; linked_auth_user_id: string | null; is_active: boolean; role: Role };

const roleLabel: Record<Role, string> = { main_admin: "メイン管理者", sub_admin: "サブ管理者", member: "メンバー" };

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState("メンバー管理");
  const [groupName, setGroupName] = useState("グループ");
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
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

  const canManage = isSuperUser || myRole === "main_admin" || myRole === "sub_admin";
  const canDeleteGroup = isSuperUser || myRole === "main_admin";

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

    const { data: group } = await s.from("clubs").select("name,is_active").eq("id", id).maybeSingle();
    if (!group || (!group.is_active && !superUser)) {
      setError("この操作を行う権限がありません");
      setLoading(false);
      return;
    }
    setGroupName(group.name ?? "グループ");
    setGroupNameInput(group.name ?? "");

    const { data } = await s
      .from("club_members")
      .select("id,profile_id,player_profile_id,is_active,role,player_profiles(display_name,linked_auth_user_id)")
      .eq("club_id", id)
      .order("created_at", { ascending: true });

    const rows: Member[] = (data ?? []).map((r: any) => ({
      id: r.id,
      profile_id: r.profile_id,
      player_profile_id: r.player_profile_id,
      display_name: r.player_profiles?.display_name ?? "名称未設定",
      linked_auth_user_id: r.player_profiles?.linked_auth_user_id ?? null,
      is_active: r.is_active !== false,
      role: (r.role ?? "member") as Role
    }));
    setMembers(rows);
    const me = rows.find((r) => r.profile_id === uid && r.is_active);
    setMyProfileId(uid);
    setMyRole(me?.role ?? "member");
    setLoading(false);
  };

  useEffect(() => { void load(); }, [id]);

  const activeMainAdmins = useMemo(() => members.filter((m) => m.is_active && m.role === "main_admin").length, [members]);

  const deny = () => setError("この操作を行う権限がありません");

  const addMember = async () => {
    if (!canManage) return deny();
    const s = getSupabaseClient();
    if (!s || !id) return;
    const trimmed = name.trim();
    if (!trimmed) return setError("メンバー名を入力してください");
    const dup = members.some((m) => m.is_active && m.display_name.trim().toLowerCase() === trimmed.toLowerCase());
    if (dup) return setError("同じ名前のメンバーが既にいます");

    setLoading(true);
    setError("");
    const { data: pp, error: pe } = await s.from("player_profiles").insert({ display_name: trimmed, linked_auth_user_id: linkId.trim() || null, is_active: true }).select("id").single();
    if (pe || !pp?.id) { setError("メンバー追加に失敗しました"); setLoading(false); return; }
    await s.from("club_members").insert({ club_id: id, player_profile_id: pp.id, role: "member", is_active: true });
    setName(""); setLinkId(""); setMessage("更新しました"); setLoading(false);
    await load();
  };

  const updateMember = async (m: Member, newName: string, newLink: string, newRole: Role) => {
    const s = getSupabaseClient(); if (!s) return;
    if (!canManage) return deny();
    if (!isSuperUser && myRole === "sub_admin" && (m.role === "main_admin")) return deny();
    if (!isSuperUser && myRole === "sub_admin" && newRole === "main_admin") return deny();
    if (!isSuperUser && myRole === "main_admin" && m.linked_auth_user_id && m.role === "main_admin") return deny();

    const trimmed = newName.trim();
    if (!trimmed) return setError("メンバー名を入力してください");
    const dup = members.some((x) => x.id !== m.id && x.is_active && x.display_name.trim().toLowerCase() === trimmed.toLowerCase());
    if (dup) return setError("同じ名前のメンバーが既にいます");

    if ((m.role === "main_admin" && newRole !== "main_admin") || (m.role !== "main_admin" && newRole === "main_admin")) {
      if (!confirm("ロール変更を実行しますか？")) return;
    }

    setLoading(true);
    await s.from("player_profiles").update({ display_name: trimmed, linked_auth_user_id: newLink.trim() || null }).eq("id", m.player_profile_id);
    await s.from("club_members").update({ role: newRole }).eq("id", m.id);
    setMessage("更新しました");
    setLoading(false);
    await load();
  };

  const doDeactivate = async () => {
    const target = confirmLeave;
    if (!target) return;
    const s = getSupabaseClient(); if (!s) return;
    if (!canManage) return deny();
    if (target.role === "main_admin" && activeMainAdmins <= 1) return setError("メイン管理者は最低1人必要です");
    setLoading(true);
    await s.from("club_members").update({ is_active: false }).eq("id", target.id);
    setConfirmLeave(null); setConfirmChecked(false); setMessage("反映しました"); setLoading(false);
    await load();
  };

  const doDeleteGroup = async () => {
    if (!canDeleteGroup) return deny();
    const s = getSupabaseClient(); if (!s || !id) return;
    setLoading(true);
    await s.from("clubs").update({ is_active: false }).eq("id", id);
    setConfirmGroupDelete(false); setConfirmChecked(false); setMessage("反映しました"); setLoading(false);
    await load();
  };

  const saveGroupName = async () => {
    if (!(isSuperUser || myRole === "main_admin")) return deny();
    const s = getSupabaseClient();
    if (!s || !id) return;
    const trimmed = groupNameInput.trim();
    if (!trimmed) return setError("グループ名を入力してください");
    if (trimmed === groupName) {
      setEditingGroupName(false);
      return;
    }
    setLoading(true);
    setError("");
    const { error: updateError } = await s.from("clubs").update({ name: trimmed }).eq("id", id);
    if (updateError) {
      setError("グループ名の更新に失敗しました");
      setLoading(false);
      return;
    }
    setMessage("グループ名を更新しました");
    setEditingGroupName(false);
    setLoading(false);
    await load();
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">{groupName} 設定</h1><Link href="/groups" className="rounded-lg border border-zinc-600 px-3 py-2 text-sm">戻る</Link></div>
      <Card title="グループ名">
        {editingGroupName ? (
          <div className="space-y-2">
            <input className="w-full rounded-xl bg-zinc-800 p-3" value={groupNameInput} onChange={(e) => setGroupNameInput(e.target.value)} />
            <div className="flex gap-2">
              <button disabled={loading} className="w-1/2 rounded-xl bg-accent py-2 text-black disabled:bg-zinc-600" onClick={() => void saveGroupName()}>保存</button>
              <button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={() => { setEditingGroupName(false); setGroupNameInput(groupName); }}>キャンセル</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-200">{groupName}</p>
            {(isSuperUser || myRole === "main_admin") && <button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => setEditingGroupName(true)}>編集</button>}
          </div>
        )}
      </Card>
      <p className="text-sm text-zinc-300">あなたの権限：{isSuperUser ? "スーパーユーザー" : roleLabel[myRole]}</p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {message && <p className="text-sm text-emerald-400">{message}</p>}
      {loading && <p className="text-xs text-zinc-400">処理中...</p>}

      <div className="grid grid-cols-3 gap-2 text-xs">{["メンバー管理","グループ戦績","個人ランキング","ペアランキング","イベント履歴"].map((t) => <button key={t} className={`rounded-lg px-2 py-2 ${tab===t?"bg-accent text-black":"bg-zinc-800 text-zinc-200"}`} onClick={() => setTab(t)}>{t}</button>)}</div>

      {tab === "メンバー管理" ? <Card title="メンバー管理"><div className="space-y-2">{canManage && <><input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="メンバー名" value={name} onChange={(e)=>setName(e.target.value)} /><input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="auth user id（任意）" value={linkId} onChange={(e)=>setLinkId(e.target.value)} /><button disabled={loading} className="w-full rounded-xl bg-accent py-3 font-semibold text-black disabled:bg-zinc-600" onClick={addMember}>定常メンバー追加</button></>}
      <div className="space-y-2">{members.map((m)=><MemberRow key={m.id} member={m} editable={canManage} currentRole={myRole} isSuperUser={isSuperUser} loading={loading} onSave={updateMember} onDeactivate={(x)=>{if(!canManage)return deny(); setConfirmLeave(x); setConfirmChecked(false);}} />)}</div>
      </div></Card> : <Card title={tab}><p className="text-sm text-zinc-300">この機能は次タスクで実装予定です。</p></Card>}

      {canDeleteGroup && <Card title="グループ操作"><button className="w-full rounded-xl border border-red-500 py-3 text-red-300" onClick={()=>{setConfirmGroupDelete(true); setConfirmChecked(false);}}>グループ削除</button></Card>}

      {confirmLeave && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-sm rounded-2xl bg-card p-4"><p className="font-semibold">本当に非表示/退会にしますか？</p><p className="mt-2 text-sm text-zinc-300">この操作を行うと、このメンバーは通常表示されなくなります。{confirmLeave.profile_id===myProfileId?"（自分自身です）":""}</p><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmChecked} onChange={(e)=>setConfirmChecked(e.target.checked)} /><span>問題ないことを確認しました</span></label><div className="mt-4 flex gap-2"><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={()=>setConfirmLeave(null)}>キャンセル</button><button disabled={!confirmChecked||loading} className="w-1/2 rounded-xl bg-red-500 py-2 disabled:bg-zinc-600" onClick={()=>void doDeactivate()}>非表示/退会する</button></div></div></div>}
      {confirmGroupDelete && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-sm rounded-2xl bg-card p-4"><p className="font-semibold">本当にグループを削除しますか？</p><p className="mt-2 text-sm text-zinc-300">この操作は重要な操作です。イベント履歴や戦績に影響する可能性があります。</p><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmChecked} onChange={(e)=>setConfirmChecked(e.target.checked)} /><span>問題ないことを確認しました</span></label><div className="mt-4 flex gap-2"><button className="w-1/2 rounded-xl border border-zinc-600 py-2" onClick={()=>setConfirmGroupDelete(false)}>キャンセル</button><button disabled={!confirmChecked||loading} className="w-1/2 rounded-xl bg-red-500 py-2 disabled:bg-zinc-600" onClick={()=>void doDeleteGroup()}>グループを削除する</button></div></div></div>}
    </main>
  );
}

function MemberRow({ member, editable, currentRole, isSuperUser, loading, onSave, onDeactivate }: { member: Member; editable: boolean; currentRole: Role; isSuperUser: boolean; loading: boolean; onSave: (m: Member, n: string, l: string, r: Role) => Promise<void>; onDeactivate: (m: Member) => void; }) {
  const [editing, setEditing] = useState(false);
  const [n, setN] = useState(member.display_name);
  const [l, setL] = useState(member.linked_auth_user_id ?? "");
  const [r, setR] = useState<Role>(member.role);
  const cannotEdit = !editable || (!isSuperUser && currentRole === "sub_admin" && member.role === "main_admin");
  return <div className="rounded-xl bg-zinc-800 p-3"><p className="text-xs text-zinc-400">{member.is_active ? "在籍" : "非表示/退会"} / {roleLabel[member.role]}</p>{editing ? <div className="space-y-2"><input className="w-full rounded-lg bg-zinc-700 p-2" value={n} onChange={(e)=>setN(e.target.value)} /><input className="w-full rounded-lg bg-zinc-700 p-2" value={l} onChange={(e)=>setL(e.target.value)} placeholder="auth user id（任意）" /><select className="w-full rounded-lg bg-zinc-700 p-2" value={r} onChange={(e)=>setR(e.target.value as Role)}><option value="main_admin">メイン管理者</option><option value="sub_admin">サブ管理者</option><option value="member">メンバー</option></select><div className="flex gap-2"><button disabled={loading} className="w-1/2 rounded-lg bg-accent py-2 text-black disabled:bg-zinc-600" onClick={async()=>{await onSave(member,n,l,r); setEditing(false);}}>保存</button><button className="w-1/2 rounded-lg border border-zinc-500 py-2" onClick={()=>setEditing(false)}>キャンセル</button></div></div> : <div className="space-y-1"><p className="font-semibold">{member.display_name}</p><p className="text-xs text-zinc-300">連携: {member.linked_auth_user_id ?? "未設定"}</p>{member.is_active && !cannotEdit && <div className="flex gap-2"><button className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={()=>setEditing(true)}>編集</button><button className="rounded border border-red-500 px-3 py-1 text-sm text-red-300" onClick={()=>onDeactivate(member)}>非表示/退会</button></div>}</div>}</div>;
}
