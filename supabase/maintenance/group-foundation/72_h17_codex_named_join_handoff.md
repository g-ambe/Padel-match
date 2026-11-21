# TASK-08-03／H17：Codex引継ぎ — 加入時の別名・公開同意

2026-11-20。**既存Draft PR #265／`codex/task-08-group-foundation` のみ**。GPTはDBとステージング検証、CodexはアプリUI・テストを担当。0056/0057の従来のH16は変更しない。

## 先に読む正本

- [Issue #264](https://github.com/g-ambe/Padel-match/issues/264) の **2026-11-18「公開グループにおけるグループ内表示名の初期化・提示」**。新規加入時は希望のグループ別名を確認し、公開時に「承認後この表示名がメンバー一覧に表示されます」と明示して本人の確認チェック。仮選手の本人紐付けでは既存の仮登録グループ名（別名があればそれ、未設定なら登録名）を初期値にし、任意編集・本人確認。本人プロフィール名を自動上書きしない。
- [Codex H16実装 `5138768`、PT409更新 `c68dc6a`](https://github.com/g-ambe/Padel-match/pull/265) を保持。H16個別編集は変更しない。
- GPT追加DB Migration **`0058_public_join_alias_consent.sql` → `0059_public_claim_named_alias_gateway.sql` → `0060_named_join_merge_snapshot.sql`**。Stageのみ適用し、全てプロダクション未適用。適用順を変えない。

## Codexが使用するDB契約

**新規加入・公開グループの仮登録選手の本人紐付け申請で、必ず新RPCを使用：**

`public.submit_public_club_claim_named(p_club_id uuid,p_reference uuid,p_message text,p_review_token text,p_club_display_name text,p_public_confirmation boolean)`

すべて明示パラメータ（`p_message`と`p_review_token`は通常新規加入時`null`、仮登録紐付け時はpreviewのtoken）。戻り値は作成した申請UUID。本人ログイン必須。承認待ちの名前は公開名簿には表示しない。

- **通常新規加入**：`p_reference=null`、`p_review_token=null`。本人の正規プロフィール名を初期提案に使うことはできるが**本人が表示名と公開注意書きを確認してチェックした時のみ** `p_public_confirmation=true` を送る。名前は1～120文字、制御文字禁止。
- **既存仮登録選手の本人紐付け**：公開 `get_public_club_directory` からの `reference`（**内部所属UUIDではない**）を `p_reference` に渡す。まず既存の `preview_public_club_claim(p_club_id,p_reference)` で本人が引き継ぐ試合・戦績・在籍の件数と `review_token` を確認する。表示名の初期値は公開DTO `display_name`（従来の仮登録名／登録済みグループ別名）。本人が変更でき、**公開同意チェックが必要**。該当preview/tokenが無効なら申請しない。
- **旧 `submit_public_club_claim` と内部向け `submit_profile_join_request` は今回のH17UIから使わない**。DB旧申請/申請中の互換を維持するため旧RPCは残している。内部向けの `submit_profile_join_request_named` はブラウザから呼び出し不可（authenticated EXECUTE REVOKE）。公開参照を解決する新named gatewayだけ使用。
- **管理者承認は既存 `review_profile_join_request(request_id,'approved'|'rejected'|'cancelled')` を維持**。DBは申請時の希望別名・public同意時刻を `join_requests` に原子的に保存し、承認後の本人の所属レコードに同トランザクションで反映（登録時点で公開しない）。仮登録の本人統合時も既存の引継ぎ・同意snapshot・review_tokenと `profile_link_private.merge_changes` のbefore/after監査を保持する。
- **旧pending加入申請**は名前・同意欄がNULLなので、自動バックフィルも任意公開も行わない。承認後、本人が既存H16の名前編集で同意するまでは公開名簿のlinked名を隠す。
- H17 は**検索からの新規加入/紐付け申請**のみに対応。**管理者発信の `player_profile_link_requests`（招待・受取人が承諾する別ルート）の新しい別名・公開同意は未実装**。このルートへ同じ申請RPCを無理に転用しない。DB担当の次工程で設計する。

## Codexの実装範囲

1. `AGENTS.md` を守り、既存PR #265だけ更新。新規PR/ブランチ、mainマージ、本番DB変更/Cloudflareデプロイは禁止。DB Migration 0058～0060やStage SQLは変更しない。
2. 現在の「公開グループ詳細→メンバー／加入申請／仮選手紐付け」入口を調査し、**通常新規加入と仮登録の本人申請のPOPに、グループ内表示名の確認・編集欄＋公開注意チェック**を追加。既存の共通POP・検証を踏襲。旧加入/本人連携のreview_tokenプレビューと管理者承認は維持。
3. 入力検証とAPIのエラー（42501、期限切れ、公開参照競合、旧token）で**POPと入力を保持**。サーバーへ自動再送しない。承認待ちや申請者名を匿名公開名簿へ誤表示しない。
4. 新規加入は本人正規プロフィール名の初期提案も可だが、本人確認チェックを飛ばさない。仮登録紐付けの初期値は**既存仮登録のグループ内表示名／登録名**。本人のプロフィール名で上書きしない。
5. 本人プロフィール名・他グループ・過去試合/ランキング・H15自主退会・H16個別表示名編集・3タブUI・R2/招待#262・ID#263を変更しない。必要な関連ヘルプのみ同期し、ライト/ダーク375px・失敗時の保持・単体/合成ブラウザをテストする。
6. **Stage実Auth HTTPはGPT側で未実施**。DB内のロール切替を伴う一括ROLLBACK試験`71_h17_named_join_rollback_probe.sql`で正常加入/仮紐付け/本人同意/承認/merge監査を検証した。Codexがアプリ側を実装後、GPTが再度Stage実HTTP受入を計画する。意図せぬ実ユーザー・本番データの変更は禁止。
7. 実装後、変更ファイル、テスト、既存プロフィールテスト12件の扱い（本タスクで修正せず）、DBとの型/API不整合を既存PRへ報告。

**Migration 0058、0059、0060はStageのみ適用済み。Prodは未移行かつ匿名SELECTリスクがあるため、単独デプロイ禁止。**
