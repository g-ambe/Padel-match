"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionButton, Card } from "@/components/ui";
import { resetGuestModeData, setGuestMode } from "@/lib/guest-events";
import { ensureAccountProfile, ensureLinkedPlayerProfile, preferredPlayerProfileId, profileErrorMessage } from "@/lib/player-profiles";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [signupMode, setSignupMode] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [profileSetupPending, setProfileSetupPending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("confirmed") === "true") {
      setSignupMode(false);
      setMessage("アカウント作成が完了しました。ログインしてください。");
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


  const signUpWithEmail = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setProfileSetupPending(false);
    const trimmedName = displayName.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("メールアドレスの形式が正しくありません");
    if (!trimmedName) return setError("表示名を入力してください");
    if (password.length < 8) return setError("パスワードは8文字以上で入力してください");
    if (password !== passwordConfirm) return setError("パスワード確認が一致しません");
    if (!agreed) return setError("利用規約とプライバシーポリシーへの同意が必要です");

    setLoading(true);
    const { getSupabaseClient, getSupabaseEnvErrorMessage } = await import("@/lib/supabase");
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      setError(getSupabaseEnvErrorMessage() ?? "Supabase初期化に失敗しました");
      return;
    }

    const redirectUrl = new URL("/login?confirmed=true", window.location.origin).toString();
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: trimmedName },
        emailRedirectTo: redirectUrl,
      }
    });

    if (signUpError) {
      setLoading(false);
      setError("アカウント作成に失敗しました");
      return;
    }

    if (!signUpData.session) {
      setLoading(false);
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
      setLoading(false);
      setProfileSetupPending(true);
      setError(`アカウントは作成されました。${profileErrorMessage(cause)}。プロフィール画面で確認してください`);
      return;
    }
    setLoading(false);
    resetGuestModeData();
    router.push("/home");
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
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-center text-2xl font-bold">パデルクラブ</h1>
      <Card title={signupMode ? "アカウント作成" : "ログイン"}>
        <form className="space-y-3" onSubmit={signupMode ? signUpWithEmail : loginWithEmail}>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {profileSetupPending && <Link href="/profile" className="block text-sm text-accent underline">ログイン済みのプロフィールを確認</Link>}
          {message && <p className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}
          <input className="w-full rounded-2xl bg-zinc-800 p-3" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} />
          {signupMode && <input className="w-full rounded-2xl bg-zinc-800 p-3" placeholder="表示名" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
          <input className="w-full rounded-2xl bg-zinc-800 p-3" type="password" placeholder="パスワード" value={password} onChange={(e) => setPassword(e.target.value)} />
          {signupMode && <input className="w-full rounded-2xl bg-zinc-800 p-3" type="password" placeholder="パスワード確認" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />}
          {signupMode && <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><span>利用規約/プライバシーポリシーに同意する</span></label>}
          <ActionButton type="submit" disabled={loading}>{loading ? (signupMode ? "作成中..." : "ログイン中...") : (signupMode ? "アカウント作成" : "メールでログイン")}</ActionButton>
          {!signupMode && <button type="button" className="w-full rounded-2xl border border-zinc-600 py-3" onClick={loginWithGoogle}>Googleでログイン</button>}
          {!signupMode && <button type="button" className="w-full rounded-2xl border border-zinc-600 py-3" onClick={() => { setGuestMode(true); router.push("/home"); }}>ゲストで利用</button>}
          <button type="button" className="w-full rounded-2xl border border-zinc-600 py-3" onClick={() => { setSignupMode((v) => !v); setError(""); setMessage(""); }}>
            {signupMode ? "ログインへ戻る" : "アカウント作成"}
          </button>
        </form>
      </Card>
      <Link href="/home" className="text-center text-sm text-zinc-300 underline">デモとしてホームへ進む</Link>
    </main>
  );
}
