# TASK-08 / H39：改修仕様・アプリ／DB進捗・本番切替順の統合台帳

確認日：2026-11-21（JST）。正本：親 [#215](https://github.com/g-ambe/Padel-match/issues/215)、子 [#229](https://github.com/g-ambe/Padel-match/issues/229) / [#262](https://github.com/g-ambe/Padel-match/issues/262) / [#264](https://github.com/g-ambe/Padel-match/issues/264)。実装：既存Draft [PR #265](https://github.com/g-ambe/Padel-match/pull/265) の `codex/task-08-group-foundation`。画像関連は [#241](https://github.com/g-ambe/Padel-match/issues/241)。将来の任意10文字英数字ID [#263](https://github.com/g-ambe/Padel-match/issues/263) は **TASK-07-04、TASK-08とは別**。

> **判定：TASK-08は未完了。** 作業ブランチへの実装、StageのRPC試験、PRマージ、本番SQL適用、Cloudflareデプロイ、実機検証は別々の状態として読むこと。Issue本文の「未着手（2026-11-18）」などの過去履歴を現状の判定に使わない。修正に関しては最新コメント／実ソースと本台帳を優先する。本書は本番リリース承認ではない。

## 1. 子タスク全体

| 子タスク | 正式スコープ | 現状／次の担当 |
| --- | --- | --- |
| TASK-08-01 #229 | 現行グループ機能、API/RLS、名前、退会、画像、戻り導線、招待/ID設計依存の調査 | 一次棚卸し・H20/H25/H36〜H38の実装差分調査は進捗。実Authと本番互換の確認は残る。GPTで調査/DB照合 |
| TASK-08-02 #262 | 名前だけの仮登録、メール任意招待、登録済/未登録分岐、本人承諾、管理者再承認不要、拒否・再送等 | **要件合意、メール送信のアプリ・DB・通知フロー未実装**。別工程。Codexアプリ＋GPT DBで着手判断 |
| TASK-08-03 #264 | 概要/メンバー/戦績3タブ、公開範囲・所属名、退会/オーナー承諾、POP/戻り、同グループ写真 | **アプリ主要部分はDraft PR #265へ実装**。StageでRPC/権限を限定検証。本番DB移行・本番配信なし。**同グループ写真は未実装** |
| 参考 #263 | 任意10文字英数字アカウントID | **TASK-07-04**。DB影響の調査は#229と共有、アプリ/API/発行はTASK-08の完了対象に混ぜない |

## 2. 変更ごとのアプリ／DB対応表

「アプリ実装済」＝PR #265のブランチにソースあり、**本番には未配信**。「Stage実装済」＝Stage DB導入・限定SQL/HTTP試験済で、**本番導入とは別**。

| 改修内容（仕様） | アプリ側・Codex側 | DB/API側・GPT側 | 未完了／注意 |
| --- | --- | --- | --- |
| 公開グループの安全な取得（未所属は名前・未連携だけ、役職/プロフィール名/戦績は非公開） | `app/groups/[id]`, `lib/group-read.ts` で用途別RPCへ変更、未所属は戦績/内部申請を取得しない | `0054`, `0055`、Stageの限定列・認可RPC、Stage匿名基底表制限 | Prodの匿名 `club_members` 等は直接SELECT可能。新RPCはProdに無い。リリース同時切替が必要 |
| グループ詳細3タブ「概要／メンバー／戦績」 | H21：3タブ、共通POP、設定「…」、開催直近3件、ランキング個人/ペア/開催と総合pt説明、375px合成ブラウザ済 | 既存所属者向け開催/戦績の読取、用途別`0054/0055`を利用 | Prod RPC未導入、実機・全統合未完了 |
| 1人1行のメンバー・公開人数 | H21/H22：内部名簿と公開名簿を分離、公開未所属の人数は専用RPC・失敗時「不明」 | `0065` の `get_public_club_member_count` Stageで検証 | Prod導入前。非公開グループ/未ログインは対象外 |
| グループごとの表示名（連携済みは本人のみ、未連携は権限内の管理者） | H16：編集共通POPと保存処理、CAS/PT409、本人プロフィール名は不変 | `0056` / `0057` Stage導入。Prod互換候補 `138_h38_prod_alias_atomic_cutover_candidate.sql` | Prod `club_members` anon表SELECTが元0056と衝突。匿名権限切替とDDLを同じトランザクションにする |
| 加入時の希望名・公開同意、未連携選手との本人紐づけ | H17：公開申請・既存仮選手の確認POP、連携後の本人名・公開同意確認 | `0058`〜`0060`、Stage専用named RPCと申請後のalias保持 | Prod未移行。通常加入では従来の管理者承認を維持（招待#262と別） |
| 管理者からの本人連携依頼を受ける画面 | H18：本人が選ぶグループ名・公開同意＋既存の引継ぎ同意を維持 | `0061`、Stageの本人限定DTO/申請情報。Prod向け `139_h38_prod_link_scoped_preview_candidate.sql` | Prod旧詳細RPCは全行JSON、scoped helper欠落。0061前の限定切替が必要 |
| 本人自主退会（履歴保持、本人以外は不可、最終main保護） | H15：本人確認POP、退会後マイページへ、旧オーナーは引継ぎ後のみ | Stage `leave_my_club` 検証済。Prodは既存`guard_group_last_main_admin`を活用し、`136` status bridge → `137` 本人退会候補 | Prodの本人退会RPC未導入、二重ガードの無条件移植禁止 |
| オーナー引継ぎは候補本人が承諾・辞退、依頼取消/通知 | H19：候補・受信者確認画面、POP/通知・競合表示/キャンセル | Stage `0062`〜`0064`、実Auth・ROLLBACKの承諾/辞退・拒否検証済 | Prodにはowner-request表/RPCなし。`136/137`で前提を揃えてから導入 |
| マイページ／検索／通知／イベントからの戻り先 | H21：入口・タブ・スクロール・POP階層を復元、`/groups`旧導線を調整 | 基本はDB追加不要 | 実機の戻りと保存中断・例外経路は最終確認 |
| 通常・チーム／混合・公式戦の匿名共有結果 | token専用RPCを利用した共有画面へ移行、旧基底表fallbackなし | Stage `get_shared_event`。Prod追加候補は `54_h12_prod_compatible_rpc_candidate.sql` | H34実HTTP/Chromiumは限定成功。本番RPC欠落と本番旧匿名基底表の広い読取が残る |
| 共有動画クリック（通常試合・開催動画・公式動画） | 新token-bound RPCへ切替、H34 3種類ブラウザ受入成功 | Stage H31/H33/H35済、検証fixture回収済。Prod追加 `133_h37_prod_video_click_additive_candidate.sql`、公開後に旧RPC匿名停止H35 | Prodに新3RPC無し。旧RPC匿名EXECUTEを先に止めない |
| グループ戦績・過去の退会者/スコア/GP | H21は画面構成変更。既存の70/20/10総合pt、3試合未満参考、勝率順位など維持 | H14既存データ監査、統計の用途別取得 | 旧スコア例外6件を未判定で自動変更しない。Stage/Prod認証済みの主要戦績回帰が残る |
| 同グループ在籍者のみのプロフィール画像（未所属には標準アイコン） | **未実装**：現`memberButton`は標準SVGアイコンのみ。既存の本人専用画像APIは維持 | **未実装**：本人専用R2/APIを拡大せず、同グループ在籍のみの配信認可＋退会時失効が必要 | #264の確定要件。PR #265がマージされてもTASK-08-03を完全完了とはできない。別工程のCodex/API+DB/R2対応が必要 |
| 未所属への直近開催3件 | **未実装**：現在は「開催情報は所属後に確認できます」 | **未実装**：公開開催掲載同意、掲載対象・公開DTOの仕様確定後 | 所属者の直近開催は実装済。未所属の「概要で公開開催」要件は別途設計判断 |
| 仮メンバーのメール招待、後からの招待、再送・拒否 | **未実装**：#262で要件確定、メール送信/API/POPは別工程 | **未実装**：メール・token hash・期限・本人承諾状態の保護保存が必要か設計 | TASK-08全体の残件。既存の通常加入の管理者承認とは区別 |
| 任意10文字英数字ユーザーID | 今回のPRでは実装対象外 | 将来への設計影響だけ#229で確認 | #263/TASK-07-04として別管理 |

## 3. 試験済みと未完了を区別

**確認済み**：H15自主退会・H19オーナー引継ぎのStage SQL ROLLBACK正負例、H16〜H22の該当範囲の軽量unit/375px合成ブラウザ、H34の通常/チーム/公式の実HTTPとChromium共有画面・クリック3種成功、H35 Stageテスト行回収と旧クリックRPC匿名権限停止。H36〜H38ではProdをREAD ONLY確認、SQL候補はStageトランザクション試験。

**未確認**：PR全体の全テストPASS／本番とStageの全スキーマ互換／固定ペア・画像・施設・通常/チーム/公式運営の本番切替後回帰／アプリ本番配信／実機。既存プロフィールテスト12件の不整合は別に把握。H34共有リンク成功だけでTASK-08全体成功とは扱わない。

2026-11-21の読み取り専用集計：
- **Stage** `padel-hub-staging`：clubs 3、memberships 12、events 0、official 0、Migration履歴74。新token/roster/member-count/withdraw/owner RPCは存在、匿名`club_members` SELECTなし。
- **Prod** `padel-hub`：clubs 13、memberships 41、events 91、official 4、Migration履歴22。上記主要新RPCは未導入、匿名`club_members` SELECTあり。Prod固定ペア/画像/施設既存データを保持する。

## 4. 本番切替の依存順（実行しない手順書）

| ゲート | 順序・実施単位 | 切替条件・失敗時 |
| --- | --- | --- |
| 0. 現状記録 | `132`, `135`, `140` の既存READ ONLY、実体/列/関数・件数確認 | 既存利用データの非変更、Prod新RPC未導入を確認 |
| 1. 追加契約 | `54_h12_prod_compatible_rpc_candidate.sql` → `133_h37_prod_video_click_additive_candidate.sql` → `0054` → `0055` | 共通RPC追加。ただし各SQLはまだProdに適用しておらず、全DDL/認可の本番互換・正式移行番号が必要。旧匿名SELECT/旧RPCは維持 |
| 2. 退会前提 | `136_h38_prod_last_main_status_bridge_candidate.sql` → `137_h38_prod_self_withdraw_candidate.sql` | Prod既存ガードを残し、statusのみ補足。失敗時は旧退会ルートを拡張せず停止 |
| 3. 同時切替 | `138_h38_prod_alias_atomic_cutover_candidate.sql`（`club_members`匿名SELECT REVOKE＋元`0056`を単一BEGIN/COMMIT）→ `0057` → `0058` → `0059` → `0060` → `139_h38_prod_link_scoped_preview_candidate.sql` → `0061` → `0062` → `0063` → `0064` → `0065` | **旧画面との互換が変わる区間**。短い切替窓・異常時の配信/DB復旧順と実HTTP/運営動線を揃える。候補は本番適用許可ではない |
| 4. 新UI公開 | DB契約成立を確認後、既存PR #265をレビューしてCloudflare公開 | Stage実Auth・通常/公式/チーム・固定ペア・プロフィール画像本人操作・グループ・戦績の主要動線検証、ユーザーによる本番承認 |
| 5. 後処理 | 新共有UIが動作した後、`20261121131943_task08_h35_legacy_video_click_anon_close.sql` で旧3クリックRPCの匿名EXECUTEだけ停止 | 旧関数自体は残す。その他の匿名基底表権限も、対応する画面を確認した対象だけ切替。無差別`db push`や一括REVOKEをしない |

**STOP**：ゲート3の途中でDBと旧UIの契約が合わなくなるときは、アプリを単純に旧版へ戻すだけでは復旧しない可能性がある。実行前にどの変更が可逆か、旧アプリ利用可能な期間、実確認する合成/許諾済みイベントを固定してから判断する。マージや本番DDLはユーザーの明示的なリリース承認を得て行う。

## 5. 今後の担当別優先作業

| 優先 | 担当 | 必要な作業と完了条件 |
| --- | --- | --- |
| P0 | GPT / DB | `0054〜0065`とH37/H38候補の連続依存、権限切替順・復旧方法を本番互換の小さな実施単位に確定。Prodへ無断適用しない |
| P0 | Codex / アプリ検証 | **新機能追加ではなく**現在のPR #265に対する実Auth＋代表操作の回帰、配信バージョン/移行前後互換確認。新しいPRを作らない |
| P1 | Codex＋GPT（別工程） | #264の**同グループ在籍者プロフィール写真**。現在未実装なので、DB/R2認可/APIと一覧画像を確定仕様どおり実装・試験 |
| P1 | GPT＋Codex（仕様確定後） | 公開未所属者向け直近開催の掲載同意/対象・最小DTOとUI（現在は未公開） |
| 子タスク | #262の担当 | メール招待（仮登録後追加、登録済/未登録、本人承諾、拒否・再送、本人同意後の管理者再承認不要）を別工程で実装 |
| 別タスク | #263 | 任意アカウントコード。TASK-08のリリース条件に含めない |

## 6. 運用ルール

- Issue/PRの既存リンクを保持し、**既存PR #265だけ更新**。AGENTS.mdを遵守し、重複PR、新規ブランチ、無関係なアプリ改修を行わない。
- 大きな機能追加より、現在のユーザー確定仕様と既存機能維持を優先。戦績/GP、スコア、固定ペア等を勝手に変えない。チュートリアル/ヘルプはUI変更時の関連箇所だけ同期。
- DB本番とCloudflareは本書作成時点で未変更。**今回の作業範囲は棚卸しと手順の整備、GitHub記録のみ**。

## 7. H40追記：本番移行の実態・段階的ゲート（2026-11-21）

**新規SQLと最終検証記録**：`143_h40_prod_release_impact_readonly.sql`（利用者影響）・`144_h40_prod_preservation_snapshot_readonly.sql`（Prod件数保全）・`145_h40_prod_phase2_atomic_cutover_candidate.sql`（0056〜0065を単一トランザクション候補へ統合）・`146_h40_release_order_restore_and_decision.md`（実行/復旧手順）。

- Prod有効グループ3件、うち公開2件・公開所属14名（linked4、未連携10）。旧Linked4名は0056導入後、**本人公開同意がないため名簿からいったん省かれる**。所属人数自体は14。無断公開バックフィルはしない。
- Prod有効グループのうち1件は`owner_id`が現役main_adminの所属に対応していない。現役main_admin自体は各有効グループに存在する。**ownerを自動修正しない**。当該グループのオーナー引継ぎには別途個別確認が必要。
- Prod固定ペア関連：state10、pairs2、rounds78、画像object1、通常試合521/結果351。本人データ・戦績・写真を変更しない件数照合として保存。
- 145候補：前提となるRPC追加後に、138→0057→0058→0059→0060→139→0061→0062→0063→0064→0065の**11原本（sha固定）をBEGIN/COMMIT一組に集約**。コミット前の失敗は全てROLLBACKされる。**COMMIT後に旧アプリを戻すだけでは修復できない可能性を明記**。
- Prod migration履歴22件 vs Stage74件。**ソースMigrationの登録/二重適用防止方法未確定のため本番NO-GO**。自動`db push`不可。Cloudflare配信手順も現物で確定してから公開する。
- **H40は追加開発ではなく本番リリース準備。** DBはREAD ONLYのみ、GitHub既存PR #265に候補を保存。各ソースの部分的Stage ROLLBACKテストが通ったことと、**本番スキーマでの11連続DDLが通ったことは別**。本番適用・PRマージ・Cloudflare公開なし。

**Cloudflare実トリガーの追記**：本番`padel-match`はGitHub `main`を自動デプロイ（`npm run cf:build` → `npx wrangler deploy`）、Stage `padel-match-staging`は`codex/minimal-security-replacement`を自動ビルド対象としており、**PR #265の`codex/task-08-group-foundation`ではない**。確認はCloudflare API GETのみ。詳細と復旧上の注意は`146_h40_release_order_restore_and_decision.md`。公開前にStageプレビューとProd DB切替の整合が必要。