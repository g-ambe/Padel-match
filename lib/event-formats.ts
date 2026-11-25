export const eventFormats = [
  { id: "auto", title: "SHUFFLE MATCH", description: "ペアや対戦相手をランダムに組み合わせて対戦する形式", detail: "参加者とコート数を決めて、乱数で組み合わせを作ります。参加・休憩・欠席や固定ペアを設定し、次のRoundを生成できます。", href: "/events/new?mode=auto" },
  { id: "manual", title: "CUSTOM MATCH", description: "ペアや対戦相手を自由に組み合わせて対戦する形式", detail: "各コートの選手とペアを指定してRoundを作成します。自分で組み合わせを決めたいイベントに利用できます。", href: "/events/new?mode=manual" },
  { id: "team", title: "TEAM MATCH", description: "2つのチームに分かれ、チーム対抗戦や混合戦を行う形式", detail: "2つのチームにグループや選手を設定します。手動での試合追加、チーム対決・チーム混合の乱数編成を利用できます。ログインが必要です。", href: "/team-matches/new" }
] as const;
