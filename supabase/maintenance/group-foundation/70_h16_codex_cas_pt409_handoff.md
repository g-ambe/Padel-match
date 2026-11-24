# H16 Codex追補：競合エラーをHTTP 409（PT409）へ切替

対象：既存Draft PR #265／`codex/task-08-group-foundation`。2026-11-20。
この文書はGPTのDB/Stage実HTTP検証から判明した追加対応であり、アプリ側コードの変更はCodex担当。

## 何が起きたか

- CodexのH16 UI実装コミット `513876875a42f12413baf234c4274c1e1a94e7ef` をGPTが直接レビューし、既存のDB RPC契約と概ね整合することを確認。
- Stage実JWT/PostgRESTの正負例（公開前の旧linkedを隠す、linked本人保存、確認チェック、他人編集拒否、未連携の管理権限、別グループ隔離、直接UPDATE拒否、公開3列DTOなど）で**14/15ケースがPASS**。
- 唯一の失敗は競合CAS（古い`p_expected_club_display_name`）。従来の`ERRCODE='40001'`はPostgRESTにトランザクション再試行を誘発し、**約2分後HTTP 504/error.code=null**を確認。Supabase公式トラブルシュートにも同事象の案内あり：
  https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
- GPTは**`0056`を変更せず**、前方適用Migration **`supabase/migrations/0057_club_alias_cas_http_conflict.sql`** にてCAS競合を `RAISE SQLSTATE 'PT409'` に変更し、**Stageのみ**に適用済み。こうするとPostgRESTはHTTP 409/error.code=`PT409`を返す仕様。実HTTP再検証は進行中。

## Codex担当の最小修正

1. `AGENTS.md` に従い、**既存ブランチ・PR #265だけ更新**。重複PR/新ブランチ禁止、mainマージ・本番DB・本番デプロイ禁止。DB Migration 0056/0057は編集しない。
2. `lib/club-display-name.ts` の競合エラー判定を `PT409` に対応（必要なら旧 `40001` も互換処理）。40001の再試行をアプリから行わない。競合時の日本語案内はそのまま、確認POP・編集中テキストを保持して最新ロスター再取得へ誘導する。
3. `tests/club-display-name.test.cjs` と `tests/browser/club-display-name.cjs` の合成API競合例を **HTTP 409/code `PT409`** に更新し、検査の意味を維持。追加のAPI呼び出し・関連範囲外の変更はしない。
4. TypeScript、軽量ユニット/合成ブラウザ・Cloudflare互換ビルドを再検証。未修正の既存プロフィールテスト12件は本件で変更せず、ベースライン問題として区別して報告。
5. 既存H16の3列公開DTO、本人と管理者の編集権限、公開確認、NULL旧linked非公開、CAS入力保持、グループ間隔離を変更しない。

DB側の新MigrationはGPTの担当でStage適用済み。本番切替は全P0の移行順・権限ガードが満たされた時点まで保留。
