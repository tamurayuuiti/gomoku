# Gomoku

React + TypeScript + Vite で構築した、ブラウザ上で遊べる五目並べアプリケーションです。対人戦と AI 戦に対応し、禁じ手ルールの有効・無効を切り替えながらプレイできます。v2.0.0 では AI の探索アルゴリズムを大幅に強化し、探索効率と戦術判定の精度を向上させています。

## 技術スタック

- React
- TypeScript
- Vite
- Tailwind CSS
- Web Worker（AI 思考処理）
- lucide-react
- ESLint

## ディレクトリ構成

```text
gomoku/
├── src/
│   ├── components/      # UIコンポーネント
│   ├── hooks/           # ゲーム進行・AI連携のカスタムフック
│   ├── types/           # ゲーム・AI関連の型定義
│   ├── utils/           # ゲームロジックおよびAIロジック
│   │   └── ai/          # 探索・評価・候補手生成・キャッシュ・VCF・Quiescence
│   ├── workers/         # AI思考用 Web Worker
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 開発サーバの起動

```bash
npm run dev
```

通常は次の URL で起動します。

```text
http://localhost:5173
```

## ビルド

```bash
npm run build
```

ビルド成果物は次のディレクトリに出力されます。

```text
dist/
```

## 主な機能

- 対人戦と AI 戦を切り替えてプレイできる
- AI 戦では先手・後手を選択できる
- 禁じ手ルールの ON/OFF を切り替えられる
- 15×15 盤面上で勝敗・引き分けを判定する
- AI の思考を Web Worker 上で実行し、UI の応答性を維持する
- 最後の一手や禁じ手候補を盤面上で表示する

## 動作フロー

1. ゲームモードを選択する
2. 盤面に石を置く
3. 勝敗・禁じ手・引き分け条件を判定する
4. AI 戦では AI が次の一手を探索する
5. 盤面とステータスを更新する

## 技術・アルゴリズム・仕様

### 盤面・勝敗判定

- 盤面サイズは 15×15 です
- 横・縦・斜めの 4 方向で連続した石の数を確認します
- 黒はちょうど 5 連で勝利、白は 5 以上で勝利する判定を行います

### 禁じ手ルール

- 禁じ手ルールが有効な場合、三三・四四・長連を判定します
- 五連完成時は禁じ手より勝利判定を優先します
- AI も禁じ手ルール設定を考慮して着手を決定します

### AI

- 候補手生成と盤面評価を組み合わせたミニマックス探索を採用しています
- αβ枝刈り・時間制限付き反復深化・PVS（Principal Variation Search）・LMR（Late Move Reduction）により探索効率を向上させています
- TT Move・Killer・History・Countermove により有望な候補手を優先的に探索します
- 局面評価は、各方向のラインパターンに基づいて攻撃と防御の脅威をスコア化し、盤面全体の上位候補へ集約します
- Transposition Table・Zobrist Hashing・差分ラインキャッシュ・Static Eval Cache・パターンキャッシュ・候補集合の増分管理により、繰り返し局面と評価結果を再利用します
- 連続四による即勝ち手順を短時間で証明する Root VCF（Victory by Continuous Four）と、葉ノードでの戦術的読み伸ばし（Quiescence Search）を備えています