import Link from "next/link";
import { Card, ActionButton } from "@/components/ui";

const participants = [
  { name: "田中", status: "active" },
  { name: "佐藤", status: "active" },
  { name: "鈴木", status: "resting" },
  { name: "高橋", status: "active" }
];

export default function EventDetailPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 pb-20">
      <h1 className="text-xl font-bold">木曜ナイトマッチ</h1>
      <Card title="参加者">
        <ul className="space-y-2">
          {participants.map((p) => (
            <li key={p.name} className="flex items-center justify-between rounded-xl bg-zinc-800 p-3">
              <span>{p.name}</span>
              <span className="text-sm text-zinc-300">{p.status === "active" ? "参加中" : p.status === "resting" ? "休憩" : "離席"}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="現在Round">
        <p className="mb-2">Round 7</p>
        <div className="space-y-2 text-sm">
          <div className="rounded-xl bg-zinc-800 p-3">Court1: 田中/佐藤 vs 小林/中村</div>
          <div className="rounded-xl bg-zinc-800 p-3">Court2: 伊藤/山本 vs 加藤/吉田</div>
        </div>
      </Card>
      <Card title="スコア入力">
        <div className="grid grid-cols-2 gap-2">
          <button className="rounded-xl bg-zinc-800 py-3">4-2</button>
          <button className="rounded-xl bg-zinc-800 py-3">4-3</button>
        </div>
      </Card>
      <ActionButton>次Round生成</ActionButton>
      <Card title="勝率ランキング">
        <ol className="space-y-1 text-sm">
          <li>1位 田中 72%</li><li>2位 佐藤 67%</li><li>3位 鈴木 61%</li>
        </ol>
      </Card>
      <Card title="最近のRound">
        <p className="text-sm text-zinc-300">Round 6 / Round 5 / Round 4</p>
      </Card>
      <div className="flex gap-2 text-sm underline">
        <Link href="/ranking">ランキング</Link>
        <Link href="/profile">プロフィール</Link>
        <Link href="/matches/demo">試合詳細</Link>
      </div>
    </main>
  );
}
