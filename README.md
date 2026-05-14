# Padel Club App (Phase1 MVP)

Cloudflare Pages + Next.js App Router + Supabase を前提にした、パデルクラブ向けリアルタイム運用アプリのMVPです。

## セットアップ

1. `.env.local` を作成
2. 以下を設定

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

3. インストールと起動

```bash
npm install
npm run dev
```

## 実装済みMVP要素

- 日本語UI（ログイン / ホーム / 開催詳細 / 試合詳細 / ランキング / プロフィール）
- Edge Runtime対応のRound生成API（`/api/rounds/generate`）
- 公平性重視の簡易ラウンド生成ロジック
- Supabase初期スキーマ（profiles, clubs, events, matches など）
- ダークテーマのモバイルファーストUI

## Cloudflare Pages対応

- Node.js専用API（`fs`, `child_process`）は未使用
- fetch / Supabase SDK前提
