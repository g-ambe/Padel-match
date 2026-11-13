export const eventFormats = [
  { id: "auto", title: "自動で組む", description: "参加者から組み合わせを自動で作成", detail: "参加者とコート数を決めて、乱数で組み合わせを作ります。参加・休憩・欠席や固定ペアを設定し、次のRoundを生成できます。", href: "/events/new?mode=auto" },
  { id: "manual", title: "自分で組む", description: "出場する選手と組み合わせを自分で指定", detail: "各コートの選手とペアを指定してRoundを作成します。自分で組み合わせを決めたいイベントに利用できます。", href: "/events/new?mode=manual" },
  { id: "team", title: "チーム戦", description: "チームA対チームBで対戦", detail: "2つのチームにグループや選手を設定します。手動での試合追加、チーム対決・チーム混合の乱数編成を利用できます。ログインが必要です。", href: "/team-matches/new" }
] as const;
