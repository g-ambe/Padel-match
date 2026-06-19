import Link from "next/link";
import { Card } from "@/components/ui";

export default function IndividualOfficialMatchPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 text-zinc-100">
      <h1 className="text-xl font-bold">オフィシャルマッチ</h1>
      <Card title="準備中">
        <p className="text-sm text-zinc-300">個人戦形式のオフィシャルマッチは準備中です。</p>
      </Card>
      <Link href="/home" className="text-center text-sm underline">イベント作成・閲覧へ戻る</Link>
    </main>
  );
}
