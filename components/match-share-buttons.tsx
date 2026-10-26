"use client";

import { useEffect, useState } from "react";
import { copyMatchShareText, openLineShare } from "@/lib/match-share-actions";
import { buildLineShareUrl, buildMatchShareText, getMatchShareUrls, isLineMobileDevice, MAX_LINE_SHARE_URL_LENGTH, type MatchShareEntry, type MatchShareEvent, type MatchShareKind } from "@/lib/match-share-text";

export function MatchShareButtons({ event, eventName, kind, getMatches, canShare = true }: {
  event: MatchShareEvent;
  eventName: string;
  kind: MatchShareKind;
  getMatches: () => MatchShareEntry[];
  canShare?: boolean;
}) {
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const urls = getMatchShareUrls(event, origin, kind);
  const available = canShare && !!urls;
  useEffect(() => { setFeedback(null); }, [event.status, event.is_deleted, event.share_enabled, event.share_token]);

  const share = async (mode: "copy" | "line") => {
    setFeedback(null);
    // UI表示とは別に、毎回現在の終了・削除・共有停止・トークンを検証する。
    if (!available || event.status !== "closed" || event.is_deleted === true) {
      setFeedback({ text: "終了済みで共有リンクが有効なイベントのみ共有できます", error: true });
      return;
    }
    setBusy(true);
    try {
      const text = buildMatchShareText({ event, eventName, origin, kind, matches: getMatches() });
      if (mode === "copy") {
        try {
          await copyMatchShareText(text);
          setFeedback({ text: "共有文章をコピーしました", error: false });
        } catch {
          setFeedback({ text: "文章のコピーに失敗しました", error: true });
        }
        return;
      }
      const url = buildLineShareUrl(text);
      const mobile = isLineMobileDevice(navigator.userAgent, navigator.maxTouchPoints);
      const tooLong = url.length > MAX_LINE_SHARE_URL_LENGTH;
      if (mobile && !tooLong && openLineShare(url)) {
        setFeedback({ text: "LINEの共有画面で送信先を選んでください。開かない場合は「文章をコピー」をご利用ください", error: false });
        return;
      }
      const reason = !mobile ? "PCではLINEを開き、貼り付けて送信してください" : tooLong ? "長文のため、LINEに貼り付けて送信してください" : "LINE共有を開始できませんでした。LINEに貼り付けて送信してください";
      try {
        await copyMatchShareText(text);
        setFeedback({ text: `共有文章をコピーしました。${reason}`, error: false });
      } catch {
        setFeedback({ text: "LINE共有への切替コピーに失敗しました。「文章をコピー」をお試しください", error: true });
      }
    } catch (cause) {
      setFeedback({ text: cause instanceof Error && cause.message.startsWith("共有") ? cause.message : "共有文章を生成できませんでした", error: true });
    } finally {
      setBusy(false);
    }
  };

  if (event.status !== "closed") return null;
  return <div className="space-y-2 border-t border-zinc-600 pt-3">
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <button type="button" className="min-h-12 rounded-xl border border-zinc-500 px-3 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40" disabled={!available || busy} onClick={() => void share("copy")}>文章をコピー</button>
      <button type="button" className="min-h-12 rounded-xl bg-accent px-3 py-3 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-40" disabled={!available || busy} onClick={() => void share("line")}>LINEで共有</button>
    </div>
    {!urls && <p className="text-xs text-zinc-400">共有リンクを作成すると利用できます</p>}
    {!canShare && <p className="text-xs text-zinc-400">この操作を行う権限がありません</p>}
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`text-sm ${feedback.error ? "text-red-400" : "text-emerald-400"}`}>{feedback.text}</p>}
  </div>;
}
