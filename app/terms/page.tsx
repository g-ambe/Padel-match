import Link from "next/link";
import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "パデルクラブ 利用規約",
};

export default function TermsPage() {
  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 pb-12 text-zinc-100">
    <Link href="/login" className="mb-5 inline-flex min-h-11 items-center text-sm text-zinc-300 underline underline-offset-4">ログイン画面へ戻る</Link>
    <div className="rounded-2xl bg-card p-4 shadow-lg sm:p-6">
      <LegalDocument documentId="terms" titleAs="h1" />
    </div>
    <nav aria-label="規約ページ" className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-300">
      <Link href="/login" className="inline-flex min-h-11 items-center underline underline-offset-4">ログイン画面へ戻る</Link>
      <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4">プライバシーポリシー</Link>
    </nav>
  </main>;
}
