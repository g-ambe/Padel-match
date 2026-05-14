import Link from "next/link";
import { Card, ActionButton } from "@/components/ui";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">開催一覧</h1>
      <ActionButton>開催作成</ActionButton>
      <Card title="Wytelパデル部">
        <div className="space-y-2">
          <Link href="/events/demo" className="block rounded-xl bg-zinc-800 p-3">木曜ナイトマッチ（コート2面）</Link>
        </div>
      </Card>
    </main>
  );
}
