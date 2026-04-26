# Gomoku

ブラウザで動作する五目並べ（Gomoku）のアプリです。  
対人・AI対戦、禁じ手ルールの切り替えに対応しています。

---

## 概要

* **フロントエンド**: React + Vite + TypeScript
* **スタイル**: プレーン CSS（`src/index.css`）
* **コアロジック**: TypeScript 製のゲームロジック（`src/utils/gameLogic.ts`）およびフック（`src/hooks/useGameLogic.ts`）、AI（`src/utils/ai/search.ts`, `src/utils/ai/evaluator.ts`）
* **デプロイ**: Vercel / Netlify / GitHub Pages（ビルド成果物は `docs/`）

---

## ディレクトリ構成

```text
gomoku/
├── src/
│   ├── main.tsx              # エントリポイント。Reactの初期化とAppのマウント
│   ├── App.tsx               # メインコンポーネント。全体のレイアウトと状態管理
│   ├── index.css             # グローバルスタイル
│   ├── components/
│   │   ├── Board.tsx         # ボード描画とセルの配置
│   │   ├── Cell.tsx          # 各セルの表示・クリック処理
│   │   ├── ColorSelector.tsx # プレイヤー色の選択
│   │   ├── ForbiddenRuleToggle.tsx # 禁じ手ルールの切替
│   │   ├── GameStatusPanel.tsx     # ターン・勝敗表示などのステータス
│   │   ├── ModeSelector.tsx  # 対人/対AI モード選択UI
│   │   └── StatusMessage.tsx # メッセージ表示（禁じ手通知など）
│   ├── hooks/
│   │   ├── useAiPlayer.ts    # AIの制御
│   │   ├── useForbiddenMoves.ts # 禁じ手判定の補助
│   │   └── useGameLogic.ts   # ゲーム状態・勝敗判定のコアロジック
│   ├── types/
│   │   └── game.ts           # 型定義（盤面、手、プレイヤー等）
│   └── utils/
│       ├── gameLogic.ts      # 石配置検証、勝利・禁じ手判定
│       └── ai/               # AI関連
│           ├── constants.ts  # 定数・設定
│           ├── evaluator.ts  # 盤面評価関数
│           └── search.ts     # 探索アルゴリズム
├── public/                   # 静的アセット
├── docs/                     # ビルド成果物
├── index.html                # Vite HTMLテンプレート
├── package.json              # 依存関係・スクリプト設定
├── tsconfig.json             # TypeScript設定
├── vite.config.ts            # Vite設定
└── README.md
```

---

## 動作フロー

1. **入力 / 初期化**: プレイヤーはモード（対人 / 対AI）、石の色、ゲーム開始を選択して初期化。
2. **処理の安全性**: 手の妥当性は `gameLogic` で検証され、禁じ手や既存の石との衝突をチェック。AI の計算は非同期で行われる。
3. **実行**: 手が確定すると状態が更新され、対AI では `useAiPlayer` が `utils/ai` の評価と探索を使って次手を決定。
4. **出力**: ボードやステータスパネルへ反映し、勝敗や禁じ手の通知を行う。

---

## 特徴・機能

* **対人／対AI プレイ**: ローカル環境で対人でもAIでも遊べます。
* **AI（評価 + 探索）**: `src/utils/ai` の評価関数と探索アルゴリズムにより合理的な手を選択します。
* **禁じ手ルールのトグル**: UI で禁じ手ルールを有効化/無効化できます。
* **Hooks ベース設計**: `useGameLogic` 等でロジックを切り出し、テストや再利用が容易。

---

## 開発 / ビルド

### 開発環境の起動
```bash
npm install
npm run dev
```

### ビルド
```bash
npm run build
# 結果は docs/ に出力されます
```

---

## 仕様・制限事項

* **ブラウザ互換**: モダンブラウザ（Chromium / Firefox / Safari）を対象。古いブラウザでは動作しない可能性があります。
* **AI の性能制約**: 探索深さやボードサイズを増やすと計算負荷が上がり、応答が遅くなる場合があります。
* **ルール実装の範囲**: 禁じ手の判定は一般的な実装を提供しますが、地域差や派生ルールは未対応の場合があります。