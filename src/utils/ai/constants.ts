// src/utils/ai/constants.ts
// AIの評価関数や探索ロジックで使用する定数を定義するファイル

// スコア定数
export const AI_SCORES = {
  FIVE: 100000,         // 五（5連）
  OPEN_FOUR: 10000,     // 活四
  CLOSED_FOUR: 1000,    // 死四
  OPEN_THREE: 1000,     // 活三
  CLOSED_THREE: 100,    // 死三
  OPEN_TWO: 100,        // 活二
  CLOSED_TWO: 10,       // 死二
  SINGLE: 10,           // 孤立石
  NONE: 0,
} as const;

// AIの探索に関する設定
export const AI_CONFIG = {
  ATTACK_WEIGHT: 1.1,   // 攻撃の重み（防御に対する倍率）
  SEARCH_RANGE: 2,      // 探索時に既存の石から離れる範囲
};

// AIが盤面を評価する際の方向ベクトル
export const DIRECTIONS = [
  [1, 0],  // 縦
  [0, 1],  // 横
  [1, 1],  // 右下
  [1, -1], // 左下
] as const;