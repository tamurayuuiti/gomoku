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
  SeparatedScore,
} from '../../types/ai';
import { BOARD_SIZE, DIRECTIONS } from '../gameLogic';
import {
  AI_SCORES,
  AI_CONFIG,
  EVAL_CONFIG,
  EVALUATION_FEATURES,
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

/**
 * キャッシュ済みラインコードから (r, c) への着手価値を攻守分離して算出する。
 *
 * scoreFromLineCache と同一のパターン集計・即時評価判定を行うが、
 * 攻撃スコアと防御スコアを分離して返す。
 * 盤面集約の攻守分離 Top-K で使用する。
 *
 * 即時評価に該当した場合、そのスコアは攻守分類に応じて
 * attackScore または defenseScore のどちらか一方に格納される。
 *
 * @param ownLineCaches 4 方向分の playerColor 視点ラインキャッシュ
 * @param oppLineCaches 4 方向分の相手視点ラインキャッシュ
 * @param attackCounts 攻撃パターン集計バッファ
 * @param oppBeforeCounts 相手 before パターン集計バッファ
 * @param oppAfterCounts 相手 after パターン集計バッファ
 */
const scoreFromLineCacheSeparated = (
  r: number,
  c: number,
  ownLineCaches: number[][][],
  oppLineCaches: number[][][],
  attackCounts: PatternCount,
  oppBeforeCounts: PatternCount,
  oppAfterCounts: PatternCount
): SeparatedScore => {
  attackCounts.fill(0);
  oppBeforeCounts.fill(0);
  oppAfterCounts.fill(0);

  const centerWeight = POSITION_WEIGHT[4];
  for (let d = 0; d < DIRECTIONS.length; d++) {
    const ownCode = ownLineCaches[d][r][c];
    attackCounts[PATTERN_TABLE[ownCode + centerWeight]]++;

    const oppCode = oppLineCaches[d][r][c];
    oppBeforeCounts[PATTERN_TABLE[oppCode + centerWeight]]++;
    oppAfterCounts[PATTERN_TABLE[oppCode + 2 * centerWeight]]++;
  }

  // --- 即時評価（scoreFromLineCache と同一の優先順位） ---
  // 即時評価セルは攻守分類に応じて片方のスコアに格納する。

  if (attackCounts[PATTERN_INDEX.WIN] > 0) {
    return {
      attackScore: AI_SCORES.WIN,
      defenseScore: 0,
      totalScore: AI_SCORES.WIN,
      isImmediate: true,
      immediateSide: 'attack',
    };
  }
  if (
    oppBeforeCounts[PATTERN_INDEX.WIN] > 0 &&
    oppAfterCounts[PATTERN_INDEX.WIN] === 0
  ) {
    return {
      attackScore: 0,
      defenseScore: AI_SCORES.DEFEND_WIN,
      totalScore: AI_SCORES.DEFEND_WIN,
      isImmediate: true,
      immediateSide: 'defense',
    };
  }
  if (attackCounts[PATTERN_INDEX.OPEN_FOUR] > 0) {
    return {
      attackScore: AI_SCORES.OPEN_FOUR,
      defenseScore: 0,
      totalScore: AI_SCORES.OPEN_FOUR,
      isImmediate: true,
      immediateSide: 'attack',
    };
  }
  if (attackCounts[PATTERN_INDEX.CLOSED_FOUR] >= 2) {
    return {
      attackScore: AI_SCORES.DOUBLE_FOUR,
      defenseScore: 0,
      totalScore: AI_SCORES.DOUBLE_FOUR,
      isImmediate: true,
      immediateSide: 'attack',
    };
  }
  if (
    attackCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
    attackCounts[PATTERN_INDEX.OPEN_THREE] >= 1
  ) {
    return {
      attackScore: AI_SCORES.FOUR_THREE,
      defenseScore: 0,
      totalScore: AI_SCORES.FOUR_THREE,
      isImmediate: true,
      immediateSide: 'attack',
    };
  }
  if (
    oppBeforeCounts[PATTERN_INDEX.OPEN_FOUR] > 0 &&
    oppAfterCounts[PATTERN_INDEX.OPEN_FOUR] <
      oppBeforeCounts[PATTERN_INDEX.OPEN_FOUR]
  ) {
    return {
      attackScore: 0,
      defenseScore: AI_SCORES.OPEN_FOUR,
      totalScore: AI_SCORES.OPEN_FOUR,
      isImmediate: true,
      immediateSide: 'defense',
    };
  }
  if (
    oppBeforeCounts[PATTERN_INDEX.CLOSED_FOUR] >= 2 &&
    oppAfterCounts[PATTERN_INDEX.CLOSED_FOUR] < 2
  ) {
    return {
      attackScore: 0,
      defenseScore: AI_SCORES.DOUBLE_FOUR,
      totalScore: AI_SCORES.DOUBLE_FOUR,
      isImmediate: true,
      immediateSide: 'defense',
    };
  }
  if (
    oppBeforeCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
    oppBeforeCounts[PATTERN_INDEX.OPEN_THREE] >= 1 &&
    !(
      oppAfterCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
      oppAfterCounts[PATTERN_INDEX.OPEN_THREE] >= 1
    )
  ) {
    return {
      attackScore: 0,
      defenseScore: AI_SCORES.FOUR_THREE,
      totalScore: AI_SCORES.FOUR_THREE,
      isImmediate: true,
      immediateSide: 'defense',
    };
  }
  if (attackCounts[PATTERN_INDEX.OPEN_THREE] >= 2) {
    return {
      attackScore: AI_SCORES.DOUBLE_THREE,
      defenseScore: 0,
      totalScore: AI_SCORES.DOUBLE_THREE,
      isImmediate: true,
      immediateSide: 'attack',
    };
  }
  if (
    oppBeforeCounts[PATTERN_INDEX.OPEN_THREE] >= 2 &&
    oppAfterCounts[PATTERN_INDEX.OPEN_THREE] < 2
  ) {
    return {
      attackScore: 0,
      defenseScore: AI_SCORES.DOUBLE_THREE,
      totalScore: AI_SCORES.DOUBLE_THREE,
      isImmediate: true,
      immediateSide: 'defense',
    };
  }

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

  // 形状ボーナスは攻撃スコアに含める。
  const shapeBonus = computeShapeBonusFromLines(ownLineCaches, r, c);
  const weightedAttack = attackScore * AI_CONFIG.ATTACK_WEIGHT + shapeBonus;

  return {
    attackScore: weightedAttack,
    defenseScore,
    totalScore: weightedAttack + defenseScore,
    isImmediate: false,
  };
};

// ============================================================
// Top-K 集計
// ============================================================

/**
 * 上位 K 手のスコアを保持する集計器。
 * 配列生成や splice を伴わず、固定変数で上位手を管理する。
 * K=3 の場合は top1〜top3、K=5 の場合は top1〜top5 を使用する。
 */
interface TopKAccumulator {
  top1: number;
  top2: number;
  top3: number;
  top4: number;
  top5: number;
  /** 挿入済み要素数 */
  count: number;
}

const createTopK = (): TopKAccumulator => ({
  top1: -Infinity,
  top2: -Infinity,
  top3: -Infinity,
  top4: -Infinity,
  top5: -Infinity,
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
 * 降順上位 5 手へ値を挿入する。
 * K=5 の盤面集約で使用する。
 */
const insertTop5 = (acc: TopKAccumulator, val: number): void => {
  if (val >= acc.top1) {
    acc.top5 = acc.top4;
    acc.top4 = acc.top3;
    acc.top3 = acc.top2;
    acc.top2 = acc.top1;
    acc.top1 = val;
    if (acc.count < 5) acc.count++;
  } else if (val >= acc.top2) {
    acc.top5 = acc.top4;
    acc.top4 = acc.top3;
    acc.top3 = acc.top2;
    acc.top2 = val;
    if (acc.count < 5) acc.count++;
  } else if (val >= acc.top3) {
    acc.top5 = acc.top4;
    acc.top4 = acc.top3;
    acc.top3 = val;
    if (acc.count < 5) acc.count++;
  } else if (val >= acc.top4) {
    acc.top5 = acc.top4;
    acc.top4 = val;
    if (acc.count < 5) acc.count++;
  } else if (val >= acc.top5) {
    acc.top5 = val;
    if (acc.count < 5) acc.count++;
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

/**
 * 上位 5 手の減衰合計スコアを算出する。
 * K=5 の盤面集約で使用する。
 */
const computeTopKScoreEnhanced = (acc: TopKAccumulator, decay: number): number => {
  let total = 0;
  if (acc.count >= 1) total += acc.top1 * Math.pow(decay, 0);
  if (acc.count >= 2) total += acc.top2 * Math.pow(decay, 1);
  if (acc.count >= 3) total += acc.top3 * Math.pow(decay, 2);
  if (acc.count >= 4) total += acc.top4 * Math.pow(decay, 3);
  if (acc.count >= 5) total += acc.top5 * Math.pow(decay, 4);
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

  const enhancedTopK = EVALUATION_FEATURES.ENABLE_ENHANCED_TOP_K;
  const balancedAgg = EVALUATION_FEATURES.ENABLE_BALANCED_AGGREGATION;
  const threatDensity = EVALUATION_FEATURES.ENABLE_THREAT_DENSITY;

  const decay = enhancedTopK
    ? EVAL_CONFIG.TOP_K_DECAY_ENHANCED
    : EVAL_CONFIG.TOP_K_DECAY;

  const aiLineCaches = DIRECTIONS.map(([dx, dy]) =>
    buildLineCache(board, dx, dy, aiPlayer)
  );
  const oppLineCaches = DIRECTIONS.map(([dx, dy]) =>
    buildLineCache(board, dx, dy, opp)
  );

  // Top-K 集計器の生成。攻守分離時は 4 個、通常は 2 個。
  let aiTopK: TopKAccumulator | null = null;
  let oppTopK: TopKAccumulator | null = null;
  let aiAttackTopK: TopKAccumulator | null = null;
  let aiDefenseTopK: TopKAccumulator | null = null;
  let oppAttackTopK: TopKAccumulator | null = null;
  let oppDefenseTopK: TopKAccumulator | null = null;

  if (balancedAgg) {
    aiAttackTopK = createTopK();
    aiDefenseTopK = createTopK();
    oppAttackTopK = createTopK();
    oppDefenseTopK = createTopK();
  } else {
    aiTopK = createTopK();
    oppTopK = createTopK();
  }

  // 脅威密度の累積値
  let threatDensityAi = 0;
  let threatDensityOpp = 0;

  // パターン集計バッファはループ外で 1 回だけ確保し、再利用する。
  const attackCounts = createEmptyPatternCount();
  const oppBeforeCounts = createEmptyPatternCount();
  const oppAfterCounts = createEmptyPatternCount();

  // K に応じた挿入関数の選択
  const insertFn = enhancedTopK ? insertTop5 : insertTop3;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      if (balancedAgg) {
        // 攻守分離集約
        const aiSep = scoreFromLineCacheSeparated(
          r, c, aiLineCaches, oppLineCaches,
          attackCounts, oppBeforeCounts, oppAfterCounts
        );
        const oppSep = scoreFromLineCacheSeparated(
          r, c, oppLineCaches, aiLineCaches,
          attackCounts, oppBeforeCounts, oppAfterCounts
        );

        // AI 側の攻守 Top-K への挿入
        if (aiSep.isImmediate) {
          if (aiSep.immediateSide === 'attack') {
            insertFn(aiAttackTopK!, aiSep.totalScore);
          } else {
            insertFn(aiDefenseTopK!, aiSep.totalScore);
          }
        } else {
          if (aiSep.attackScore > 0) insertFn(aiAttackTopK!, aiSep.attackScore);
          if (aiSep.defenseScore > 0) insertFn(aiDefenseTopK!, aiSep.defenseScore);
        }

        // 相手側の攻守 Top-K への挿入
        if (oppSep.isImmediate) {
          if (oppSep.immediateSide === 'attack') {
            insertFn(oppAttackTopK!, oppSep.totalScore);
          } else {
            insertFn(oppDefenseTopK!, oppSep.totalScore);
          }
        } else {
          if (oppSep.attackScore > 0) insertFn(oppAttackTopK!, oppSep.attackScore);
          if (oppSep.defenseScore > 0) insertFn(oppDefenseTopK!, oppSep.defenseScore);
        }

        // 脅威密度の集計（即時評価セルは除外）
        if (threatDensity) {
          if (aiSep.totalScore < EVAL_CONFIG.THREAT_DENSITY_EXCLUDE_THRESHOLD) {
            threatDensityAi += Math.max(
              0,
              aiSep.totalScore - EVAL_CONFIG.THREAT_DENSITY_THRESHOLD
            );
          }
          if (oppSep.totalScore < EVAL_CONFIG.THREAT_DENSITY_EXCLUDE_THRESHOLD) {
            threatDensityOpp += Math.max(
              0,
              oppSep.totalScore - EVAL_CONFIG.THREAT_DENSITY_THRESHOLD
            );
          }
        }
      } else {
        // 通常の合成スコア集約
        const aiScore = scoreFromLineCache(
          r, c, aiLineCaches, oppLineCaches,
          attackCounts, oppBeforeCounts, oppAfterCounts
        );
        const oppScore = scoreFromLineCache(
          r, c, oppLineCaches, aiLineCaches,
          attackCounts, oppBeforeCounts, oppAfterCounts
        );

        insertFn(aiTopK!, aiScore);
        insertFn(oppTopK!, oppScore);

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
  }

  // 最終スコアの算出
  let finalScore: number;

  if (balancedAgg) {
    const attackDecay = EVAL_CONFIG.ATTACK_TOP_K_DECAY;
    const defenseDecay = EVAL_CONFIG.DEFENSE_TOP_K_DECAY;
    const attackWeight = EVAL_CONFIG.ATTACK_AGG_WEIGHT;
    const defenseWeight = EVAL_CONFIG.DEFENSE_AGG_WEIGHT;
    const computeFn = enhancedTopK ? computeTopKScoreEnhanced : computeTopKScore;

    // 全 Top-K が空の場合は 0 を返す
    if (
      aiAttackTopK!.count === 0 &&
      aiDefenseTopK!.count === 0 &&
      oppAttackTopK!.count === 0 &&
      oppDefenseTopK!.count === 0
    ) {
      return 0;
    }

    const aiAttackAgg = computeFn(aiAttackTopK!, attackDecay);
    const aiDefenseAgg = computeFn(aiDefenseTopK!, defenseDecay);
    const oppAttackAgg = computeFn(oppAttackTopK!, attackDecay);
    const oppDefenseAgg = computeFn(oppDefenseTopK!, defenseDecay);

    finalScore =
      (aiAttackAgg * attackWeight + aiDefenseAgg * defenseWeight) -
      (oppAttackAgg * attackWeight + oppDefenseAgg * defenseWeight);
  } else {
    const computeFn = enhancedTopK ? computeTopKScoreEnhanced : computeTopKScore;

    if (aiTopK!.count === 0 && oppTopK!.count === 0) return 0;
    finalScore = computeFn(aiTopK!, decay) - computeFn(oppTopK!, decay);
  }

  // 脅威密度ボーナスの加算
  if (threatDensity) {
    const densityBonus =
      (threatDensityAi - threatDensityOpp) * EVAL_CONFIG.THREAT_DENSITY_COEFFICIENT;
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

  const enhancedTopK = EVALUATION_FEATURES.ENABLE_ENHANCED_TOP_K;
  const balancedAgg = EVALUATION_FEATURES.ENABLE_BALANCED_AGGREGATION;
  const threatDensity = EVALUATION_FEATURES.ENABLE_THREAT_DENSITY;

  const decay = enhancedTopK
    ? EVAL_CONFIG.TOP_K_DECAY_ENHANCED
    : EVAL_CONFIG.TOP_K_DECAY;

  const aiLineCaches = lineCache.caches[aiPlayer];
  const oppLineCaches = lineCache.caches[opp];

  // Top-K 集計器の生成。攻守分離時は 4 個、通常は 2 個。
  let aiTopK: TopKAccumulator | null = null;
  let oppTopK: TopKAccumulator | null = null;
  let aiAttackTopK: TopKAccumulator | null = null;
  let aiDefenseTopK: TopKAccumulator | null = null;
  let oppAttackTopK: TopKAccumulator | null = null;
  let oppDefenseTopK: TopKAccumulator | null = null;

  if (balancedAgg) {
    aiAttackTopK = createTopK();
    aiDefenseTopK = createTopK();
    oppAttackTopK = createTopK();
    oppDefenseTopK = createTopK();
  } else {
    aiTopK = createTopK();
    oppTopK = createTopK();
  }

  // 脅威密度の累積値
  let threatDensityAi = 0;
  let threatDensityOpp = 0;

  // パターン集計バッファはループ外で 1 回だけ確保し、再利用する。
  const attackCounts = createEmptyPatternCount();
  const oppBeforeCounts = createEmptyPatternCount();
  const oppAfterCounts = createEmptyPatternCount();

  // K に応じた挿入関数の選択
  const insertFn = enhancedTopK ? insertTop5 : insertTop3;

  const scoreCell = (r: number, c: number): void => {
    if (balancedAgg) {
      // 攻守分離集約
      const aiSep = scoreFromLineCacheSeparated(
        r, c, aiLineCaches, oppLineCaches,
        attackCounts, oppBeforeCounts, oppAfterCounts
      );
      const oppSep = scoreFromLineCacheSeparated(
        r, c, oppLineCaches, aiLineCaches,
        attackCounts, oppBeforeCounts, oppAfterCounts
      );

      // AI 側の攻守 Top-K への挿入
      if (aiSep.isImmediate) {
        if (aiSep.immediateSide === 'attack') {
          insertFn(aiAttackTopK!, aiSep.totalScore);
        } else {
          insertFn(aiDefenseTopK!, aiSep.totalScore);
        }
      } else {
        if (aiSep.attackScore > 0) insertFn(aiAttackTopK!, aiSep.attackScore);
        if (aiSep.defenseScore > 0) insertFn(aiDefenseTopK!, aiSep.defenseScore);
      }

      // 相手側の攻守 Top-K への挿入
      if (oppSep.isImmediate) {
        if (oppSep.immediateSide === 'attack') {
          insertFn(oppAttackTopK!, oppSep.totalScore);
        } else {
          insertFn(oppDefenseTopK!, oppSep.totalScore);
        }
      } else {
        if (oppSep.attackScore > 0) insertFn(oppAttackTopK!, oppSep.attackScore);
        if (oppSep.defenseScore > 0) insertFn(oppDefenseTopK!, oppSep.defenseScore);
      }

      // 脅威密度の集計（即時評価セルは除外）
      if (threatDensity) {
        if (aiSep.totalScore < EVAL_CONFIG.THREAT_DENSITY_EXCLUDE_THRESHOLD) {
          threatDensityAi += Math.max(
            0,
            aiSep.totalScore - EVAL_CONFIG.THREAT_DENSITY_THRESHOLD
          );
        }
        if (oppSep.totalScore < EVAL_CONFIG.THREAT_DENSITY_EXCLUDE_THRESHOLD) {
          threatDensityOpp += Math.max(
            0,
            oppSep.totalScore - EVAL_CONFIG.THREAT_DENSITY_THRESHOLD
          );
        }
      }
    } else {
      // 通常の合成スコア集約
      const aiScore = scoreFromLineCache(
        r, c, aiLineCaches, oppLineCaches,
        attackCounts, oppBeforeCounts, oppAfterCounts
      );
      const oppScore = scoreFromLineCache(
        r, c, oppLineCaches, aiLineCaches,
        attackCounts, oppBeforeCounts, oppAfterCounts
      );

      insertFn(aiTopK!, aiScore);
      insertFn(oppTopK!, oppScore);

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

  // 最終スコアの算出
  let finalScore: number;

  if (balancedAgg) {
    const attackDecay = EVAL_CONFIG.ATTACK_TOP_K_DECAY;
    const defenseDecay = EVAL_CONFIG.DEFENSE_TOP_K_DECAY;
    const attackWeight = EVAL_CONFIG.ATTACK_AGG_WEIGHT;
    const defenseWeight = EVAL_CONFIG.DEFENSE_AGG_WEIGHT;
    const computeFn = enhancedTopK ? computeTopKScoreEnhanced : computeTopKScore;

    // 全 Top-K が空の場合は 0 を返す
    if (
      aiAttackTopK!.count === 0 &&
      aiDefenseTopK!.count === 0 &&
      oppAttackTopK!.count === 0 &&
      oppDefenseTopK!.count === 0
    ) {
      return 0;
    }

    const aiAttackAgg = computeFn(aiAttackTopK!, attackDecay);
    const aiDefenseAgg = computeFn(aiDefenseTopK!, defenseDecay);
    const oppAttackAgg = computeFn(oppAttackTopK!, attackDecay);
    const oppDefenseAgg = computeFn(oppDefenseTopK!, defenseDecay);

    finalScore =
      (aiAttackAgg * attackWeight + aiDefenseAgg * defenseWeight) -
      (oppAttackAgg * attackWeight + oppDefenseAgg * defenseWeight);
  } else {
    const computeFn = enhancedTopK ? computeTopKScoreEnhanced : computeTopKScore;

    if (aiTopK!.count === 0 && oppTopK!.count === 0) return 0;
    finalScore = computeFn(aiTopK!, decay) - computeFn(oppTopK!, decay);
  }

  // 脅威密度ボーナスの加算
  if (threatDensity) {
    const densityBonus =
      (threatDensityAi - threatDensityOpp) * EVAL_CONFIG.THREAT_DENSITY_COEFFICIENT;
    const clampedBonus = Math.max(
      -EVAL_CONFIG.THREAT_DENSITY_MAX,
      Math.min(EVAL_CONFIG.THREAT_DENSITY_MAX, densityBonus)
    );
    finalScore += clampedBonus;
  }

  return finalScore;
};