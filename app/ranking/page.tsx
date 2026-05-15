import { Card } from "@/components/ui";

export default function RankingPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-4">
      <Card title="勝率ランキング（10試合以上）">
        <ol className="space-y-2">
          <li>1位 田中 72%（21試合）</li>
          <li>2位 佐藤 69%（16試合）</li>
        </ol>
      </Card>
    </main>
  );
}
