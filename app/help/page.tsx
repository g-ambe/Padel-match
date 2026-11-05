import Link from "next/link";
import { Card } from "@/components/ui";

export default function HelpPage() {
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4"><h1 className="pr-14 text-xl font-bold">使い方・ヘルプ</h1>
    <Card title="試合を始める"><p className="text-sm leading-7">「試合」で表示対象のグループを選び、開催中の試合を開きます。「新しい試合を作成」から形式を選ぶと、開催情報を入力できます。</p></Card>
    <Card title="スコアを入力する"><p className="text-sm leading-7">得点欄をタップして数字を選びます。作成済みの対戦カードでは、初回は両チームの得点を選ぶと保存され、保存済みのスコアは「完了」で修正を保存します。キーボード入力も利用できます。選手が未設定の新規チーム戦カードは、カードの「保存」で登録します。保存に失敗した場合は「再試行」を押してください。</p></Card>
    <Card title="ランキング・マイページ"><p className="text-sm leading-7">ランキングではグループごとの既存戦績を確認できます。マイページでは本人プロフィール、連携申請、所属グループを確認できます。</p></Card>
    <Card title="ゲスト利用"><p className="text-sm leading-7">ゲストの試合はブラウザに一時保存されます。ゲスト用の「TOPへ戻る」を押すと一時データが削除されます。ログインすると一時データは引き継がれません。</p></Card>
    <Link href="/home" className="min-h-11 p-3 text-center text-sm underline">試合トップへ</Link>
  </main>;
}
