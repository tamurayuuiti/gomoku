// src/utils/ai/boardEvaluator.ts
// 葉ノード盤面評価を担うモジュール。
//
// 責務:
//   - evaluateBoard: 全盤面の多重脅威スコア算出
//   - evaluateBoardWithCache: LineCache / CandidateSet 利用版
//
// 注意:
//   - 位置評価（evaluatePosition）は evaluator.ts に残す。
//   - 評価値の意味・優先順位・スコア体系は変更しない。
//   - ライン走査は 3 進整数エンコードされたラインコードを事前計算し、
//     パターン判定をテーブル参照で軽量化する。

import type { BoardState, Player } from '../../types/game';
import type {
  PatternCount,
  LineCacheState,
  CandidateSetState,
} from '../../types/ai';
import { BOARD_SIZE, DIRECTIONS } from '../gameLogic';
import {
  AI_SCORES,
  AI_CONFIG,
  EVAL_CONFIG,
} from './constants';
import {
  createEmptyPatternCount,
  hasStoneNearby,
  opponentOf,
  computeShapeBonusFromLines,
  PATTERN_INDEX,
  PATTERN_TABLE,
  POSITION_WEIGHT,
  calcTotalOppScore,
} from './evaluator';
import { cellCode } from './lineCache';

// ============================================================
// ライン走査キャッシュ（フォールバック用）
// ============================================================

/**
 * 指定方向 (dx, dy) について盤面全体を 1 回走査し、
 * 各セルを中心とする 3 進整数ラインコードを事前計算して返す。
 *
 * LineCache 無効時のフォールバックとして使う。
 */
const buildLineCache = (
  board: BoardState,
  dx: number,
  dy: number,
  color: Player
): number[][] => {
  const cache: number[][] = Array.from({ length: BOARD_SIZE }, () =>
    new Array<number>(BOARD_SIZE).fill(0)
  );
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      let code = 0;
      for (let i = -4; i <= 4; i++) {
        const pos = i + 4;
        const rr = r + i * dx;
        const cc = c + i * dy;
        if (rr < 0 || rr >= BOARD_SIZE || cc < 0 || cc >= BOARD_SIZE) {
          code += 2 * POSITION_WEIGHT[pos];
        } else {
          code += cellCode(board[rr][cc], color) * POSITION_WEIGHT[pos];
        }
      }
      cache[r][c] = code;
    }
  }
  return cache;
};

/**
 * キャッシュ済みラインコードから (r, c) への着手価値を算出する。
 *
 * ロジックは evaluator.ts の evaluatePosition と同一で、
 * 違いは事前計算済みキャッシュからラインコードを取得し、
 * 中心セルへの仮想着手を整数加算で表現する点のみ。
 *
 * LineCache の中心セル（index 4）は空マス（値 0）であるため、
 * 自石を置く場合は POSITION_WEIGHT[4] を加算、
 * 相手石を置く場合は 2 * POSITION_WEIGHT[4] を加算する。
 *
 * パターン集計バッファは呼び出し元で確保・再利用し、
 * 本関数の先頭で fill(0) して使う。
 *
 * @param ownLineCaches 4 方向分の playerColor 視点ラインキャッシュ
 * @param oppLineCaches 4 方向分の相手視点ラインキャッシュ
 * @param attackCounts 攻撃パターン集計バッファ
 * @param oppBeforeCounts 相手 before パターン集計バッファ
 * @param oppAfterCounts 相手 after パターン集計バッファ
 */
