"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui";
import { ClubOwnerTransfer } from "@/components/club-owner-transfer";
export default function OwnerTransferPage() {
  const { id } = useParams<{ id: string }>();
  return <main className="mx-auto min-h-screen w-full max-w-md space-y-4 p-4">
    <Card title="オーナー引継ぎ"><ClubOwnerTransfer key={id} requestId={id} /></Card>
    <Link href="/notifications" className="block min-h-11 py-3 text-center text-sm underline">通知へ戻る</Link>
  </main>;
}
