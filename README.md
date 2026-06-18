# Gomoku

React + TypeScript + Vite による五目並べアプリケーションです。

対人戦と AI 対戦に対応しており、禁じ手ルールの有効・無効を切り替えてプレイできます。

---

## 技術スタック

* React
* TypeScript
* Vite
* CSS
* Custom AI Logic

---

## ディレクトリ構成

```text
gomoku/
├── public/
│
├── src/
│   ├── components/    # UIコンポーネント
│   ├── hooks/         # カスタムフック
│   ├── types/         # 型定義
│   ├── utils/         # ゲームロジック・AI
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
│
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## セットアップ

### 1. 依存関係インストール

```bash
npm install
```

### 2. 開発サーバ起動

```bash
npm run dev
```

デフォルト

```text
http://localhost:5173
```

---

## ビルド

```bash
npm run build
```

ビルド成果物は

```text
dist/
```

へ出力されます。

---

## 動作フロー

1. ゲームモード（対人 / 対AI）を選択
2. 石の色とルール設定を選択
3. プレイヤーが着手
4. 着手の妥当性を検証
5. 対AIモードでは AI が次の一手を探索
6. 勝敗判定・禁じ手判定を実行
7. 盤面とステータスを更新

---

## 主な機能

### 対人対戦

1台の端末で交互に着手してプレイできます。

### AI対戦

盤面評価と探索アルゴリズムを用いて AI が次の一手を決定します。

### 禁じ手ルール

禁じ手ルールの有効・無効を切り替えることができます。

### TypeScript実装

ゲーム状態、盤面、プレイヤー情報を型安全に管理しています。

---

## デプロイ

Vercel を想定しています。

GitHub リポジトリと連携することで、Push 時に自動ビルド・自動デプロイが実行されます。

---

## 開発メモ

* ゲーム進行管理は `src/hooks/useGameLogic.ts` に集約する
* AI ロジックは `src/utils/ai` に集約する
* 勝利判定・禁じ手判定は `src/utils/gameLogic.ts` に実装する
* 型定義は `src/types` に配置する
* UI コンポーネントは `src/components` に配置する

---

## 注意事項

* モダンブラウザ（Chromium / Firefox / Safari）を対象としています
* AI の探索量を増やすと応答時間が長くなる場合があります
* 禁じ手判定は一般的な五目並べルールを実装しています