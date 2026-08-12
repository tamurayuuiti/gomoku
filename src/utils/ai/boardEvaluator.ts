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
  EVALUATION_FEATURES,
  PERF_FEATURES,
} from './constants';
import {
  createEmptyPatternCount,
  hasStoneNearby,
  opponentOf,
  computeShapeBonusFromLines,
  PATTERN_INDEX,
  PATTERN_TABLE,
  POSITION_WEIGHT,
  CENTER_WEIGHT,
  calcTotalOppScore,
  calcTotalOppScoreFromPacked,
  computeShapeBonusFromLinesLut,
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
 * キャッシュ済みラインコードから (r, c) への着手価値を算出する（Legacy 版）。
 *
 * パターン集計バッファは呼び出し元で確保・再利用し、
 * 本関数の先頭で fill(0) して使う。
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

  for (let d = 0; d < DIRECTIONS.length; d++) {
    // 中心セルは空マス前提のため、中心値を加算してテーブル参照する。
    const ownCode = ownLineCaches[d][r][c];
    attackCounts[PATTERN_TABLE[ownCode + CENTER_WEIGHT]]++;

    const oppCode = oppLineCaches[d][r][c];
    oppBeforeCounts[PATTERN_TABLE[oppCode + CENTER_WEIGHT]]++;
    oppAfterCounts[PATTERN_TABLE[oppCode + 2 * CENTER_WEIGHT]]++;
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

/**
 * キャッシュ済みラインコードから (r, c) への着手価値を算出する（Packed Integer 版）。
 *
 * 配列ベースのバッファを使用せず、24-bit 整数 3 個でパターン集計を行う。
 * 即時評価の優先順位・通常評価の加算順は Legacy 版と完全一致する。
 */
const scoreFromLineCachePacked = (
  r: number,
  c: number,
  ownLineCaches: number[][][],
  oppLineCaches: number[][][]
): number => {
  let attackPacked = 0;
  let oppBeforePacked = 0;
  let oppAfterPacked = 0;

  for (let d = 0; d < DIRECTIONS.length; d++) {
    const ownCode = ownLineCaches[d][r][c];
    attackPacked += 1 << (PATTERN_TABLE[ownCode + CENTER_WEIGHT] * 3);

    const oppCode = oppLineCaches[d][r][c];
    oppBeforePacked += 1 << (PATTERN_TABLE[oppCode + CENTER_WEIGHT] * 3);
    oppAfterPacked += 1 << (PATTERN_TABLE[oppCode + 2 * CENTER_WEIGHT] * 3);
  }

  // --- 即時評価（evaluatePosition と同一の優先順位） ---
  if ((attackPacked & 0x7) > 0) return AI_SCORES.WIN;
  if (
    ((oppBeforePacked & 0x7) > 0) &&
    ((oppAfterPacked & 0x7) === 0)
  )
    return AI_SCORES.DEFEND_WIN;
  if (((attackPacked >> 3) & 0x7) > 0) return AI_SCORES.OPEN_FOUR;
  if (((attackPacked >> 6) & 0x7) >= 2) return AI_SCORES.DOUBLE_FOUR;
  if (
    ((attackPacked >> 6) & 0x7) >= 1 &&
    ((attackPacked >> 9) & 0x7) >= 1
  )
    return AI_SCORES.FOUR_THREE;

  if (
    ((oppBeforePacked >> 3) & 0x7) > 0 &&
    ((oppAfterPacked >> 3) & 0x7) < ((oppBeforePacked >> 3) & 0x7)
  )
    return AI_SCORES.OPEN_FOUR;
  if (
    ((oppBeforePacked >> 6) & 0x7) >= 2 &&
    ((oppAfterPacked >> 6) & 0x7) < 2
  )
    return AI_SCORES.DOUBLE_FOUR;
  if (
    ((oppBeforePacked >> 6) & 0x7) >= 1 &&
    ((oppBeforePacked >> 9) & 0x7) >= 1 &&
    !(
      ((oppAfterPacked >> 6) & 0x7) >= 1 &&
      ((oppAfterPacked >> 9) & 0x7) >= 1
    )
  )
    return AI_SCORES.FOUR_THREE;

  if (((attackPacked >> 9) & 0x7) >= 2) return AI_SCORES.DOUBLE_THREE;
  if (
    ((oppBeforePacked >> 9) & 0x7) >= 2 &&
    ((oppAfterPacked >> 9) & 0x7) < 2
  )
    return AI_SCORES.DOUBLE_THREE;

  // --- 通常評価（加算順は Legacy 版と完全一致） ---
  let attackScore = 0;
  attackScore += ((attackPacked >> 6) & 0x7) * AI_SCORES.CLOSED_FOUR;
  attackScore += ((attackPacked >> 9) & 0x7) * AI_SCORES.OPEN_THREE;
  attackScore += ((attackPacked >> 12) & 0x7) * AI_SCORES.CLOSED_THREE;
  attackScore += ((attackPacked >> 15) & 0x7) * AI_SCORES.OPEN_TWO;
  attackScore += ((attackPacked >> 18) & 0x7) * AI_SCORES.CLOSED_TWO;
  attackScore += ((attackPacked >> 21) & 0x7) * AI_SCORES.SINGLE;

  const defenseScore = Math.max(
    0,
    calcTotalOppScoreFromPacked(oppBeforePacked) -
      calcTotalOppScoreFromPacked(oppAfterPacked)
  );

  const shapeBonus = computeShapeBonusFromLinesLut(ownLineCaches, r, c);

  return attackScore * AI_CONFIG.ATTACK_WEIGHT + defenseScore + shapeBonus;
};

// ============================================================
// Top-K 集計
// ============================================================

/**
 * 上位 K 手のスコアを保持する集計器。
 * 配列生成や splice を伴わず、固定変数で上位手を管理する。
 * K=3 の場合は top1〜top3 を使用する。
 */
interface TopKAccumulator {
  top1: number;
  top2: number;
  top3: number;
  /** 挿入済み要素数 */
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
  const threatDensity = EVALUATION_FEATURES.ENABLE_THREAT_DENSITY;
  const decay = EVAL_CONFIG.TOP_K_DECAY;

  const aiLineCaches = DIRECTIONS.map(([dx, dy]) =>
    buildLineCache(board, dx, dy, aiPlayer)
  );
  const oppLineCaches = DIRECTIONS.map(([dx, dy]) =>
    buildLineCache(board, dx, dy, opp)
  );

  // Top-K 集計器の生成
  const aiTopK = createTopK();
  const oppTopK = createTopK();

  // 脅威密度の累積値
  let threatDensityAi = 0;
  let threatDensityOpp = 0;

  // パターン集計バッファはループ外で 1 回だけ確保し、再利用する（Legacy 版用）。
  const attackCounts = createEmptyPatternCount();
  const oppBeforeCounts = createEmptyPatternCount();
  const oppAfterCounts = createEmptyPatternCount();

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      let aiScore: number;
      let oppScore: number;

      if (PERF_FEATURES.ENABLE_PACKED_EVALUATION) {
        aiScore = scoreFromLineCachePacked(r, c, aiLineCaches, oppLineCaches);
        oppScore = scoreFromLineCachePacked(r, c, oppLineCaches, aiLineCaches);
      } else {
        aiScore = scoreFromLineCache(
          r,
          c,
          aiLineCaches,
          oppLineCaches,
          attackCounts,
          oppBeforeCounts,
          oppAfterCounts
        );
        oppScore = scoreFromLineCache(
          r,
          c,
          oppLineCaches,
          aiLineCaches,
          attackCounts,
          oppBeforeCounts,
          oppAfterCounts
        );
      }

      insertTop3(aiTopK, aiScore);
      insertTop3(oppTopK, oppScore);

      // 脅威密度の集計（即時評価セルは除外）
      if (threatDensity) {
        if (aiScore < EVAL_CONFIG.THREAT_DENSITY_EXCLUDE_THRESHOLD) {
          threatDensityAi += Math.max(
            0,
            aiScore - EVAL_CONFIG.THREAT_DENSITY_THRESHOLD
          );
        }
        if (oppScore < EVAL_CONFIG.THREAT_DENSITY_EXCLUDE_THRESHOLD) {
          threatDensityOpp += Math.max(
            0,
            oppScore - EVAL_CONFIG.THREAT_DENSITY_THRESHOLD
          );
        }
      }
    }
  }

  if (aiTopK.count === 0 && oppTopK.count === 0) return 0;

  let finalScore =
    computeTopKScore(aiTopK, decay) - computeTopKScore(oppTopK, decay);

  // 脅威密度ボーナスの加算
  if (threatDensity) {
    const densityBonus =
      (threatDensityAi - threatDensityOpp) *
      EVAL_CONFIG.THREAT_DENSITY_COEFFICIENT;
    const clampedBonus = Math.max(
      -EVAL_CONFIG.THREAT_DENSITY_MAX,
      Math.min(EVAL_CONFIG.THREAT_DENSITY_MAX, densityBonus)
    );
    finalScore += clampedBonus;
  }

  return finalScore;
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
  const threatDensity = EVALUATION_FEATURES.ENABLE_THREAT_DENSITY;
  const decay = EVAL_CONFIG.TOP_K_DECAY;

  const aiLineCaches = lineCache.caches[aiPlayer];
  const oppLineCaches = lineCache.caches[opp];

  // Top-K 集計器の生成
  const aiTopK = createTopK();
  const oppTopK = createTopK();

  // 脅威密度の累積値
  let threatDensityAi = 0;
  let threatDensityOpp = 0;

  // パターン集計バッファはループ外で 1 回だけ確保し、再利用する（Legacy 版用）。
  const attackCounts = createEmptyPatternCount();
  const oppBeforeCounts = createEmptyPatternCount();
  const oppAfterCounts = createEmptyPatternCount();

  const scoreCell = (r: number, c: number): void => {
    let aiScore: number;
    let oppScore: number;

    if (PERF_FEATURES.ENABLE_PACKED_EVALUATION) {
      aiScore = scoreFromLineCachePacked(r, c, aiLineCaches, oppLineCaches);
      oppScore = scoreFromLineCachePacked(r, c, oppLineCaches, aiLineCaches);
    } else {
      aiScore = scoreFromLineCache(
        r,
        c,
        aiLineCaches,
        oppLineCaches,
        attackCounts,
        oppBeforeCounts,
        oppAfterCounts
      );
      oppScore = scoreFromLineCache(
        r,
        c,
        oppLineCaches,
        aiLineCaches,
        attackCounts,
        oppBeforeCounts,
        oppAfterCounts
      );
    }

    insertTop3(aiTopK, aiScore);
    insertTop3(oppTopK, oppScore);

    // 脅威密度の集計（即時評価セルは除外）
    if (threatDensity) {
      if (aiScore < EVAL_CONFIG.THREAT_DENSITY_EXCLUDE_THRESHOLD) {
        threatDensityAi += Math.max(
          0,
          aiScore - EVAL_CONFIG.THREAT_DENSITY_THRESHOLD
        );
      }
      if (oppScore < EVAL_CONFIG.THREAT_DENSITY_EXCLUDE_THRESHOLD) {
        threatDensityOpp += Math.max(
          0,
          oppScore - EVAL_CONFIG.THREAT_DENSITY_THRESHOLD
        );
      }
    }
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

  let finalScore =
    computeTopKScore(aiTopK, decay) - computeTopKScore(oppTopK, decay);

  // 脅威密度ボーナスの加算
  if (threatDensity) {
    const densityBonus =
      (threatDensityAi - threatDensityOpp) *
      EVAL_CONFIG.THREAT_DENSITY_COEFFICIENT;
    const clampedBonus = Math.max(
      -EVAL_CONFIG.THREAT_DENSITY_MAX,
      Math.min(EVAL_CONFIG.THREAT_DENSITY_MAX, densityBonus)
    );
    finalScore += clampedBonus;
  }

  return finalScore;
};