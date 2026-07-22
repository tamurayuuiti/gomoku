// src/utils/ai/constants.ts
// AIの評価ロジックや定数を定義するファイル
//
// 型定義（PatternType / PatternCount / SearchOptions）は複数ファイルから
// 共有されるため types/ai.ts に集約している。このファイルは定数のみを扱う。

import { DIRECTIONS as GAME_DIRECTIONS } from '../gameLogic';

// --- スコア定数（攻撃基準に統一） ---

export const AI_SCORES = {
  // 最優先事項
  WIN: 1_000_000,
  DEFEND_WIN: 500_000,

  // 必勝パターン
  OPEN_FOUR: 100_000,
  DOUBLE_FOUR: 90_000,
  FOUR_THREE: 90_000,

  // 強い脅威
  DOUBLE_THREE: 50_000,

  // 通常評価
  CLOSED_FOUR: 10_000,
  OPEN_THREE: 5_000,
  CLOSED_THREE: 500,
  OPEN_TWO: 100,
  CLOSED_TWO: 10,
  SINGLE: 1,
} as const;

// --- AI探索設定 ---

// depth・timeLimitMs のデフォルト値をここに一元管理し、
// 呼び出し側が SearchOptions を明示しない限り常にこの値が使われる。
export const AI_CONFIG = {
  ATTACK_WEIGHT: 1.1,

  /** 候補手生成時の周辺探索距離 */
  SEARCH_RANGE: 2,

  /**
   * ミニマックス探索の基本深さ
   * - SearchOptions.timeLimitMs 未指定時: この深さで固定探索する
   * - SearchOptions.timeLimitMs 指定時  : 反復深化の上限深さとして使う
   */
  MINIMAX_DEPTH: 8,

  /**
   * 反復深化のデフォルト時間制限 [ms]。
   * 今後 AI レベル（Easy/Normal/Hard 等）を導入する際は、
   * レベルごとの SearchOptions プリセットでこの値を上書きする想定。
   */
  DEFAULT_TIME_LIMIT_MS: 1200,

  /**
   * 各ノードで探索する候補手の上限数（move ordering 後に先頭から取得）
   * 深さ 2・15手なら最大 15^2 = 225 leaf 評価に抑制できる
   */
  MAX_CANDIDATES: 15,
} as const;

// --- 全盤評価設定 ---

export const EVAL_CONFIG = {
  /**
   * evaluateBoard で集計する上位 K 手の数。
   * 単純な max 比較ではなく上位 K 手の重み付き和を取ることで、
   * 多重脅威の盤面を正確に評価できる。
   */
  TOP_K: 3,

  /**
   * 2 番手以降のスコアに掛ける減衰係数。
   * 0.3 = 2 番手は 30%、3 番手は 9% 寄与する。
   * 脅威の多重性を評価しつつ、支配的な 1 手の価値を損なわない。
   */
  TOP_K_DECAY: 0.3,
} as const;

// --- Transposition Table / Aspiration Window 設定 ---

export const TT_CONFIG = {
  /**
   * 置換表の最大エントリ数。
   * この値を超えたら全クリアする（簡易的なメモリ管理）。
   * 1エントリ ≈ 100byte として、200,000件 ≈ 20MB 程度を想定。
   *
   * @future 世代管理（Age/LRU）による淘汰戦略へ改善予定
   */
  MAX_ENTRIES: 200_000,

  /**
   * Aspiration Window の有効フラグ。
   *
   * 現在は TT / Aspiration Window が棋力低下の原因かどうかを切り分けるため、
   * 一時的に false（無効）としている。
   *
   * 再導入時は true に設定し、ASPIRATION_WINDOW を使用する。
   * ただし、再導入時には fail-high / fail-low 時の再探索ウィンドウ設計を
   * 安全な形（原則 full window 再探索など）に修正することを推奨する。
   */
  ENABLE_ASPIRATION_WINDOW: false,

  /**
   * Aspiration Window の初期幅。
   * 反復深化の各ステップで、前回のスコアを中心に ±この幅のウィンドウを設定する。
   * Fail High/Low 時にウィンドウを拡大して再探索する。
   *
   * 幅が狭すぎると再探索回数が増え、広すぎると枝刈り効果が薄れる。
   * 五目並べのスコア体系（SINGLE=1 〜 WIN=1,000,000）に対し、
   * 通常評価の揺らぎ（数百〜数千点）をカバーできる 50 を初期値とする。
   *
   * 注意:
   *   現在は ENABLE_ASPIRATION_WINDOW = false のため使用されない。
   *   削除せず、将来の再導入用に残す。
   */
  ASPIRATION_WINDOW: 50,
} as const;

// --- 方向定数 ---

export const DIRECTIONS = GAME_DIRECTIONS;