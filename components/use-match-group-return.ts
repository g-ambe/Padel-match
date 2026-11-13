"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { useSessionAccount } from "./use-session-account";
import { discardCreationDraft, discardGuestCreationDraft, discardMatchDraft, readCreationDraft, readGuestCreationDraft, saveCreationDraft, saveGuestCreationDraft, startGroupCreation, takeMatchDraft, type GroupSlot, type MatchFormKind, type MatchFormValues } from "@/lib/match-group-drafts";

export function useMatchGroupReturn({ kind, ownerId, ready, guest = false, preserveNavigation = false, values, restore, selectGroup, selectableIds }: {
  kind: MatchFormKind; ownerId: string | null; ready: boolean; guest?: boolean; values: MatchFormValues;
  restore: (values: MatchFormValues) => void; selectGroup: (id: string, slot: GroupSlot) => void; selectableIds: readonly string[];
  preserveNavigation?: boolean;
}) {
  const router = useRouter();
  const account = useSessionAccount();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const initialized = useRef("");
  const committed = useRef(false);
  const current = useRef({ values, restore, selectGroup, selectableIds });
  current.current = { values, restore, selectGroup, selectableIds };

  useEffect(() => {
    if (!ready || !account.ready || (ownerId ? account.id !== ownerId : !guest || !!account.id)) return;
    const scope = ownerId ?? "guest";
    if (initialized.current === scope) return;
    initialized.current = scope;
    try {
      if (ownerId) {
        discardGuestCreationDraft(sessionStorage);
        const token = new URLSearchParams(window.location.search).get("groupReturn");
        const draft = takeMatchDraft(sessionStorage, ownerId, kind, token);
        if (draft) {
          current.current.restore(draft.values);
          if (draft.status === "created" && draft.groupId) {
            if (current.current.selectableIds.includes(draft.groupId)) { current.current.selectGroup(draft.groupId, draft.slot); setMessage("入力内容を復元し、新しいグループを選択しました。"); }
            else setError("入力内容を復元しました。作成したグループが現在の選択候補にないため自動選択していません。所属・管理権限と取得状態を確認してください。");
          } else setMessage("入力内容を復元しました。グループの選択は変更していません。");
        } else if (token) setError("このアカウントの有効な復帰情報が見つかりません。期限切れ・復元済みの場合は再入力してください。");
        else if (preserveNavigation) {
          const saved = readCreationDraft(sessionStorage, ownerId, kind);
          if (saved) current.current.restore(saved);
        }
        if (token) window.history.replaceState(window.history.state, "", window.location.pathname);
      } else {
        const draft = readGuestCreationDraft(sessionStorage);
        if (draft) current.current.restore(draft);
      }
    } catch { setError("一時保存を利用できません。画面を移動する前にブラウザの保存設定を確認してください。"); }
    setRestored(true);
  }, [kind, ownerId, ready, guest, account.ready, account.id]);

  useEffect(() => {
    if (!guest || ownerId || !ready || !restored || committed.current) return;
    try { saveGuestCreationDraft(sessionStorage, values); }
    catch { setError("作成途中の入力を一時保存できません。移動すると入力内容が失われる可能性があります。"); }
  }, [guest, ownerId, ready, restored, values]);

  useEffect(() => {
    if (!preserveNavigation || !ownerId || !ready || !restored || account.id !== ownerId || committed.current) return;
    try { saveCreationDraft(sessionStorage, ownerId, kind, values); }
    catch { setError(previous => previous || "入力内容を一時保存できません。移動すると入力内容が失われる可能性があります。"); }
  }, [preserveNavigation, ownerId, ready, restored, account.id, kind, values]);

  const saveForNavigation = () => {
    try {
      if (!ready || !account.ready || (ownerId ? account.id !== ownerId : !guest || !!account.id)) return false;
      if (ownerId) saveCreationDraft(sessionStorage, ownerId, kind, current.current.values);
      else saveGuestCreationDraft(sessionStorage, current.current.values);
      return true;
    } catch { setError("入力内容を一時保存できないため移動しませんでした。"); return false; }
  };

  const begin = async (slot: GroupSlot = "group") => {
    if (!ready || !ownerId || account.id !== ownerId || openingRef.current) return;
    openingRef.current = true; setOpening(true); setError("");
    try {
      const s = getSupabaseClient();
      if (!s) throw new Error("ログイン状態を確認できません");
      const { data, error: authError } = await s.auth.getUser();
      if (authError || data.user?.id !== ownerId) throw new Error("ログイン状態が変わっています。入力画面を再読み込みしてください。");
      const path = startGroupCreation(sessionStorage, ownerId, kind, slot, current.current.values);
      router.push(path);
    } catch (cause) {
      openingRef.current = false; setOpening(false);
      setError(cause instanceof Error && /^(ログイン|入力内容)/.test(cause.message) ? cause.message : "入力内容を一時保存できないため移動しませんでした。ブラウザの保存設定を確認してください。");
    }
  };
  const clear = () => {
    committed.current = true;
    try { if (ownerId) { discardMatchDraft(sessionStorage, ownerId, kind); if (preserveNavigation) discardCreationDraft(sessionStorage, ownerId, kind); } else if (guest) discardGuestCreationDraft(sessionStorage); } catch { /* 保存済みの試合作成を失敗扱いにしない。 */ }
  };
  return { begin, clear, saveForNavigation, message, error, opening, canCreate: ready && account.ready && !!ownerId && account.id === ownerId };
}
