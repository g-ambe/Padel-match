"use client";
import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
type Host = RefObject<HTMLDivElement | null>;
function CardMount({ id, host, order, children }: { id: string; host: Host; order: number; children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => { const el=document.createElement("div"); el.dataset.teamMatchMount=id; setContainer(el); return ()=>el.remove(); },[id]);
  useLayoutEffect(() => { if (!container || !host.current) return; host.current.appendChild(container); return ()=>container.remove(); },[container,host,order]);
  return container ? createPortal(children,container,id) : null;
}
// 同じコンテナを移動してポップアップ・未確定入力・動画フォームを保持する。
export function TeamMatchCards({ cards, latestHost, pastHost, expandedHost, expanded }: { cards: {id:string;content:ReactNode}[]; latestHost:Host; pastHost:Host; expandedHost:Host; expanded:boolean }) {
  return <>{cards.map((card,index)=><CardMount key={card.id} id={card.id} order={index} host={expanded?expandedHost:index<2?latestHost:pastHost}>{card.content}</CardMount>)}</>;
}
