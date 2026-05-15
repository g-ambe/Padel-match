"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton, Card } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("testuser01@example.com");
  const [password, setPassword] = useState("test0001");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loginWithEmail = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
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
      <Card title="ログイン">
        <form className="space-y-3" onSubmit={loginWithEmail}>
          <input className="w-full rounded-2xl bg-zinc-800 p-3" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="w-full rounded-2xl bg-zinc-800 p-3" type="password" placeholder="パスワード" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <ActionButton type="submit" disabled={loading}>{loading ? "ログイン中..." : "メールでログイン"}</ActionButton>
          <button type="button" className="w-full rounded-2xl border border-zinc-600 py-3" onClick={loginWithGoogle}>Googleでログイン</button>
          <button type="button" className="w-full rounded-2xl border border-zinc-600 py-3" onClick={() => router.push("/home")}>ゲストで利用</button>
        </form>
      </Card>
      <Link href="/home" className="text-center text-sm text-zinc-300 underline">デモとしてホームへ進む</Link>
    </main>
  );
}
