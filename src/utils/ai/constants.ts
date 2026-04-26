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
  WIN: 1000000,
  DEFEND_WIN: 500000,

  // 必勝パターン
  OPEN_FOUR: 100000,
  DOUBLE_FOUR: 90000,
  FOUR_THREE: 90000,

  // 強い脅威
  DOUBLE_THREE: 50000,

  // 通常評価
  CLOSED_FOUR: 10000,
  OPEN_THREE: 5000,
  CLOSED_THREE: 500,
  OPEN_TWO: 100,
  CLOSED_TWO: 10,
  SINGLE: 1,
} as const;


// --- AI設定 ---
export const AI_CONFIG = {
  ATTACK_WEIGHT: 1.1,
  SEARCH_RANGE: 2,
};


// --- 方向 ---
export const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;