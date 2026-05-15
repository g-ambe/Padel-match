import { Card } from "@/components/ui";

export default function ProfilePage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-4">
      <Card title="プロフィール">
        <p>田中 太郎</p>
        <p className="text-sm text-zinc-300">通算MVP: 4回</p>
      </Card>
      <Card title="成績">
        <p>試合数: 24</p>
        <p>勝利数: 17</p>
        <p>勝率: 70.8%</p>
      </Card>
    </main>
  );
}
