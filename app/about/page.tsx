import Link from "next/link";
import { Card } from "@/components/ui";

export default function AboutPage() {
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4"><h1 className="pr-14 text-xl font-bold">アプリについて</h1><Card title="Padel Match App"><p className="text-sm leading-7">パデルの試合運営、スコア記録、グループの戦績確認を行うアプリです。</p></Card><Card title="規約・プライバシー"><div className="grid gap-2 text-sm"><Link href="/terms" className="min-h-12 rounded-xl border border-zinc-600 p-3">利用規約</Link><Link href="/privacy" className="min-h-12 rounded-xl border border-zinc-600 p-3">プライバシーポリシー</Link></div></Card><Link href="/help" className="min-h-11 p-3 text-sm underline">使い方・ヘルプ</Link></main>;
}
