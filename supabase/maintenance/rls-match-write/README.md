# セット05：試合データ4テーブルのINSERT/UPDATE（準備済み・本番未適用）

推奨Sol・中。対象padel-hub / ntczrmvffmpjzilfebyi。2026-10-30。
対象はrounds、matches、match_players、match_resultsの作成/更新8操作。現在18/33、適用・確認後26/33。残りは開催eventsのUPDATE1項目とSELECT6項目。
このセットへの明示承認前に本番変更を行わない。SQL・切り戻しを用意し、本番作業はREAD ONLYの定義・権限・件数確認のみ。

## 実操作への影響

| 一連の操作 | 実際の書込みと適用後 |
|---|---|
| 自動/手動のRound生成 | rounds→matches→match_playersへINSERT。在籍中の一般メンバーを含む自グループの運営者は維持 |
| 最初のスコア保存 | match_resultsをINSERT後、matches.completedをUPDATEする2段階。両方維持 |
| 保存済みスコアの修正 | match_resultsをUPDATE。再読込で修正内容が残ることを確認する |
| 手動組み合わせの選手変更 | 既存選手枠のDELETE→4枠INSERT。前セットのDELETEと今回INSERTを組み合わせて維持 |
| 動画URLの登録/解除 | matches.youtube_urlをUPDATE。IDガードに触れない通常項目なので維持 |
| 試合削除後の空Round整理 | DELETEは変更しない。後続Roundの番号を負数へ一時退避→連番へ更新する処理を維持 |
| 他グループの開催/試合への作成・更新 | INSERTは42501、UPDATEは0行で拒否 |
| 別開催のRound/参加者を混ぜた登録 | 同じグループ内の別開催を含めて拒否 |

根拠はapp/events/[id]/page.tsxのcreateRound、createManualRound、saveScore、saveLineupEdit、renumberRoundsAfterDeletedRound、動画URL更新。app/lib内で対象4テーブルを書き込む経路はこの開催画面に集約されている。サーバーのRound生成APIは組み合わせ計算で、DB更新は画面から行う。

既存のDELETE条件と同じ開催単位の許可範囲をINSERT/UPDATEに適用する。認証UID必須・未削除開催・旧profile_idまたは連携済み選手からの有効所属を判定する。メイン/サブ管理者だけに絞らず一般メンバーも許可する。グループなし開催の作成者、既存スーパー管理者、チーム側管理者の経路も維持する。
無効所属、所属なし、他グループのみ所属、他人のグループなし開催、UIDなしは拒否する。匿名は既存テーブルGRANTでも書込み不可。
終了済みだが未削除の開催に、新たなstatus制限は加えない。現在の許可範囲を維持する。画面の編集可否は別判定。

## 参照整合性と前提

- rounds：実在する許可対象開催への紐づきが必要。
- matches：実在するRoundを必須とし、Roundのevent_idと試合のevent_idが一致すること。
- match_players：実在する試合と参加者が必要で、同じ開催であること。
- match_results：実在する許可対象試合への紐づきが必要。
- UPDATEはUSINGとWITH CHECKの両方に同じ条件を置く。既存のID/親参照ガードも維持し、付け替えを拒否する。
- matches.round_idは構造上nullableだが、現在のアプリはRoundを作ってから試合を作る。本番ではNULL0件、他の対象親NULL/不一致も0件を確認した。新しい試合にRoundなしを許可しない。もし適用直前にNULL/不一致があれば停止し、データを自動修復しない。
- 新しいトリガーや関数は作らない。前セットの6つのIDガードが有効であることを前提とする。

前セットまでに適用したDELETE・TRUNCATE・IDガードは維持。SELECTの許可範囲は今回変更しない。グループを探す・共有・戦績の読み取り制限は後続セットで扱う。events UPDATEも今回の対象外であり、全ての書込み制限が完了したとは扱わない。

## SQL・切り戻し

apply.sql：4テーブルの全ポリシー・直接ACLを完全一致で比較、RLS有効、4件の試合IDガードと開催/参加者IDガード、その関数定義、既存の親参照NULL/不一致を確認する。INSERT/UPDATEの互換ポリシー8本を認証済み向けの条件付きポリシーへ置換する。DELETEとSELECTは触らない。GRANT、テーブル構造、制約、既存行、関数・トリガーも変更しない。

rollback.sql：適用後の全ポリシーとACLが検証時の定義に一致する時だけ、今回8本を元の互換ポリシーへ戻す。前セットのDELETEやIDガードへ影響しない。戻すと既知の広い作成・更新許可も復活する。

