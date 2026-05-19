"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton, Card } from "@/components/ui";

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

  const loginWithEmail = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const { getSupabaseClient, getSupabaseEnvErrorMessage } = await import("@/lib/supabase");
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      setError(getSupabaseEnvErrorMessage() ?? "Supabase初期化に失敗しました");
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (signInError) {
      setError("メールまたはパスワードが正しくありません");
      return;
    }

    router.push("/home");
  };


  const signUpWithEmail = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setMessage("");
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

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: trimmedName } }
    });

    if (signUpError) {
      setLoading(false);
      setError("アカウント作成に失敗しました");
      return;
    }

    const uid = signUpData.user?.id;
    if (uid) {
      const { data: existingProfile } = await supabase.from("player_profiles").select("id").eq("linked_auth_user_id", uid).maybeSingle();
      if (existingProfile?.id) {
        await supabase.from("player_profiles").update({ display_name: trimmedName }).eq("id", existingProfile.id);
      } else {
        await supabase.from("player_profiles").insert({ display_name: trimmedName, linked_auth_user_id: uid, is_active: true });
      }
      await supabase.from("profiles").upsert({ id: uid, display_name: trimmedName, email: email.trim() }, { onConflict: "id" });
    }

    setLoading(false);
    if (!signUpData.session) {
      setMessage("確認メールを送信しました。メール内のリンクから登録を完了してください。");
      return;
    }
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
          <input className="w-full rounded-2xl bg-zinc-800 p-3" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} />
          {signupMode && <input className="w-full rounded-2xl bg-zinc-800 p-3" placeholder="表示名" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
          <input className="w-full rounded-2xl bg-zinc-800 p-3" type="password" placeholder="パスワード" value={password} onChange={(e) => setPassword(e.target.value)} />
          {signupMode && <input className="w-full rounded-2xl bg-zinc-800 p-3" type="password" placeholder="パスワード確認" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />}
          {signupMode && <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><span>利用規約/プライバシーポリシーに同意する</span></label>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {message && <p className="text-sm text-emerald-400">{message}</p>}
          <ActionButton type="submit" disabled={loading}>{loading ? (signupMode ? "作成中..." : "ログイン中...") : (signupMode ? "アカウント作成" : "メールでログイン")}</ActionButton>
          {!signupMode && <button type="button" className="w-full rounded-2xl border border-zinc-600 py-3" onClick={loginWithGoogle}>Googleでログイン</button>}
          {!signupMode && <button type="button" className="w-full rounded-2xl border border-zinc-600 py-3" onClick={() => router.push("/home")}>ゲストで利用</button>}
          <button type="button" className="w-full rounded-2xl border border-zinc-600 py-3" onClick={() => { setSignupMode((v) => !v); setError(""); setMessage(""); }}>
            {signupMode ? "ログインへ戻る" : "アカウント作成"}
          </button>
        </form>
      </Card>
      <Link href="/home" className="text-center text-sm text-zinc-300 underline">デモとしてホームへ進む</Link>
    </main>
  );
}
