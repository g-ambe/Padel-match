import Link from "next/link";
import { Card } from "@/components/ui";

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-center text-2xl font-bold">パデルクラブ</h1>
      <Card title="メールを確認してください">
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-100">
            <p>確認メールを送信しました。</p>
            <p>メールを確認し、「Confirm email address」をクリックしてください。</p>
            <p>メール認証完了後、ログインしてください。</p>
          </div>
          <Link href="/login" className="block w-full rounded-2xl border border-zinc-600 py-3 text-center text-sm text-zinc-100">
            ログイン画面へ戻る
          </Link>
        </div>
      </Card>
    </main>
  );
}
