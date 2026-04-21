// src/constants/aiSettings.ts

/**
 * AIの評価スコア設定
 */
export const AI_SCORES = {
  FIVE: 100000,         // 五（5連）: 勝利確定
  OPEN_FOUR: 10000,     // 活四（両端空きの4連）
  CLOSED_FOUR: 1000,    // 死四（片端ブロックの4連）
  OPEN_THREE: 1000,     // 活三（両端空きの3連）
  CLOSED_THREE: 100,    // 死三（片端ブロックの3連）
  OPEN_TWO: 100,        // 活二（両端空きの2連）
  CLOSED_TWO: 10,       // 死二（片端ブロックの2連）
  SINGLE: 10,           // 孤立した石
  NONE: 0,              // 価値なし
} as const;

/**
 * AIの性格設定
 * 攻撃（自分のリーチ）をどの程度優先するか
 */
export const AI_CONFIG = {
  ATTACK_WEIGHT: 1.1,   // 防御(1.0)に対して攻撃を1.1倍優先
  SEARCH_RANGE: 2,      // 石から何マス以内を探索候補にするか
};