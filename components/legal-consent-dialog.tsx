"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LegalDocument } from "@/components/legal-document";
import type { LegalDocumentId } from "@/lib/legal-documents";

type Props = {
  open: boolean;
  initialDocument: LegalDocumentId;
  agreed: boolean;
  onAgreedChange: (agreed: boolean) => void;
  onClose: () => void;
  onSubmit: () => void;
  loading: boolean;
  error?: string;
};

const documentTabs = [
  { id: "terms", label: "利用規約" },
  { id: "privacy", label: "プライバシーポリシー" },
] as const;

const importantPoints = [
  "表示名や戦績は、所属グループやイベント内で表示されます。",
  "共有リンクを有効にすると、第三者が試合結果等を閲覧できる場合があります。",
  "動画の登録・共有では、参加者のプライバシーに配慮してください。",
  "本サービスは個人開発のため、不具合やデータ消失等を完全に防止できることは保証していません。",
];

export function LegalConsentDialog({ open, initialDocument, agreed, onAgreedChange, onClose, onSubmit, loading, error }: Props) {
  const [activeDocument, setActiveDocument] = useState<LegalDocumentId>(initialDocument);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Partial<Record<LegalDocumentId, HTMLButtonElement | null>>>({});
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const id = useId();

  useEffect(() => {
    if (open) setActiveDocument(initialDocument);
  }, [open, initialDocument]);

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [open, activeDocument]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body, root = document.documentElement;
    const x = window.scrollX, y = window.scrollY;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow, paddingRight: body.style.paddingRight, rootOverflow: root.style.overflow };
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    if (scrollbarWidth > 0) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbarWidth}px`;
    Object.assign(body.style, { position: "fixed", top: `${-y}px`, left: `${-x}px`, width: "100%", overflow: "hidden" });
    root.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      Object.assign(body.style, { position: previous.position, top: previous.top, left: previous.left, width: previous.width, overflow: previous.overflow, paddingRight: previous.paddingRight });
      root.style.overflow = previous.rootOverflow;
      const behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(x, y);
      root.style.scrollBehavior = behavior;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  const selectDocument = (documentId: LegalDocumentId) => {
    if (!loading) setActiveDocument(documentId);
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, current: LegalDocumentId) => {
    if (loading || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "terms" : event.key === "End" ? "privacy" : current === "terms" ? "privacy" : "terms";
    setActiveDocument(next);
    tabRefs.current[next]?.focus();
  };

  const trapFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') ?? []).filter(element => !element.matches(":disabled") && element.getClientRects().length > 0);
    const first = items[0], last = items[items.length - 1];
    if (!first) { event.preventDefault(); dialogRef.current?.focus(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <dialog
    ref={dialogRef}
    role="dialog"
    aria-modal="true"
    aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-description`}
    aria-busy={loading}
    className="m-auto h-[calc(100dvh_-_2rem)] max-h-[52rem] w-[calc(100%_-_2rem)] max-w-lg overflow-hidden rounded-2xl border border-zinc-700 bg-card p-0 text-zinc-100 shadow-xl backdrop:bg-black/70"
    onCancel={event => { event.preventDefault(); if (!loadingRef.current) onClose(); }}
    onClose={() => { if (open && !loadingRef.current) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !loading) onClose(); }}
    onKeyDown={trapFocus}
  >
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-zinc-700 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${id}-title`} className="text-lg font-bold">利用規約・プライバシーポリシー</h2>
          <button ref={closeRef} type="button" aria-label="閉じる" disabled={loading} className="min-h-10 min-w-10 shrink-0 rounded-lg border border-zinc-600 px-3 text-lg disabled:opacity-40" onClick={onClose}>×</button>
        </div>
        <p id={`${id}-description`} className="mt-2 text-xs text-zinc-300">アカウント作成前に、以下の内容をご確認ください。</p>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" style={{ WebkitOverflowScrolling: "touch" }}>
        <ul className="my-4 list-disc space-y-2 pl-5 text-xs leading-relaxed text-zinc-300">{importantPoints.map(point => <li key={point}>{point}</li>)}</ul>
        <div role="tablist" aria-label="確認する文書" className="sticky top-0 z-10 grid grid-cols-2 gap-2 border-b border-zinc-700 bg-card py-3">
          {documentTabs.map(tab => <button
            key={tab.id}
            ref={element => { tabRefs.current[tab.id] = element; }}
            id={`${id}-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={activeDocument === tab.id}
            aria-controls={`${id}-panel`}
            tabIndex={activeDocument === tab.id ? 0 : -1}
            disabled={loading}
            className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-bold disabled:opacity-40 ${activeDocument === tab.id ? "border-accent bg-accent text-black" : "border-zinc-600"}`}
            onClick={() => selectDocument(tab.id)}
            onKeyDown={event => handleTabKey(event, tab.id)}
          >{tab.label}</button>)}
        </div>
        <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${activeDocument}-tab`} tabIndex={0} className="py-4">
          <LegalDocument documentId={activeDocument} />
        </div>
      </div>

      <div className="shrink-0 space-y-3 border-t border-zinc-700 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed text-zinc-300">
          <input type="checkbox" className="mt-1 shrink-0" checked={agreed} disabled={loading} onChange={event => onAgreedChange(event.target.checked)} />
          <span>利用規約に同意し、プライバシーポリシーの内容を確認しました。</span>
        </label>
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-[1fr_auto]">
          <button type="button" disabled={!agreed || loading} className="min-h-11 rounded-xl bg-accent px-3 py-3 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-40" onClick={() => { if (agreed && !loading) onSubmit(); }}>{loading ? "作成中..." : "同意してアカウント作成"}</button>
          <button type="button" disabled={loading} className="min-h-11 rounded-xl border border-zinc-600 px-5 py-3 text-sm disabled:opacity-40" onClick={onClose}>戻る</button>
        </div>
      </div>
    </div>
  </dialog>;
}
