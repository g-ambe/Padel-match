# セット04：5テーブルのDELETE（準備済み・本番未適用）

推奨Sol・中。対象padel-hub / ntczrmvffmpjzilfebyi。本番適用は本セットへの明示承認後。
対象はevent_participants、rounds、matches、match_players、match_resultsのDELETE各1項目。現在13/33、適用・確認後18/33。補助ガードやTRUNCATE撤回は重複計上しない。

## 一連の実操作への影響

- 自動組み合わせの試合削除はapp/events/[id]/page.tsxでmatch_results→match_players→matchesの順に削除し、空のRoundを削除して後続Roundの番号を振り直す。4テーブルの権限をまとめて制限し、この処理を維持する。
- 手動組み合わせの選手変更は、未採点の試合の古いmatch_playersをDELETEしてから新しい4枠をINSERTする。DELETEの制限を変えると選手変更にも影響するため、検証対象に含める。
- グループの在籍中の一般メンバー、メイン/サブ管理者は自グループの試合を削除できる。旧profile_idと連携済みplayer_profile_idの両経路を維持。
- グループなし開催は作成者、既存スーパー管理者は既存is_super_user、チーム開催は既存can_manage_friendly_team_event_by_sidesの判定も維持。公式戦やevent_team_matchesは今回の変更対象外。
- 他グループのみ所属・所属なし・無効所属・UIDなしはDELETEが0行。匿名は既存GRANTでもDELETE不可。
- 削除済み開催の子の削除は許可しない。終了済みだが未削除の開催は既存の許可範囲を維持（UIの操作可否は別）。
- event_participantsの物理DELETEはapp/lib内で使われていない。参加状態の変更はUPDATE、開催削除はeventsの論理削除なので、WebロールのDELETEを停止する。スーパー管理者画面もauthenticatedのため同じ扱い。本人連携・管理者DBメンテナンスの経路は維持。
- SELECT/INSERT/UPDATEのRLS範囲は今回変更しない。ただし補助ガードでID/親参照のUPDATEだけ禁止する。スコア・動画URL・Round番号・completed等の通常更新は維持。

## 補助ガードが必要な理由

DELETEだけを自グループに絞っても、既存のUPDATE許可で他グループのRoundや試合のevent_id等を先に付け替えると、削除制限を回避できる。4テーブルのIDと親参照をWebロールから変更不可にする。

| テーブル | 変更不可にする列 |
|---|---|
| rounds | id,event_id |
| matches | id,event_id,round_id |
| match_players | id,match_id,participant_id |
| match_results | id,match_id |

match_playersの選手変更はUPDATEではなくDELETE→INSERTなので維持できる。eventsと参加者のIDガードは前セット適用済みを前提とする。新ガードはSECURITY INVOKER、search_path空、非公開スキーマ内でWebロールにUSAGE/CREATE/EXECUTEを与えない。SECURITY DEFINERの本人連携/復旧とservice_role・管理者メンテナンスは対象外。

親Round/試合のCASCADEは子の個別DELETEポリシーを迂回し得るため、親を含めた同一セットにする。現行のrounds→matchesの開催不一致とmatch_players→参加者の開催不一致は本番READ ONLY集計で0件。apply.sqlでも不一致があれば停止する。行の修復・削除は行わない。

4テーブルのTRUNCATEをanon/authenticatedから撤回する。通常Web機能は使わず、RLSの行条件では保護できないため。service_roleは維持。参加者のTRUNCATEは前セットで撤回済み。

## 変更SQLと切り戻し

apply.sqlは5テーブルの全ポリシーと直接ACLを完全一致で確認し、RLS有効と親参照整合性も確認する。対象5テーブルを一定順序でロックし、BEGIN/COMMIT、lock_timeout3秒、statement_timeout15秒で原子的に適用する。

rounds/matches/match_players/match_resultsはdev_allをDELETE制限とSELECT/INSERT/UPDATE互換ポリシーへ分割する。参加者はDELETE互換ポリシーを削除し、anon/authenticatedのDELETE GRANTを撤回する。

