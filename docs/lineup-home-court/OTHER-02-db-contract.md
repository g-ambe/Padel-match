# OTHER-02 / #267：非固定選手入替のDB契約引継ぎ

2026-11-25 JST。調査基点：main `065ade4b0c579ea47eb0452a85a0f17cb651abb2`。
正本：[#267コメント7148176143](https://github.com/g-ambe/Padel-match/issues/267#issuecomment-7148176143)。

## 状態と担当境界

原因・既存データ構造・必要契約の調査済み。**機能の解除は未実装、DB候補待ち**。
ChatGPTが変更SQL/返却契約を設計し、Codexが独立レビュー・隔離SQL試験・アプリ対応を行う。
候補を推測してMigration、固定ID抽出、blocked_reasonの除去を実装しない。
本番/Stageの書込み・Migration適用はこの工程では行わない。

## 現行呼出元とJSON

- `components/round-lineup-editor.tsx`：`blocked_reason`があれば全員/保存を無効化。固定別の保護情報はまだ使用していない。
- `app/events/[id]/page.tsx`：通常自動編成のみ `get_friendly_round_lineup` →既存POP→ `createLineupCommit`。ゲストは独立したローカル経路。
- `lib/round-lineup.ts`：snapshot全体をcloneして `p_expected` に送信。応答喪失時は同一payload/操作IDのみ再送。
- 0042 `lineup_private.snapshot(uuid,uuid)`：当該Roundの `event_fixed_pair_rounds` にeffective/applied/splitが1件でもあれば全体禁止。
- 0041 `replace_friendly_round_lineup(uuid,uuid,jsonb,jsonb,uuid)`：ロック→操作ID再送判定→停止/終了/参加状態/CAS→blocked_reason→カード検証→出場履歴・版・監査。DBが全体禁止するためUI単独では解除不可。
- `get_friendly_round_lineup`はsnapshotをそのまま返す。変更時はスコア/削除RPCも同じsnapshotを利用している点に注意。

0040の生成時履歴は以下。いずれもUUIDの参加者ID（auth/profile IDではない）。

| 列 | 形状・意味 |
| --- | --- |
| `effective_pairs` | `[{id,a,b}]`。参加可能者5人以上で両者が当時参加可能なら保存。両方が自動休憩でも存在する |
| `applied_pairs` | `[{id,a,b,match_id}]`。両者が同じ試合/チームで出場 |
| `split_pairs` | `[{id,a,b}]`。片方だけが自動休憩 |
| `eligible_ids` | 当時の参加可能者。現在のeligibleとの積集合をsnapshotに返す |
| `played_ids` | 当時の出場者。入替後に実際の出場者へ更新する唯一の固定履歴列 |

明示的な休み/欠席や4名以下による一時停止ではeffective/applied/splitに追加しない既存仕様。現在の固定設定から過去の保護対象を復元しない。両方休憩はsplitにもappliedにも現れないためeffectiveを省けない。

## ChatGPTへ必要な確定契約

1. 対象Roundの3履歴の和集合から保護対象を決め、各保護対象の**試合ID/チーム/休憩状態**を不変にする。順序だけを根拠にせず実参加者配置で比較。固定同士・固定/非固定・固定ペア全体の移動も拒否。単なる同一ペア維持だけでは移動できてしまう。
2. 保護ID/可否をアプリが安全に取得するDTO（フィールド名、型、版、旧応答時の扱い）を確定する。現時点で新フィールド名は未決定。既存blocked_reasonを一般的な禁止理由として維持し、履歴不明/不正JSONはfail closedにする。
3. 現在の設定解除後・複数固定・片方/両方休憩・一時停止・生成監査のみのグループなし・未知の過去Roundについて期待値を明示。履歴の不整合を推測補完しない。
4. `replace_friendly_round_lineup`で保護を再導出し、偽造/削除した期待値・保護IDで迂回不可とする。参加資格、カード/チーム数、全Round重複、編集権限、得点済み、終了、ロック、CAS、停止スイッチ、操作IDと再試行を維持する。
5. effective/applied/split/eligible/request_body、現在のペア設定、used_fixed_pairs、スコア/戦績は書き換えない。played_ids＋必要な既存revision/操作監査だけを更新。次Round生成が更新した出場・休憩を参照すること。
6. 旧アプリ/新DB：旧画面に保護情報の表示がなくてもDBが固定移動を拒否する。新アプリ/旧DB：従来のRound全体禁止を残し、旧表fallbackや現在の固定設定による独自推測で解除しない。新フィールドによるp_expected差異・開いていた旧POPは既存CASで安全に再読込へ導く。
7. 既存snapshot依存のスコア・削除、生成ラッパー、team/official/guest経路に副作用を入れない。既存Migrationは変更せず追加候補と適用順序/復旧を提示する。

## 必要な隔離検証（候補受領後）

非固定の同一コート/別コート/休憩入替の正例、固定0/複数/片方・両方休憩/解除後の履歴保護、一時停止扱い、固定選手の全移動拒否、偽造HTTP/RPC・権限/終了/得点/資格/重複/不明履歴/CAS/操作ID拒否、再送、途中失敗rollback、再読込と次Roundの公平性、固定履歴・スコア・戦績不変。

現在の既存DB回帰PASSや「固定ありで拒否」の再現PASSを、今回の非固定入替機能の完了とは扱わない。実Auth/HTTPや候補SQLの正負例は別途必要。
