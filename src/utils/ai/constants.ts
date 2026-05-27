// src/utils/ai/constants.ts
// AIの評価ロジックや定数を定義するファイル

// --- パターン型定義 ---
export type PatternType =
  | 'WIN'
  | 'OPEN_FOUR'
  | 'CLOSED_FOUR'
  | 'OPEN_THREE'
  | 'CLOSED_THREE'
  | 'OPEN_TWO'
  | 'CLOSED_TWO'
  | 'SINGLE';

export type PatternCount = Record<PatternType, number>;


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
export const AI_CONFIG = {
  ATTACK_WEIGHT: 1.1,

  /** 候補手生成時の周辺探索距離 */
  SEARCH_RANGE: 2,

  /** ミニマックス探索の基本深さ（2〜3 を想定） */
  MINIMAX_DEPTH: 2,

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


/**
 * 探索オプション（将来の iterative deepening・時間制御向け）
 *
 * 現時点では depth のみ有効。timeLimitMs は iterative deepening 実装時に使用する。
 */
export interface SearchOptions {
  /** 探索深さの上書き（未指定時は AI_CONFIG.MINIMAX_DEPTH） */
  depth?: number;
  /**
   * 探索時間上限 [ms]（iterative deepening 実装時に有効化）
   * @future
   */
  timeLimitMs?: number;
}


// --- 方向定数 ---
export const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;