rollback.sqlは適用後のポリシー/ACL/4テーブルのトリガー/ガード関数の定義を完全比較し、一致時だけ元に戻す。新規のポリシーや権限を上書きしない。元の広いDELETEとTRUNCATEも復活するので、障害時の一時復旧として使う。CASCADEなしで新ガードだけを削除する。データは変更しない。

verify.sqlは件数、実効権限、ACL、ポリシー、トリガー、参照整合制約、既存の認可/本人連携/IDガード関数、他テーブルのACL/ポリシーをREAD ONLYで比較する。本番でDELETE/UPDATE/TRUNCATEの試し打ちはしない。適用直前にメタデータが変わっていれば停止する。新スキーマが既存の場合もCREATEで原子的に停止する。

現在の本番件数はpreflight-verification.jsonへ保存（参加者522、Round251、試合400、選手枠1600、結果364）。前セット以降の通常利用で増えた参加者を含む。件数は適用直前にも再取得する。

## 検証結果：98項目成功

専用93項目。実マイグレーション0001〜0039、適用済みの参加者/開催IDガードと参加者INSERT/UPDATEを合成DBへ再現し、5テーブルのポリシー・ACLが本番と一致することを確認して実行した（PGlite 0.3.14、PG17系）。

- 新旧の一般メンバー/メイン/サブ管理者、グループなし作成者、スーパー管理者による4テーブルのDELETE許可。
- 他グループ/無効所属/所属なし/UIDなし/他人のグループなし開催/削除済み開催の4テーブルDELETEを0行で拒否。
- 参加者DELETE拒否、匿名DELETE拒否、4テーブル×2ロールのTRUNCATE拒否。
- 4テーブルのID/親参照変更を42501で拒否。前提のevents/参加者の付け替えも拒否。
- RoundのCASCADEで自グループの子だけ消え、他グループの親を削除しようとしても全子が残る。
- 一般メンバーとして参加者4名追加→Round/試合/4選手枠の作成→スコア保存/修正→選手枠の削除/4枠再登録→結果/選手枠/試合/空Round削除。
- Round番号の二段階更新、動画URL、completed、終了済み開催、round_idなし旧試合、スーパー管理者の既存経路。
- service_roleのID更新と参加者削除、匿名の共有型参照、ガード関数への直接アクセス禁止。
- 既存行不変、ドリフト時の停止、切り戻しによる正確なポリシー/ACL/トリガー/挙動の復元、再適用。

関連する本人連携の実SQL5項目も今回の制限下で成功。本人承認による2グループ統合、同意付き加入、通常加入、統合前参照への手動復旧、復帰済み仮選手の統合。

検証は全てローカル合成データ。本番ではメタデータと件数の読み取りのみ。アプリのランタイムコードは無変更なのでTypeScript/Next.js/Cloudflareビルドは未実施。実際のブラウザ/APIによる確認は本番適用後。

```powershell
node supabase/maintenance/rls-delete-batch/test-local.cjs
$env:PADEL_PARTICIPANTS_WRITE_TEST='1'
$env:PADEL_MATCH_DELETE_TEST='1'
node --test --test-name-pattern='本人承認でA・B|本人が仮選手を選んだ加入申請|通常の加入申請は|監査からの手動復旧は|復帰した仮選手の本人承認' tests/profile-linking-db.test.cjs
```

## 本番適用後の実操作確認案

今回作る確認用の試合だけを使い、既存の本番記録を削除しない。一般メンバーで次の2経路にまとめる。自動/手動で画面に出る操作が違うため2経路が必要。

1. 自動組み合わせの確認用開催（1コート）で2Round作成。最初の試合に確認用スコアを保存してからその試合を削除。試合と結果が消え、空Roundが整理され、残るRound番号が1になることを再読み込みで確認する。
2. 手動組み合わせの確認用開催で未採点の試合を作り、組み合わせ編集で選手を入れ替えて保存。再読み込み後も4枠と新しい組み合わせが残ることを確認する。

他グループの実データにアクセス/削除を試す必要はない。参加者物理DELETE停止、TRUNCATE、付け替え拒否はDBの合成テストと本番のメタデータ確認で検証する。ユーザー確認が終わるまで次の本番RLS変更へ進まない。

閲覧・追加・通常更新の広いポリシーは対象表にまだ残っている。今回のDELETE制限だけでRLS全体が完了とは扱わない。
