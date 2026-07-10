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
// 【探索パラメータの一元管理】
// depth・timeLimitMs のデフォルト値はここに集約している。
// AIの強さを調整したい場合、呼び出し側で SearchOptions を明示指定しない限り
// 常にこの値が使われるため、値を書き換えるだけで挙動を変更できる。
export const AI_CONFIG = {
  ATTACK_WEIGHT: 1.1,

  /** 候補手生成時の周辺探索距離 */
  SEARCH_RANGE: 2,

  /**
   * ミニマックス探索の基本深さ（2〜3 を想定）
   * - SearchOptions.timeLimitMs 未指定時: この深さで固定探索する
   * - SearchOptions.timeLimitMs 指定時  : 反復深化の上限深さとして使う
   */
  MINIMAX_DEPTH: 2,

  /**
   * 反復深化のデフォルト時間制限 [ms]（仮値）。
   * SearchOptions.timeLimitMs が明示されなかった場合のフォールバック値。
   * 今後 AI レベル（Easy/Normal/Hard 等）を導入する際は、
   * レベルごとの SearchOptions プリセットでこの値を上書きする想定。
   */
  DEFAULT_TIME_LIMIT_MS: 10000,

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
 * 探索オプション（iterative deepening・時間制御用）
 *
 * - depth: 反復深化を使わない場合の固定深さ探索に使用（timeLimitMs 未指定時のフォールバック）
 * - timeLimitMs: 指定時、search.ts 側で depth=1,2,3... と反復深化を行い、
 *   制限時間内に完了した最後の深さの結果を採用する。
 */
export interface SearchOptions {
  /** 探索深さの上書き（未指定時は AI_CONFIG.MINIMAX_DEPTH） */
  depth?: number;
  /**
   * 探索時間上限 [ms]。指定すると反復深化（iterative deepening）による
   * 時間制御付き探索になる。未指定時は depth 固定の従来動作。
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