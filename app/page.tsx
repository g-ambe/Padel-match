"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/ui";
import { LegalConsentDialog } from "@/components/legal-consent-dialog";
import { LEGAL_TERMS_VERSION, LEGAL_PRIVACY_VERSION, type LegalDocumentId } from "@/lib/legal-documents";
import { resetGuestModeData, setGuestMode } from "@/lib/guest-events";
import { ensureAccountProfile, ensureLinkedPlayerProfile, preferredPlayerProfileId, profileErrorMessage } from "@/lib/player-profiles";

import { padelBoardHref } from "@/lib/padel-board";

// 再開時はこの表示フラグだけを変更する。Supabase側のOAuth設定は変更しない。
const GOOGLE_LOGIN_VISIBLE = false;

export default function LoginPage() {
  const router = useRouter(), pathname = usePathname();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [signupMode, setSignupMode] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [consent, setConsent] = useState<{ agreed: boolean; acceptedAt: string | null }>({ agreed: false, acceptedAt: null });
  const [legalDialogOpen, setLegalDialogOpen] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocumentId>("terms");
  const [signupFinished, setSignupFinished] = useState(false);
  const signupInFlight = useRef(false);
  const agreed = consent.agreed;
  const changeConsent = (next: boolean) => setConsent({ agreed: next, acceptedAt: next ? new Date().toISOString() : null });
  const openLegalDocument = (documentId: LegalDocumentId) => {
    if (loading) return;
    setLegalDocument(documentId);
    setLegalDialogOpen(true);
  };
  const [profileSetupPending, setProfileSetupPending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("confirmed") === "true") {
      setSignupMode(false);
      setMessage("アカウント作成が完了しました。ログインしてください。");
    } else {
      setSignupMode(params.get("mode") === "signup");
    }
  }, []);

  const loginWithEmail = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setProfileSetupPending(false);
    setLoading(true);

    const { getSupabaseClient, getSupabaseEnvErrorMessage } = await import("@/lib/supabase");
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      setError(getSupabaseEnvErrorMessage() ?? "Supabase初期化に失敗しました");
      return;
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setLoading(false);
      setError("メールまたはパスワードが正しくありません");
      return;
    }
    try {
      const user = signInData.user;
      if (!user) throw new Error("ログイン情報を確認できません");
      const displayName = typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : user.email?.split("@")[0] ?? "メンバー";
      // メール確認後の初回ログインでも認証側の行を用意する。既存値は上書きしない。
      await ensureAccountProfile(supabase, user.id, displayName, user.email ?? null);
    } catch (cause) {
      console.error("ログイン後のアカウント確認に失敗しました", cause);
      setLoading(false);
      setProfileSetupPending(true);
      setError(profileErrorMessage(cause));
      return;
    }
    setLoading(false);
    resetGuestModeData();
    router.push("/home");
  };


  // フォームとポップアップは同じ処理を使い、Reactの再描画より先にrefで二重実行を防ぐ。
  const createAccountWithEmail = async () => {
    if (signupInFlight.current || signupFinished) return;
    setError("");
    setMessage("");
    setProfileSetupPending(false);
    const trimmedName = displayName.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("メールアドレスの形式が正しくありません");
    if (!trimmedName) return setError("表示名を入力してください");
    if (password.length < 8) return setError("パスワードは8文字以上で入力してください");
    if (password !== passwordConfirm) return setError("パスワード確認が一致しません");
    if (!agreed || !consent.acceptedAt) {
      openLegalDocument("terms");
      return;
    }

    signupInFlight.current = true;
    setLoading(true);
    let created = false;
    try {
      const { getSupabaseClient, getSupabaseEnvErrorMessage } = await import("@/lib/supabase");
      const supabase = getSupabaseClient();
      if (!supabase) {
        setError(getSupabaseEnvErrorMessage() ?? "Supabase初期化に失敗しました");
        return;
      }
      const redirectUrl = new URL("/login?confirmed=true", window.location.origin).toString();
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: trimmedName,
            terms_version: LEGAL_TERMS_VERSION,
            privacy_version: LEGAL_PRIVACY_VERSION,
            consented_at: consent.acceptedAt,
          },
          emailRedirectTo: redirectUrl,
        }
      });
      if (signUpError) {
        setError("アカウント作成に失敗しました");
        return;
      }
      created = true;
      setSignupFinished(true);
      setLegalDialogOpen(false);
      if (!signUpData.session) {
        router.push("/signup/check-email");
        return;
      }
      const uid = signUpData.session.user.id;
      try {
        // 既存の表示名・詳細情報を登録フォームの値で上書きしない。
        await ensureAccountProfile(supabase, uid, trimmedName, email.trim());
        await ensureLinkedPlayerProfile(supabase, uid, trimmedName, preferredPlayerProfileId(uid));
      } catch (cause) {
        console.error("登録後のプロフィール確認に失敗しました", cause);
        setProfileSetupPending(true);
        setError(`アカウントは作成されました。${profileErrorMessage(cause)}。プロフィール画面で確認してください`);
        return;
      }
      resetGuestModeData();
      router.push("/home");
    } catch {
      setError("アカウント作成に失敗しました");
    } finally {
      // Authが成功した後は、画面遷移・プロフィール確認中の登録再送も防ぐ。
      signupInFlight.current = created;
      setLoading(false);
    }
  };

  const signUpWithEmail = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createAccountWithEmail();
  };

  const loginWithGoogle = async () => {
    setError("");
    const { getSupabaseClient, getSupabaseEnvErrorMessage } = await import("@/lib/supabase");
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError(getSupabaseEnvErrorMessage() ?? "Supabase初期化に失敗しました");
      return;
    }

    const { error: oauthError } = await supabase.auth.signInWithOAuth({ provider: "google" });
    if (oauthError) setError("Googleログインに失敗しました");
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-start gap-3 px-4 md:justify-center pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <header className="space-y-1 text-center">
        <h1 className="mx-auto w-fit text-3xl font-bold" style={{ color: "var(--app-text)" }}>Padel Club</h1>
        <p className="text-sm text-zinc-300">パデルをもっと楽しく、もっと便利に。</p>
      </header>
      <section className="rounded-2xl border border-zinc-700 bg-card p-3">
        <div role="tablist" aria-label="ログイン・新規登録" className="mb-3 grid grid-cols-2 gap-2">
          {[[false, "ログイン"], [true, "新規登録"]].map(([value, label]) => {
            const signup = value === true, tabId = signup ? "auth-signup" : "auth-login";
            return <button key={tabId} id={tabId} role="tab" type="button" aria-selected={signupMode === signup} aria-controls="auth-form" tabIndex={signupMode === signup ? 0 : -1} disabled={loading} className={`min-h-11 rounded-xl px-2 text-sm font-bold disabled:opacity-40 ${signupMode === signup ? "bg-accent text-black" : "text-zinc-300"}`} onClick={() => { setSignupMode(signup); setError(""); setMessage(""); }} onKeyDown={event => {
              if (loading || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault(); const next = event.key === "Home" ? false : event.key === "End" ? true : !signup;
              setSignupMode(next); setError(""); setMessage(""); document.getElementById(next ? "auth-signup" : "auth-login")?.focus();
            }}>{label}</button>;
          })}
        </div>
        <form id="auth-form" role="tabpanel" aria-labelledby={signupMode ? "auth-signup" : "auth-login"} className="space-y-2" onSubmit={signupMode ? signUpWithEmail : loginWithEmail}>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          {profileSetupPending && <Link href="/profile" className="block text-sm text-accent underline">ログイン済みのプロフィールを確認</Link>}
          {message && <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}
          {signupMode && <input aria-label="表示名" autoComplete="nickname" className="min-h-11 w-full rounded-xl bg-zinc-800 px-3 py-2" placeholder="表示名" value={displayName} onChange={e => setDisplayName(e.target.value)} />}
          <input aria-label="メールアドレス" inputMode="email" autoComplete="email" className="min-h-11 w-full rounded-xl bg-zinc-800 px-3 py-2" placeholder="メールアドレス" value={email} onChange={e => setEmail(e.target.value)} />
          <input aria-label="パスワード" autoComplete={signupMode ? "new-password" : "current-password"} className="min-h-11 w-full rounded-xl bg-zinc-800 px-3 py-2" type="password" placeholder="パスワード" value={password} onChange={e => setPassword(e.target.value)} />
          {signupMode && <input aria-label="パスワード確認" autoComplete="new-password" className="min-h-11 w-full rounded-xl bg-zinc-800 px-3 py-2" type="password" placeholder="パスワード確認" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} />}
          {signupMode && <label className="flex items-start gap-3 text-xs leading-6 text-zinc-300">
            <input type="checkbox" className="mt-1.5 shrink-0" checked={agreed} disabled={loading || signupFinished} onChange={event => changeConsent(event.target.checked)} />
            <span><a href="/terms" className="text-accent underline underline-offset-4" aria-haspopup="dialog" onClick={event => { event.preventDefault(); event.stopPropagation(); openLegalDocument("terms"); }}>利用規約</a>に同意し、<a href="/privacy" className="text-accent underline underline-offset-4" aria-haspopup="dialog" onClick={event => { event.preventDefault(); event.stopPropagation(); openLegalDocument("privacy"); }}>プライバシーポリシー</a>の内容を確認しました。</span>
          </label>}
          <ActionButton type="submit" disabled={loading || (signupMode && signupFinished)}>{loading ? (signupMode ? "作成中..." : "ログイン中...") : (signupMode ? (signupFinished ? "アカウント作成済み" : "アカウントを作成") : "ログインする")}</ActionButton>
          {GOOGLE_LOGIN_VISIBLE && !signupMode && <button type="button" className="min-h-11 w-full rounded-xl border border-zinc-600 py-2" onClick={loginWithGoogle}>Googleでログイン</button>}
        </form>
      </section>
      <button type="button" disabled={loading} className="min-h-11 rounded-2xl border border-zinc-600 bg-card px-4 py-3 text-left disabled:opacity-40" onClick={() => { setGuestMode(true); router.push("/home"); }}><strong className="block text-sm">トライアル版を試す</strong><span className="mt-1 block text-xs text-zinc-300">ゲストモードで試合管理を体験。一部機能に制限あり。</span></button>
      <Link href={padelBoardHref(`${pathname}${signupMode ? "?mode=signup" : ""}`)} aria-disabled={loading || undefined} tabIndex={loading ? -1 : undefined} onClick={event => { if (loading) event.preventDefault(); }} className="block min-h-11 rounded-2xl border border-zinc-600 bg-card px-4 py-3"><strong className="block text-sm">パデルボードを使う</strong><span className="mt-1 block text-xs text-zinc-300">登録不要・無料。選手の配置や動きを描いて共有。</span></Link>
      <nav aria-label="規約とプライバシー" className="flex flex-wrap justify-center gap-x-5 text-xs text-zinc-300">
        <Link href="/terms" className="inline-flex min-h-11 items-center underline underline-offset-4">利用規約</Link>
        <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4">プライバシーポリシー</Link>
      </nav>
      <LegalConsentDialog open={legalDialogOpen} initialDocument={legalDocument} agreed={agreed} onAgreedChange={changeConsent} onClose={() => setLegalDialogOpen(false)} onSubmit={() => void createAccountWithEmail()} loading={loading} error={error} />
    </main>
  );
}