const scoreFromLineCache = (
  r: number,
  c: number,
  ownLineCaches: number[][][],
  oppLineCaches: number[][][],
  attackCounts: PatternCount,
  oppBeforeCounts: PatternCount,
  oppAfterCounts: PatternCount
): number => {
  attackCounts.fill(0);
  oppBeforeCounts.fill(0);
  oppAfterCounts.fill(0);

  const centerWeight = POSITION_WEIGHT[4];

  for (let d = 0; d < DIRECTIONS.length; d++) {
    // 中心セルは空マス前提のため、中心値を加算してテーブル参照する。
    const ownCode = ownLineCaches[d][r][c];
    attackCounts[PATTERN_TABLE[ownCode + centerWeight]]++;

    const oppCode = oppLineCaches[d][r][c];
    oppBeforeCounts[PATTERN_TABLE[oppCode + centerWeight]]++;
    oppAfterCounts[PATTERN_TABLE[oppCode + 2 * centerWeight]]++;
  }

  // --- 即時評価（evaluatePosition と同一の優先順位） ---
  if (attackCounts[PATTERN_INDEX.WIN] > 0) return AI_SCORES.WIN;
  if (
    oppBeforeCounts[PATTERN_INDEX.WIN] > 0 &&
    oppAfterCounts[PATTERN_INDEX.WIN] === 0
  )
    return AI_SCORES.DEFEND_WIN;
  if (attackCounts[PATTERN_INDEX.OPEN_FOUR] > 0) return AI_SCORES.OPEN_FOUR;
  if (attackCounts[PATTERN_INDEX.CLOSED_FOUR] >= 2) return AI_SCORES.DOUBLE_FOUR;
  if (
    attackCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
    attackCounts[PATTERN_INDEX.OPEN_THREE] >= 1
  )
    return AI_SCORES.FOUR_THREE;
  if (
    oppBeforeCounts[PATTERN_INDEX.OPEN_FOUR] > 0 &&
    oppAfterCounts[PATTERN_INDEX.OPEN_FOUR] <
      oppBeforeCounts[PATTERN_INDEX.OPEN_FOUR]
  )
    return AI_SCORES.OPEN_FOUR;
  if (
    oppBeforeCounts[PATTERN_INDEX.CLOSED_FOUR] >= 2 &&
    oppAfterCounts[PATTERN_INDEX.CLOSED_FOUR] < 2
  )
    return AI_SCORES.DOUBLE_FOUR;
  if (
    oppBeforeCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
    oppBeforeCounts[PATTERN_INDEX.OPEN_THREE] >= 1 &&
    !(
      oppAfterCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
      oppAfterCounts[PATTERN_INDEX.OPEN_THREE] >= 1
    )
  )
    return AI_SCORES.FOUR_THREE;
  if (attackCounts[PATTERN_INDEX.OPEN_THREE] >= 2) return AI_SCORES.DOUBLE_THREE;
  if (
    oppBeforeCounts[PATTERN_INDEX.OPEN_THREE] >= 2 &&
    oppAfterCounts[PATTERN_INDEX.OPEN_THREE] < 2
  )
    return AI_SCORES.DOUBLE_THREE;

  // --- 通常評価 ---
  let attackScore = 0;
  attackScore += attackCounts[PATTERN_INDEX.CLOSED_FOUR] * AI_SCORES.CLOSED_FOUR;
  attackScore += attackCounts[PATTERN_INDEX.OPEN_THREE] * AI_SCORES.OPEN_THREE;
  attackScore += attackCounts[PATTERN_INDEX.CLOSED_THREE] * AI_SCORES.CLOSED_THREE;
  attackScore += attackCounts[PATTERN_INDEX.OPEN_TWO] * AI_SCORES.OPEN_TWO;
  attackScore += attackCounts[PATTERN_INDEX.CLOSED_TWO] * AI_SCORES.CLOSED_TWO;
  attackScore += attackCounts[PATTERN_INDEX.SINGLE] * AI_SCORES.SINGLE;

  const defenseScore = Math.max(
    0,
    calcTotalOppScore(oppBeforeCounts) - calcTotalOppScore(oppAfterCounts)
  );

  // 形状ボーナスは通常評価分支にのみ加算する。
  const shapeBonus = computeShapeBonusFromLines(ownLineCaches, r, c);

  return attackScore * AI_CONFIG.ATTACK_WEIGHT + defenseScore + shapeBonus;
};

// ============================================================
// Top-K 集計（K = EVAL_CONFIG.TOP_K = 3 固定）
// ============================================================

/**
 * 上位 3 手のスコアを保持する集計器。
 * 配列生成や splice を伴わず、固定変数で上位 3 手を管理する。
 */
interface TopKAccumulator {
  top1: number;
  top2: number;
  top3: number;
  /** 挿入済み要素数（最大 3） */
  count: number;
}

const createTopK = (): TopKAccumulator => ({
  top1: -Infinity,
  top2: -Infinity,
  top3: -Infinity,
  count: 0,
});

/**
 * 降順上位 3 手へ値を挿入する。
 * 同点の順序は最終的な減衰合計スコアに影響しない。
 */
const insertTop3 = (acc: TopKAccumulator, val: number): void => {
  if (val >= acc.top1) {
    acc.top3 = acc.top2;
    acc.top2 = acc.top1;
    acc.top1 = val;
    if (acc.count < 3) acc.count++;
  } else if (val >= acc.top2) {
    acc.top3 = acc.top2;
    acc.top2 = val;
    if (acc.count < 3) acc.count++;
  } else if (val >= acc.top3) {
    acc.top3 = val;
    if (acc.count < 3) acc.count++;
  }
};

