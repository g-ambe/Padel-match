# TASK-08-03 / P0：取得・権限分離（実装前ゲート）

仕様：[#264](https://github.com/g-ambe/Padel-match/issues/264)、[設計コメント](https://github.com/g-ambe/Padel-match/issues/264#issuecomment-6975098709)、調査：#229。
ブランチ：`codex/task-08-group-foundation`。PR #261には混在させない。

## 現在の成果物

この段階の変更は**カタログの読み取り専用監査ツールのみ**。アプリ取得処理、既存GRANT/RLS、関数、保存処理は変更していない。Migrationも未追加。P0の公開範囲分離は未実装で、既存の広いSELECTのリスクは残る。

- `01_preflight.sql`：BEGIN READ ONLY、タイムアウト、対象表の列・RLS・表/列GRANT、限定した関連関数の所有者/search_path/ACL/定義、Migration履歴をカタログから取得。アプリ行は読まず、ROLLBACKで終了。
- `read_catalog.py`：既存の対象プロジェクト/TLS/公式CA指紋検証を再利用。生のクライアントエラー・接続値は出力しない。関数定義はSHA-256へ置換し、内部メタデータをログへ出さない。
- `.github/workflows/task08-catalog.yml`：指定ブランチの対象監査ファイル変更時だけ実行。既存Secret/固定PostgreSQLクライアントを利用し、証明書検証を無効化しない。監査結果は1日保持のartifactへ保存。アプリのデプロイや変更SQLは実行しない。

実行済み監査：[Run 44293556005](https://github.com/g-ambe/Padel-match/actions/runs/44293556005)、head `32a4011e2b266fdf77dcdb7db6a746e347545a0d`。ジョブは成功したが、作業環境からartifact配布先へ接続できず、**監査結果の照合は未完了**。ジョブ成功を現物スキーマ整合性PASSやP0権限分離の安全性PASSとは扱わない。

## 停止理由

作業環境からは公式CA配布元へ到達できず、DBホストの名前解決も失敗した。OSの証明書・ホスト名検証も有効なまま試したが接続できなかった。既存Actionsの接続手順による安全な読取監査は成功したものの、GitHub Actions artifactのダウンロード先が403で、結果を照合できない。
内部メタデータを公開ログへ出力する変更は自動承認レビューで却下され、**未pushのまま撤回**。公開ログ出力、TLS検証の無効化、秘密値の公開による迂回はしない。

新鮮な現物定義を照合できない状態でMigration/取得先変更を確定しない。既存SELECT権限を先に閉じない。権限切替の実SQL負例・互換性試験は未実施で、安全性を保証せず、このゲートで保留する。

## 依存調査（静的・今回確認）

| 用途 | 既存の主な参照箇所 | 切替時に守ること |
| --- | --- | --- |
| 公開/内部名簿・加入 | `app/groups/[id]/page.tsx`, `lib/profile-links.ts` | 別DTOと匿名化した申請参照。現行連携プレビューからも他グループ役職/IDを漏らさない |
| 本人所属/検索/作成 | `lib/member-groups.ts`, `app/groups/{discover,new}/page.tsx`, `lib/player-profiles.ts` | 本人所属・初期メイン管理者作成・正規プロフィール判定を維持 |
| イベント候補/出欠 | `lib/event-participants.ts`, `app/events/[id]/page.tsx`, `app/team-matches/[id]/page.tsx` | 操作可能なイベントに限る最小候補、チームA/B別認可、既存0044/0045と互換 |
| 名前・匿名共有 | `app/share/events/[token]/page.tsx`, `app/share/official-events/[token]/page.tsx` | 有効トークンのイベント限定の名前解決。グローバルなプロフィールSELECTを残さない |
| 戦績・公式・管理 | `lib/stats-history.ts`, `lib/official-matches.ts`, `app/super-admin/page.tsx` | 集計入力/式・退会者履歴・既存管理権限を維持 |
| 本人連携・統合 | `0039_player_profile_consent_linking.sql`, `lib/player-profiles.ts`, `lib/profile-links.ts` | UUID/FK、本人同意・snapshot・競合停止・既存権限を維持 |

## 次工程（未実装）

1. artifactを取得し、現物スキーマ・表/列ACL・関数所有者/ACL/search_path/ハッシュを照合。不一致は実定義を安全に確認するまで停止。
2. 最新採番を確認して追加Migrationを作成。公開ディレクトリ、内部名簿、本人所属、イベント候補、トークン限定選手名、権限内戦績の取得RPCを追加。既存名の一括移行や編集は今回行わない。
3. 利用側を移行し、プロフィール連携の既存RPCを含め内部列の流出と既存機能の互換性を確認。
4. 旧公開SELECTの切替は別段階にし、anon/未所属/別クラブ/退会者の負例、同所属/管理者の正例、直接SELECT・列指定・埋込・既存RPCの迂回を隔離DBで試験。新取得経路だけの負例成功で旧経路の漏えい解消を宣言しない。
5. 関連単体・SQL試験、既存共有/スコア/編成/統計の互換性、TypeScript、Cloudflare互換ビルドを実行してからDraft PRを拡充。本番SQL適用・マージ・デプロイは禁止のまま。

自主退会、グループ別名編集、一括名移行、R2他人画像API、招待、10文字ID、UI3タブ改修は本P0に混ぜない。

## 今回の検証

`python -B -m unittest discover -s supabase/maintenance/group-foundation -p 'test_*.py' -v`

監査ツールのREAD ONLY/CA必須/ログ非開示/定義ハッシュ化/失敗時停止を合成応答で検証する。**DBの権限負例テストとは異なる**。
アプリの型検証・Cloudflareビルド、実SQLの権限切替/機能互換性テストは未実施（機能実装前のゲートで停止）。本番スキーマやデータを変更したことはない。
