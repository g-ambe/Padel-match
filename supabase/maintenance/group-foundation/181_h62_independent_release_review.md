# TASK-08-03 / H62 独立リリースレビュー（2026-11-24 JST）

対象：親 [#215](https://github.com/g-ambe/Padel-match/issues/215)、子 [#264](https://github.com/g-ambe/Padel-match/issues/264)、既存 **Draft [PR #265](https://github.com/g-ambe/Padel-match/pull/265)**、`codex/task-08-group-foundation`。

## 総合判定：NO-GO

**H63へ進まない。** 正式SQLの再現性・原子性の証跡は確認できたが、認証済み未所属者の旧直接SELECT境界に反例がある。配信経路、直前バックアップ/R2復旧、最新本番カタログにも未確認条件が残る。重大なSQL・権限修正はDB担当との独立レビューを先行させる。本レビューでは修正しない。

- レビュー対象HEAD：`fca781bbbf2423cb22d6ece73840f362b9ffb256`。
- 比較main：`f914d1baa23c65f6fb016e6f657ba7161d978ce7`。mainと作業ブランチのAGENTS.md、Issue最新コメント、180 runbookを確認。
- 本番/StageのSQL・データ・R2の変更、Cloudflare配信、mainマージ、Draft解除：**実施なし**。
- H62の追加物は本書、合成DBの反例プローブ182、台帳142への追記のみ。アプリ・正式SQL・設定は変更しない。

## 指摘事項

### C1 / Critical：限定RPCを迂回する旧直接SELECTが残る

**箇所**：`supabase/migrations/0039_player_profile_consent_linking.sql:475`、`:484`、`:491`、`145_h40_prod_phase2_atomic_cutover_candidate.sql:73`、`:213`、`53_h12_anon_shared_base_acl_candidate.sql:16`、`tests/integration/task08-h56-real-sdk.cjs:44`。

- 0039は`authenticated`に`club_members`全表SELECTと`USING(true)`、`player_profiles`には有効選手のSELECTを許す。H38/Phase2は匿名名簿SELECTを閉じるが、認証済みの既存表/列SELECT・SELECTポリシーを閉じない。既存の表単位SELECTは追加alias列にも及ぶ。Phase3の7表にもこの2表は含まれない。
- **発生条件/再現**：既存0001〜0039＋0054/55＋正式Phase2内のH38 alias節をPGliteへ適用。架空の非公開グループで連携済み本人が公開確認なしで別名を保存し、管理者が公開グループへ変更する。未所属者に対して公開RPCはその未確認別名を省略するが、直接SELECTでは別名・役職・内部プロフィールIDを返す。別の有効選手の自己紹介も取得可能。匿名の名簿SELECTは拒否される一方、匿名の選手自己紹介SELECTも残る。
- **影響**：UI/RPCの最小DTOや公開同意をREST直接取得・埋込で迂回できる可能性がある。公開/非公開グループ、他グループ・退会者を含む境界が保証できない。既存プロフィール公開面の問題に加え、新alias列の無同意取得が発生する。
- **証拠の限界**：182は実MigrationとH38節による**合成PGliteの反例**。正式3本全体・現本番・実Auth/PostgRESTでの漏えいを直接実測したという意味ではない。本番カタログの再取得もH3のため未完了。ただし生成3本には認証済みの当該SELECT境界を変えるSQLがなく、H61の成功だけで反例を棄却できない。H56実HTTPの当該検査は「未所属者の名簿RPC拒否＋anon直接SELECT拒否」であり、**認証済み未所属者の直接SELECT拒否を試していない**。
- **推奨対応**：DB担当へ戻し、実カタログに基づく対象限定の表/列GRANT・RLS・旧RPC対策を設計する。本人取得、管理UPDATE RETURNING、イベント/共有、連携統合の依存を保護する。一括REVOKEやアプリ非表示だけで解決しない。anon/未所属/別グループ/退会者/一般/サブ/メイン/superについて、列指定・`select=*`・埋込・count/head・旧RPC・RETURNINGの実Auth/HTTP正負例を追加し、修正版の正式パッケージを再固定・再リハーサルする。

### H1 / High：本番の配信経路・ソース対応・即時再配信が未確定

**箇所**：`180_h61_production_release_runbook.md:30`、`:37`、`:42`、`:52`、`146_h40_release_order_restore_and_decision.md`末尾、`.github/workflows/production-smoke.yml:3`。

- Cloudflare GETで現在100%配信は **#389 `051e062c-05ba-40a8-a015-690038832b52`**、直前#388 `8455ee9b-fd5e-4f43-8503-4746764e1953`、配信元表記`wrangler`を再確認。Git commit/buildタグはバージョン情報にない。mainの最終pushと配信時刻の近さは対応コミットの証明にならない。
- 今回のBuild Trigger GET（一覧/Worker別）は**HTTP 403**。過去の「成功0件」は再現できず、「自動配信なし」とも「mainで自動配信あり」とも断定できない。GitHubの現workflow内に本番Workerをdeployする実行コマンドは見当たらず、main pushの`production-smoke`は読み取り確認のみ。Cloudflare側Git連携の有無は別問題。
- 現HEADのローカルOpenNextビルドは成功したが、合成localhostの公開設定を使用した**検証用成果物**であり本番配信物ではない。現在の本番Supabase公開設定でビルドされた固定成果物・その再配信経路の確認が必要。PRのstaging check SUCCESSも本番配信証明ではない。
- **影響/対応**：Phase2後に配信できないと旧UIが残る。Cloudflare Git連携/production branch/build・deployコマンド、配信担当と権限、対象SHA・実Versionとの対応、失敗時の新Worker再配信方法を読み取りで確定する。GitHub保護APIも403で必須ルール未確認。設定を推測で変更せず、配信確実性が立つまでSQL2を実行しない。

### H2 / High：直前DBバックアップ・R2実ファイル復旧・停止/RPOが未充足

**箇所**：`180_h61_production_release_runbook.md:38`、`:54`、`.github/workflows/cloud-db-backup.yml:23`、`supabase/maintenance/event-fixed-pairs/cloud_backup.py:299`、`:340`、`:555`。

- 11/22の166表バックアップと復元は実ログまで確認済みだが、**最新ではない**。今回は本番適用が止まるため取得し直していない。H63直前に再取得が必要。
- DBバックアップはR2バイトを含まない。現バケットのr2.dev公開無効は確認できたが、R2の別暗号化バックアップ・参照/サイズ/内容ハッシュの照合・復元の成功証跡はない。
- 通知だけの編集停止は古いタブ・直接Supabase更新・画像GCを止める保証にならない。バックアップ後の正常更新を全DB復元で失う可能性がある。**停止の実効性、進行中処理、取得後更新の扱い、許容RPO、担当者を明示して承認を受ける**。RLS緩和や匿名権限復活を復旧策にしない。
- 下記バックアップ計画を実行し、別環境の復元と新Workerの組合せを検証するまで本番適用不可。Workerの秘密値はDBダンプから復元できるとは扱わない。

### H3 / High：最新本番カタログを独立再取得できていない

**箇所**：`180_h61_production_release_runbook.md:28`、`:37`、`178_h61_release_package.py:83`、`supabase/maintenance/event-fixed-pairs/cloud_connection_probe.py:19`。

- 接続先検証は`padel-hub`の既存ガードに合致したが、固定SHAの公式CA取得が現在の通信環境で失敗。代替の同一公式S3ホストも取得不能。**TLS検証を緩めず接続前に停止**し、本工程では本番DBへのSQLを実行していない。Stageにも接続しない。
- H61の当日schema capture/fingerprintは過去証跡として使用。現在の22履歴、表/列ACL、RLS、関数所有者/search_path/EXECUTE、FK、秘密値の対応を独立再確認したとはしない。
- 履歴gateはversion/nameの完全一致であり、全関数・RLS・GRANTの最新一致検査の代替ではない。安全な既存接続経路/CAを復旧し、読み取り専用で再照合する。現物が違えば中止する。

### M1 / Medium：既存異常・残タスクの受入範囲を区別する

**箇所**：`158_h47_legacy_regression_and_prod_integrity_result.md`、`146_h40_release_order_restore_and_decision.md`、台帳142 §1。

既存の同点勝者5試合・負得点1試合、ownerと在籍mainの対応例外1件は移行による新規異常と断定せず、自動修正しない。必要な引継ぎ操作への影響は別判断。同グループ画像閲覧、メール招待、未所属者への直近開催は未完了の別範囲。#215/#264全体を完了にしない。Lowとして追加すべき独立の指摘なし。

## 正式SQLレビューとハッシュ

`python -B supabase/maintenance/group-foundation/178_h61_release_package.py render NEW_TMP_DIR`を実行。元6ファイルのGit blob固定ガードを通過し、以下がH61ログ/依頼の値と一致。

| Version | SHA256 |
|---|---|
| 20261124044001 | `0ccd82e5c550a04f6e9788904346fd7e1551cabe2b0e713b44e16feac9f4e24c` |
| 20261124044002 | `03759e9c36760c85ebc5d0548e225de64440deff512408f94cfe9248e1935aeb` |
| 20261124044003 | `50ed1b8f67a88faf086c8fb05e5e38f545f45d73d7143110bb8410aabb6eb463` |

- Phase1の6工程→Phase2の11工程＋H51/H52→新Worker/正規共有確認→Phase3の順序。手動適用パッケージ専用とし、`supabase db push`/reset/履歴repairはしない。
- 各ファイルのBEGIN/COMMITと履歴表ロック、旧22 version/name＋必要な前段履歴の完全一致、DDLと自段の履歴INSERTの同一transactionを確認。Phase2はH51/H52前に履歴INSERTするが、途中失敗なら同じtransactionで消える。履歴の`statements`はSQLの文字列であり、そこを別途実行するものではない。
- 検証marker、2099模擬履歴、合成共有tokenの除去と、H52の実契約ガードへの置換を確認。H52は確認済み3FKのみ許容し、統合元private/mediaがあれば拒否。画像の複製/削除/所有者変更はしない。
- 新RPCの空search_path/限定EXECUTE、本人/所属のサーバー側検証、H51の旧approved拒否・新named承認の内部呼出し、Owner承諾時のclub→requestロック/本人再認可、本人退会の在籍解除/最後のmain保護、token/種別/終了状態で限定する共有DTO/clickを確認。アプリhelperの引数・戻り値・PT409処理は既存関連テスト/SDK証跡と照合。**この確認はC1を解消しない。**
- H61のSQLそのものの順序/失敗/履歴検証は再実行せず実コード・ログを監査した。新しい権限修正が入る場合、これらのSHAと成功実績を流用しない。

## 実施した確認と再利用証跡

### H62で実施

1. 上記offline SQL生成/3ハッシュ一致、関連コード・workflow・runbook・mainルール/PR/Issue差分確認。
2. `node_modules/.bin/tsc --noEmit --incremental false`：成功。
3. `node --test`でgroup read/join/recipient/withdraw/owner/count/shared/token-clickの関連15ファイル：全ファイル成功（この環境の集約表示は15 file tests）。`node tests/club-display-name.test.cjs`：9件成功。無関係な304件全再実行はしない。
4. `npm run cf:build`：Next 15.5.29/OpenNext 1.20.17、固定Bun 1.2.15で成功。`ensure-cloudflare-worker.cjs.current()`でWorker/assetsとNext BUILD_ID一致。**合成localhost設定での互換性確認で、配信はしていない。**
5. `node supabase/maintenance/group-foundation/182_h62_authenticated_boundary_probe.cjs`：上記C1の反例を再現。これは「認可試験PASS」ではなく**拒否すべき取得が成立した証拠**。実Auth/HTTPではない。
6. Cloudflare設定/versions/deployments/R2、GitHub現PR/Actions/バックアップReleaseをGET。権限不足は成功扱いしない。

### Actionsの実ログ・コードを確認して再利用

| 工程/Run | 実証内容と限界 |
|---|---|
| H47 `44957088606` | 35/101/87/54/27＝304実行・0 fail、TypeScript。**app/components/lib/package/lock/既存build scripts/設定はH47記録からHEADまで差分なし**。回帰の再利用根拠であり全HTTP認可を保証しない |
| H48 / 160、H54 `45308564260` | 実データ限定24表4,430行、旧18表全列保持、原子性・再適用拒否。全166表やR2本体の保全試験とは別 |
| H55 / H56 `45316582803` | ローカル実Auth・schema fingerprint・SDK15/独立DB8。H55だけの基盤sentinelはアプリ受入とは数えない |
| H57 `45320034451` | 375px light/dark・実ローカルWorker/Auth/HTTPの14判定・DB8。物理iPhoneではない |
| H58 `45322761561` | 正規共有3種、遮断前10/後13/停止1、クリック件数/参照元非保存。実利用リンクは未操作 |
| H59 `45325329728` | 復元の変更検知・制御した同時操作。全競合網羅ではない |
| H60 `45326598065` | 実WebP/ローカルR2の12判定・独立DB7、GC2 object。本番R2/実端末でない |
| H61 `45328528428`, tested `2d354c24506646499a6abbb567d8b1a0e32c24ba` | 正式3本の順序違い拒否、各末尾障害rollback、DDL/全履歴/ACL、正常commit・repeat拒否、旧22＋新3履歴、SDK15/DB8、実Worker共有前後。合成隔離のみ |

通常/チーム/公式、固定ペア・乱数・出場休憩、スコア/GP/ランキング、動画・施設・プロフィールの計算/保存コードにH47以降の変更がないことを確認した。既存成功を使える範囲はここまでであり、新SQLが同じ読取権限を維持したから安全という推論はしない。

## バックアップ・復元の具体的準備

- 既存の`.github/workflows/cloud-db-backup.yml`を**承認後の直前時点でmainにworkflow_dispatch**する経路を利用する。PR265へ既存の他PR専用ラベルを流用しない。実行するmainのスクリプトSHA・対象接続先を固定する。今回は起動しない。
- Run [`44966082064`](https://github.com/g-ambe/Padel-match/actions/runs/44966082064)、tested main `f914d1b`のbackup/restore実ログは、暗号化166表、別ジョブdownload、`rows_and_values_match=true`/`rls_acl_definitions_match=true`/`restore_verified=true`を示す。非公開Draft Release `454086112`に`backup.tar.gpg`が存在し復元成功印あり。
- 同一REPEATABLE READ/READ ONLYスナップショット、roles/schema/data/管理schema・migration履歴、行hash/関数/ACL/RLS/FK照合、AES256＋外部passphrase、ネットワーク切断済み独立復元の既存ガードを維持。`auth.users`/identities等を含むが、除外schema（vault/実行queue等）、プラットフォーム設定、Auth JWT/メール設定、Worker/R2秘密値、外部画像バイナリを丸ごと復元できるとはしない。
- R2案：編集/アップロード/GCと取得中更新の扱いを決めてから、DBの有効参照・未完了操作・回収予定を秘密のmanifestへ記録。既存認証経路のobject **GETのみ**で参照ファイルを取得し、キー/サイズ/内容hash/DB参照versionを照合、暗号化して既存非公開保管へ退避する。キーや個人画像をログ/Issueへ出さない。DBにない未参照objectまで含めた全量保全を要する場合は、S3 list権限/費用と猶予GCを別途確認する。現在このR2手順の実行・独立復元は未検証。R2へテストPUTや公開化はしない。
- 復元時はWorkerの`PROFILE_MEDIA_COMMIT_SECRET`とDB側の照合情報、Supabase URL/鍵・Auth設定、R2 binding/既存objectを同じ時点の構成で検証する。値は記録せず秘密管理側で参照する。今回DB側との一致は未確認。
- 取得後更新は別途差分/操作履歴で確認し、通常は保全したまま前進修正を優先する。全DBの過去復元はデータ喪失を伴い得るため新たな明示承認が必要。無料の即時PITR/無損失復旧を保証しない。

## Cloudflare配信準備と停止手順

- Worker名/URL/設定を変更していない。GETした稼働設定は`nodejs_compat`、compatibility date `2026-05-14`、`ASSETS`、`PROFILE_IMAGES`、`PROFILE_MEDIA_RATE_LIMITER`、画像commit用secretの**存在**を確認。R2は`padel-match-profile-images`、r2.dev無効。秘密値は表示/変更しない。
- 当日PR check `Workers Builds: padel-match-staging`はSUCCESS。ただしprod #389と対応SHA、main自動配信設定、実際に使える再配信権限は未確定（H1）。GitHub Projects #2/branch protectionは403で未確認・未同期。Issueへ結果を残す。
- 手順180の「backup→SQL1→SQL2→直ちに新Worker→正常/正規共有→SQL3→再開」という**順序自体は妥当**。現状は前提未充足のため開始不可。古いタブにもサーバー側認可を強制するC1対策が必須。
- COMMIT前の失敗はrollback、応答喪失はREAD ONLYで確定状態確認、適用済みなら盲目的再送禁止。SQL1のみ確定なら旧Worker維持で停止。SQL2後は旧Worker単独rollbackを選ばず、新Workerの固定成果物再配信/限定forward-fixを独立検証する。匿名再GRANT/RLS無効化は禁止。
- SQL3は新Workerの正規共有3種が成功した後だけ実行する。失敗時は新Worker＋SQL2を維持して停止し、ACL/履歴を読み直す。自動的に弱い旧経路を復活させない。再配信可能性が未確定の現在、SQL2後に安全復旧できるとは保証しない。

## 次工程・未確認事項

1. C1の実カタログ照合とDB修正案の独立レビュー、既存管理/保存の正例を守った実Auth/REST負例試験、修正版package/履歴/ハッシュ/隔離リハーサル。
2. H1/H3の読み取り権限・接続を整え、最新本番のACL/RLS/historyと配信経路/成果物/停止・再配信を確定。
3. H2の直前DB＋R2バックアップと独立復旧、秘密値整合、取得後更新/RPOを確認。
4. 再レビューでGOを得た後でも、対象SHA/SQL/停止窓/復旧限界を示して**ユーザーの明示的H63承認を得るまで本番へ進まない**。

本番/Stageの新しい実Auth/HTTP、本番R2取得復元、物理端末、最新DB読取、配信操作は未実施。PR265はDraft、Issue215/264は未完了を維持する。
