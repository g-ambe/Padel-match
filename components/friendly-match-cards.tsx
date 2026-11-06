"use client";

import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Host = RefObject<HTMLDivElement | null>;

function MatchCard({ id, host, order, hidden, children }: { id: string; host: Host; order: number; hidden: boolean; children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.friendlyMatchMount = id;
    element.className = "min-w-0";
    setContainer(element);
    return () => element.remove();
  }, [id]);
  useLayoutEffect(() => {
    if (!container || !host.current) return;
    host.current.appendChild(container);
    return () => container.remove();
  }, [container, host, order]);
  useLayoutEffect(() => { if (container) container.hidden = hidden; }, [container, hidden]);
  // Portalのコンテナを維持したまま配置先だけを移す。ScoreInputや編集中のDOMを作り直さない。
  return container ? createPortal(children, container, id) : null;
}

export function FriendlyMatchCards({ cards, latestRound, moreCourts, expanded, latestHost, pastHost, expandedHost }: {
  cards: readonly { id: string; round: number; content: ReactNode }[];
  latestRound: number;
  moreCourts: boolean;
  expanded: boolean;
  latestHost: Host;
  pastHost: Host;
  expandedHost: Host;
}) {
  let latestIndex = 0;
  return <>{cards.map((card, order) => {
    const latest = card.round === latestRound;
    const hidden = latest && latestIndex++ >= 2 && !moreCourts && !expanded;
    return <MatchCard key={card.id} id={card.id} host={expanded ? expandedHost : latest ? latestHost : pastHost} order={order} hidden={hidden}>{card.content}</MatchCard>;
  })}</>;
}
