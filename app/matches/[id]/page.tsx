import { Card, ActionButton } from "@/components/ui";

export default function MatchDetailPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">試合詳細</h1>
      <Card title="対戦カード">
        <p>田中 / 佐藤 vs 小林 / 中村</p>
      </Card>
      <Card title="スコア">
        <p>4 - 2</p>
      </Card>
      <Card title="YouTube URL">
        <input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="https://www.youtube.com/..." />
      </Card>
      <ActionButton>保存</ActionButton>
    </main>
  );
}
