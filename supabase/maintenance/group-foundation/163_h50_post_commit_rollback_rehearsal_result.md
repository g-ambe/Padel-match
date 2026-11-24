# TASK-08 / H50：Phase2 COMMIT後の切り戻しリハーサル結果（無料・実データ隔離DB）

実施：**2026-11-24 JST**。GitHub：[実行 #45297128444](https://github.com/g-ambe/Padel-match/actions/runs/45297128444) **SUCCESS**。既存[Draft PR #265](https://github.com/g-ambe/Padel-match/pull/265)・[Issue #264](https://github.com/g-ambe/Padel-match/issues/264)の範囲内。**Prod/Stage DBのDDL/DMLなし、Worker deploy/main mergeなし。**

## 結論（3種類の「成功」を混同しない）

1. **PASS：Phase1(6) → Phase2(11)を実本番のschemaと業務データの隔離DBへ連続COMMIT。** 既存24表の検証対象（うち18表4,279行は元の全列、6表151行は限定列）に対してPhase1/2後の整合性・匿名アクセス・公開名簿条件を再確認した。
2. **PASS：Phase2のCOMMIT後に、本番とは無関係の隔離DBを移行前のschema/ACL/RPC/Migration履歴/保管済み元行で再構築し、元と一致した。** これは**破壊的なsnapshot復旧**の成立を証明するもの。Phase2 COMMITを単にSQL `ROLLBACK`したわけではない。
3. **NO-GO：Cloudflareの旧Workerへ切り替えるだけの安全な「無損失切り戻し」は成立未確認**。Phase2後の旧匿名`club_members`直接SELECTが拒否され、本人連携詳細`get_player_profile_link_request(uuid)`の関数定義が旧版と異なることを実測。匿名へ`club_members`全表SELECTを再GRANTする復旧は**別名/本人同意情報を露出させる危険があるため実行しない**。旧Worker×新DBの全画面実HTTP動作も未検証。

**H50はリハーサルとして成功。TASK-08の本番リリースは引き続きNO-GO。**

## 正式に実行した試験

- H45/H48の既存無料GitHub Actions `h43-isolated-rehearsal`を再利用し、新しい有料Supabase Project/Branch、重複PR、別workflowを作成しない。
- Prod `ntczrmvffmpjzilfebyi`へは既存の**READ ONLY REPEATABLE READ snapshot**で接続。元のschema.dump、ロール・Migration名/version、グループ・所属・選手・本人申請等の**6表151行・限定列**、イベント・試合・戦績・固定ペア・R2画像管理キー・施設など**18表4,279行・全元列**をネットワーク隔離Postgres17へ一時復元。
- 未使用のプロフィール/本人認証の全表、`auth.users`の本番認証行、R2画像バイナリは**今回コピーしていない**。実データはRunnerメモリと隔離Dockerだけにあり、GitHubへレコード/資格情報のログ・Artifact/Releaseアップロードをしていない。
- Phase1の6SQL、内部での検証用Migration1件登録→Phase2の11SQL、検証用Migration1件登録。2フェーズはどちらも**COMMIT済み**になった一時DBで確認。本文の「COMMIT後」は実本番DBではなく隔離DBを指す。
- ローカルで関数定義ハッシュ／`anon club_members SELECT`／公開別名列／owner移管テーブル／共有RPC／private schema／migration登録数を**切替前・切替後・復旧後**の3時点で照合。Phase2後に旧匿名の直接SELECTを実行し、意図どおり権限エラーで**拒否される**ことを確認。
- **隔離DBにのみ**検証用テーブル `public.h50_restore_probe` と後続レコードを追加COMMIT。これは実アプリの記録ではなく、全復元で途中書込みが失われることを示すマーカー。
- 続いて隔離DB内だけで、Phase1で新設された `group_read_private` schema をDROPし、**移行前の本番schema.dumpを再ロード**。旧22 migration履歴・旧RPC/ACLを再構築し、元の6表限定列/18表全元列データを再投入。DBの元schemaメタデータ、旧API契約、Migration再適用条件、全24表の元列ハッシュ/参照整合が一致したことを確認。
- 最後に`h50_restore_probe`が**消えている**ことを確認。これが通常運用中の新規試合/スコア/プロフィール更新もsnapshot復元すると失われ得る、という重要な制限の実証となる。
- `if:always()`のcleanupによりRunnerの一時作業領域・隔離Dockerを削除し、**Prod/Stageへ書き戻していない**。

### 実ログ（GitHub Actions #45297128444）

| 工程 | 結果 |
| --- | --- |
| Prod READ ONLY Snapshot・隔離Postgres復元 | **PASS** |
| H45 6表151行取り込み・ハッシュ一致 | **PASS** |
| H48 18表4,279行取り込み・移行前ハッシュ一致 | **PASS** |
| Phase1(6) COMMIT・元列維持・名簿refs41件 | **PASS** |
| Phase2(11) COMMIT・元列維持・公開グループ2件、計14名（連携済同意待ち4名・未連携公開10名） | **PASS** |
| Phase2後の旧DB契約変更・旧`anon`直接所属参照拒否 | **PASS（互換性リスクを検出）** |
| 破壊的snapshot再構築と旧RPC・権限・Migration台帳の復旧照合 | **PASS** |
| 24表の元列データとスコア・固定ペア・画像DB参照整合 | **PASS** |
| Phase2後の試験用新規書込みが復旧時に消失すること | **PASS（データ損失リスクを実証）** |
| 隔離DB・一時データ削除 | **PASS** |
| **移行後の新しい本番試合を保持した無損失ロールバック** | **未実証・NO-GO** |
| **旧Workerの実HTTP・JSキャッシュと新DBの全面互換** | **未実証・NO-GO** |
| **11/22の全件暗号化アーカイブ自体を今回のH50で使用** | **していない**（下記の別実績） |

## 最新のバックアップ事実

本番の**166テーブル**・暗号化 `backup.tar.gpg` は[Actions #44966082064](https://github.com/g-ambe/Padel-match/actions/runs/44966082064)で**2026-11-22 09:20 JST**に取得し、別ジョブで**行/値・RLS/ACL/定義まで一致した隔離復元PASS**。GitHub Draft Release ID `454086112` / Asset ID `777342925`、公開せず暗号化保管済み。**この過去の全件Backup/Restore成功と、今回のH50の最新READ ONLY部分実データ切り戻し実験は別々の実績**。

**2026-11-24の本番適用当日のデータを丸ごと守るには、必ずリリース直前に全件バックアップ・復元照合をもう一度実施すること。** Free planで連続PITRがないため、DB全体の過去時点復元は後続の正常操作も失う。Cloudflare R2のオブジェクト本体はDBバックアップに含まれない。

## 事後のProd/Stage READ ONLY確認

- Prod：Migration **22**、clubs **13**、members **41**、player_profiles **84**、events **91**、matches **521**、results **351**、fixed_pair_state **10**、profile_media_objects **1**。`get_shared_event(text,text)`なし、owner-transfer tableなし、既存anon `club_members` SELECTは本番のまま**true**。
- Stage：Migration **74**、clubs **3**、events **0**、共有RPCあり（従前どおり）。
- PR #265はOpen/Draft/未マージ。今回のSQL実行はGitHub Actionsのネットワーク隔離DBだけ。無料の標準runner利用。

## 未解決の本番GOゲートと次の行動

1. **無損失forward-fix / 旧UI互換**：旧Worker版に戻すだけで済むかではなく、新DBに残る個人公開名・同意・Owner移管・本人連携を破壊せず、旧画面の主要API/HTTPを維持する**限定互換アダプター**を設計。旧匿名全表GRANTは禁止。実PostgREST/実JWTの正負例・旧JSの操作・復旧後のセキュリティがPASSになるまでPhase2 GOしない。
2. **Worker/DBの適用順・配信制御**：Cloudflare本番main自動配信が本当にどう発火するか最終GET。Worker旧版保持と新DB互換で、先に新Workerの旧/新DB両対応を準備するか、切替時の明示停止窓を確保する。
3. **正式Migration台帳**：Prod22 vs Stage74、統合候補2本を`apply_migration`する際の実version登録・将来`db push`衝突の運用ゲート。試験DB内の合成versionは本番versionを証明しない。
4. **本番直前の最新全件Backup/Restore**。11/22の確認済バックアップをそのまま本番切戻しに使うと、後日の試合・役職変更が巻き戻る。バックアップ保持/暗号化/取出し先の権限・RPOを最終確認。
5. **main新AGENTS.mdの取込みと最新HEAD CI/Cloudflareビルド/ブラウザQA**。別残件（同クラブ限定写真・メール招待・公開直近イベント）もTASK-08全体の完成宣言から分離する。

**現段階で本番Phase1/2適用、PR Ready/merge、Cloudflareデプロイを行わない。リリースGO承認も未取得。**

実装：[`162_h50_post_commit_rollback_rehearsal.py`](162_h50_post_commit_rollback_rehearsal.py)、既存`153_h45_real_group_data_migration_rehearsal.py`の任意H50呼出し、既存`.github/workflows/task08-staging-b0-auth-http.yml`、明示トリガー`.task08-free-rehearsal-trigger`。