/**
 * 上位 3 手の減衰合計スコアを算出する。
 * 集計順序は配列版（index 昇順の Math.pow 積算）と一致させ、
 * 浮動小数点の丸め結果を揃える。
 */
const computeTopKScore = (acc: TopKAccumulator, decay: number): number => {
  let total = 0;
  if (acc.count >= 1) total += acc.top1 * Math.pow(decay, 0);
  if (acc.count >= 2) total += acc.top2 * Math.pow(decay, 1);
  if (acc.count >= 3) total += acc.top3 * Math.pow(decay, 2);
  return total;
};

// ============================================================
// 全盤評価（葉ノード向け）
// ============================================================

/**
 * 盤面全体を aiPlayer 視点で評価し、スカラースコアを返す。
 *
 * LineCache 無効時のフォールバック。
 * 評価方式・スコアの意味・優先順位は変更しない。
 */
export const evaluateBoard = (
  board: BoardState,
  aiPlayer: Player,
  forbiddenMoves: boolean[][]
): number => {
  const opp = opponentOf(aiPlayer);
  const decay = EVAL_CONFIG.TOP_K_DECAY;

  const aiLineCaches = DIRECTIONS.map(([dx, dy]) =>
    buildLineCache(board, dx, dy, aiPlayer)
  );
  const oppLineCaches = DIRECTIONS.map(([dx, dy]) =>
    buildLineCache(board, dx, dy, opp)
  );

  const aiTopK = createTopK();
  const oppTopK = createTopK();

  // パターン集計バッファはループ外で 1 回だけ確保し、再利用する。
  const attackCounts = createEmptyPatternCount();
  const oppBeforeCounts = createEmptyPatternCount();
  const oppAfterCounts = createEmptyPatternCount();

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      insertTop3(
        aiTopK,
        scoreFromLineCache(
          r,
          c,
          aiLineCaches,
          oppLineCaches,
          attackCounts,
          oppBeforeCounts,
          oppAfterCounts
        )
      );
      insertTop3(
        oppTopK,
        scoreFromLineCache(
          r,
          c,
          oppLineCaches,
          aiLineCaches,
          attackCounts,
          oppBeforeCounts,
          oppAfterCounts
        )
      );
    }
  }

  if (aiTopK.count === 0 && oppTopK.count === 0) return 0;
  return computeTopKScore(aiTopK, decay) - computeTopKScore(oppTopK, decay);
};

/**
 * LineCache を利用した全盤評価。
 *
 * CandidateSet が渡された場合は候補集合のみを走査し、
 * null の場合は従来通り盤面全体を走査する。
 *
 * 評価式・スコア体系は evaluateBoard と同一。
 */
export const evaluateBoardWithCache = (
  board: BoardState,
  lineCache: LineCacheState,
  aiPlayer: Player,
  forbiddenMoves: boolean[][],
  candidateSet: CandidateSetState | null = null
): number => {
  const opp = opponentOf(aiPlayer);
  const decay = EVAL_CONFIG.TOP_K_DECAY;

  const aiLineCaches = lineCache.caches[aiPlayer];
  const oppLineCaches = lineCache.caches[opp];

  const aiTopK = createTopK();
  const oppTopK = createTopK();

  // パターン集計バッファはループ外で 1 回だけ確保し、再利用する。
  const attackCounts = createEmptyPatternCount();
  const oppBeforeCounts = createEmptyPatternCount();
  const oppAfterCounts = createEmptyPatternCount();

  const scoreCell = (r: number, c: number): void => {
    insertTop3(
      aiTopK,
      scoreFromLineCache(
        r,
        c,
        aiLineCaches,
        oppLineCaches,
        attackCounts,
        oppBeforeCounts,
        oppAfterCounts
      )
    );
    insertTop3(
      oppTopK,
      scoreFromLineCache(
        r,
        c,
        oppLineCaches,
        aiLineCaches,
        attackCounts,
        oppBeforeCounts,
        oppAfterCounts
      )
    );
  };

  if (candidateSet) {
    for (const idx of candidateSet.candidates) {
      const r = Math.floor(idx / BOARD_SIZE);
      const c = idx % BOARD_SIZE;
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      scoreCell(r, c);
    }
  } else {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
        if (!hasStoneNearby(board, r, c)) continue;
        scoreCell(r, c);
      }
    }
  }

  if (aiTopK.count === 0 && oppTopK.count === 0) return 0;
  return computeTopKScore(aiTopK, decay) - computeTopKScore(oppTopK, decay);
};