import Link from "next/link";
import { ActionButton, Card } from "@/components/ui";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-center text-2xl font-bold">パデルクラブ</h1>
      <Card title="ログイン">
        <div className="space-y-3">
          <ActionButton>Googleでログイン</ActionButton>
          <button className="w-full rounded-2xl border border-zinc-600 py-3">ゲストで利用</button>
        </div>
      </Card>
      <Link href="/home" className="text-center text-sm text-zinc-300 underline">デモとしてホームへ進む</Link>
    </main>
  );
}