どちらも対象4テーブルを一定順序でロックする単一トランザクション。lock_timeout3秒、statement_timeout15秒。途中コミットや無保護時間を作らない。

verify.sql：適用前後の5テーブル（参加者も含めて不変確認）のポリシー・ACL・実効権限・件数・RLS、トリガー、既存の認可/本人連携/IDガード関数、参照制約、他表のACL/ポリシーをREAD ONLYで比較する。preflight-integrity.jsonも再取得して6つのガードが有効と確認する。本番で試し書きやDELETE/UPDATE→ROLLBACKテストは行わない。

## 検証：169項目成功

実マイグレーション0001〜0039と適用済みの参加者制限・IDガード・削除セットをPGlite0.3.14（PG17系）へ再現。本番の既存ポリシー・ACLと一致する合成DBで、実際のapply.sql/rollback.sqlを実行した。

専用164項目：
- 新旧の一般メンバー、メイン/サブ管理者、本人の別グループ、グループなし作成者、スーパー管理者の4表×作成/更新。
- 他グループ、無効所属、所属なし、他人のグループなし開催、削除済み開催、UIDなしの4表×拒否。匿名のGRANT拒否。
- 別グループ・同じグループ内の別開催のRound/参加者混入、NULL/存在しない親、親参照のUPDATEによる変更を拒否。
- 終了済み開催、チーム側管理者、一般メンバーの参加者4名追加→Round/試合/4選手枠→スコア保存/修正→completed/動画URL更新→4選手枠再登録→Round番号の二段階更新→試合/空Round削除。
- 複数行INSERTに他開催の参加者が混ざると全体が原子的に失敗。複数行UPDATEは自分のグループの行だけ更新し、他グループは不変。
- service_roleメンテナンス、匿名の共有型参照、前セットのDELETE/参加者DELETE拒否/TRUNCATE拒否を維持。
- 適用時の行不変・ACL/トリガー不変、事前定義/無効ガード/NULL Roundでの停止、切り戻しのドリフト停止と完全復元、再適用。

関連する本人連携の実SQL5項目も、今回までの全セットを重ねて成功。本人承認による2グループ統合、同意付き加入、通常加入、統合前参照への手動復旧、復帰済み仮選手の統合。
この古いテストのseedではRoundを省略していたため、この任意テストモードに限り合成試合へ対応Roundを作り、現在の本番の「Roundなし0件」と同じ前提に揃えてから今回SQLを適用した。実データは一切変更していない。

検証はローカル合成データだけ。test-results.json、integration-test-results.jsonを保存。アプリ実装は無変更で、TypeScript/Next.js/Cloudflareビルドは今回は実施していない。生成アルゴリズム自体の再実行ではなく、画面が行うDB書込み順とRLS許可/拒否を検証した。ブラウザの実操作は承認後の本番適用後に確認する。

```powershell
node supabase/maintenance/rls-match-write/test-local.cjs
$env:PADEL_PARTICIPANTS_WRITE_TEST='1'
$env:PADEL_MATCH_DELETE_TEST='1'
$env:PADEL_MATCH_WRITE_TEST='1'
node --test --test-name-pattern='本人承認でA・B|本人が仮選手を選んだ加入申請|通常の加入申請は|監査からの手動復旧は|復帰した仮選手の本人承認' tests/profile-linking-db.test.cjs
```

## 適用後の必須画面確認案

一般メンバーで、前回の確認用開催を使って2経路にまとめる。既存の本番記録を書き換えず、確認用に作った試合だけを使う。

1. 自動組み合わせ：新しいRoundを生成し、4選手枠があることを確認。スコアを保存→別の値に修正→再読み込みし、修正したスコアが残ることを確認。動画URL欄を普段使う場合は確認用URLを登録/解除する。
2. 手動組み合わせ：新しい試合を作成→未採点のまま組み合わせ編集で選手変更→保存→再読み込みし、4枠と変更が残ることを確認。

自動生成が止まる、試合/選手枠が欠ける、スコア修正が残らない、組み合わせ編集が保存できない場合は次工程を止めて本セットだけを切り戻す。他グループへの実データ操作、本人連携/統合の本番テストは不要。

本番適用と確認後26/33（残り7）。閲覧6操作と開催更新1操作は別セットとして、共有/戦績/開催運営への影響を検証する。

参考：[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。changelog.mdはWebツールのContent-Type制約で取得不可。新API追加はせず、現行DB定義と実PostgreSQLで検証した。
