// src/utils/ai/evaluator.ts
// 位置評価・パターン検出・パターンテーブルを担うモジュール。
//
// 責務:
//   - 3 進整数エンコードされたラインのパターン判定（テーブル参照）
//   - 1手単位の位置評価（evaluatePosition）
//   - LineCache 利用版の評価
//   - ライン整数エンコード・WIN_MASK による高速勝利判定
//
// 注意:
//   - 全盤評価（evaluateBoard）は boardEvaluator.ts に委譲する。
//   - 評価スコア体系・即時評価の優先順位は変更しない。

import type { BoardState, Player } from '../../types/game';
import type { PatternType, PatternCount, LineCacheState } from '../../types/ai';
import { BOARD_SIZE, DIRECTIONS } from '../gameLogic';
import {
  AI_SCORES,
  AI_CONFIG,
  EVAL_CONFIG,
  EVALUATION_FEATURES,
} from './constants';

// ============================================================
// 共有ユーティリティ
// ============================================================

export const opponentOf = (player: Player): Player =>
  player === 'Black' ? 'White' : 'Black';

/**
 * 指定セルの周辺（SEARCH_RANGE 以内）に石があるか判定する。
 * 候補手の絞り込みに使用する。
 */
export const hasStoneNearby = (
  board: BoardState,
  row: number,
  col: number
): boolean => {
  const range = AI_CONFIG.SEARCH_RANGE;
  for (
    let r = Math.max(0, row - range);
    r <= Math.min(BOARD_SIZE - 1, row + range);
    r++
  ) {
    for (
      let c = Math.max(0, col - range);
      c <= Math.min(BOARD_SIZE - 1, col + range);
      c++
    ) {
      if (board[r][c] !== null) return true;
    }
  }
  return false;
};

// ============================================================
// パターン集計
// ============================================================

/**
 * PatternType を固定長配列のインデックスへ変換するマッピング。
 * PatternCount はこのインデックスで集計する固定長数値配列として扱う。
 */
export const PATTERN_INDEX: Record<PatternType, number> = {
  WIN: 0,
  OPEN_FOUR: 1,
  CLOSED_FOUR: 2,
  OPEN_THREE: 3,
  CLOSED_THREE: 4,
  OPEN_TWO: 5,
  CLOSED_TWO: 6,
  SINGLE: 7,
};

/** PatternCount の固定長 */
export const PATTERN_COUNT_SIZE = 8;

/**
 * 空のパターン集計配列を生成する。
 * 固定長数値配列であり、インデックスは PATTERN_INDEX と対応する。
 */
export const createEmptyPatternCount = (): PatternCount => {
  return new Array<number>(PATTERN_COUNT_SIZE).fill(0);
};

/**
 * 相手パターン集計から防御側の脅威スコア合計を算出する。
 * 即時評価には含めない通常評価分支でのみ使用する。
 */
export const calcTotalOppScore = (counts: PatternCount): number => {
  let score = 0;
  score += counts[PATTERN_INDEX.CLOSED_FOUR] * AI_SCORES.CLOSED_FOUR;
  score += counts[PATTERN_INDEX.OPEN_THREE] * AI_SCORES.OPEN_THREE;
  score += counts[PATTERN_INDEX.CLOSED_THREE] * AI_SCORES.CLOSED_THREE;
  score += counts[PATTERN_INDEX.OPEN_TWO] * AI_SCORES.OPEN_TWO;
  score += counts[PATTERN_INDEX.CLOSED_TWO] * AI_SCORES.CLOSED_TWO;
  return score;
};

// ============================================================
// ライン整数エンコード
// ============================================================

/**
 * 各ライン位置の 3 進重み。POSITION_WEIGHT[i] = 3^i。
 * ラインコードは code = d[0]*3^0 + d[1]*3^1 + ... + d[8]*3^8 で構成される。
 * d[i] の取りうる値: 0 = 空マス, 1 = 視点プレイヤーの石, 2 = 相手石または盤外。
 */
export const POSITION_WEIGHT: readonly number[] = [
  1, 3, 9, 27, 81, 243, 729, 2187, 6561,
];

/** ラインコードの全パターン数（= 3^9） */
export const LINE_CODE_SPACE = 19683;

/** 中心セル（index 4）の 3 進重み */
const CENTER_WEIGHT = POSITION_WEIGHT[4];

/**
 * ラインコードの指定位置のセル値（0/1/2）を取り出す。
 */
const extractDigit = (code: number, pos: number): number =>
  Math.floor(code / POSITION_WEIGHT[pos]) % 3;

/**
 * 指定位置を中心とした 1 方向 9 セルのラインコード（3 進整数）を返す。
 *
 * - 1 = color の石
 * - 0 = 空マス
 * - 2 = 盤外 / 相手石
 *
 * centerValue を 2 にすると、
 * 「ここに相手石が置かれた場合」の after-state パターンとして使える。
 */
export const getLineCode = (
  board: BoardState,
  row: number,
  col: number,
  dx: number,
  dy: number,
  color: Player,
  centerValue: number = 1
): number => {
  let code = 0;
  for (let i = -4; i <= 4; i++) {
    const pos = i + 4;
    let value: number;
    if (i === 0) {
      value = centerValue;
    } else {
      const r = row + i * dx;
      const c = col + i * dy;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
        value = 2;
      } else if (board[r][c] === color) {
        value = 1;
      } else if (board[r][c] === null) {
        value = 0;
      } else {
        value = 2;
      }
    }
    code += value * POSITION_WEIGHT[pos];
  }
  return code;
};

// ============================================================
// パターンテーブル
// ============================================================

/**
 * テーブル生成専用のパターン判定。
 * 9 文字ライン文字列を受け取り、PATTERN_INDEX のインデックス値（0〜7）を返す。
 * 判定ロジック・優先順位は従来のパターン検出と完全に一致する。
 */
const detectPatternForTable = (s: string): number => {
  if (s.includes('11111')) return PATTERN_INDEX.WIN;
  if (s.includes('011110')) return PATTERN_INDEX.OPEN_FOUR;
  if (
    s.includes('011112') ||
    s.includes('211110') ||
    s.includes('10111') ||
    s.includes('11011') ||
    s.includes('11101')
  ) {
    return PATTERN_INDEX.CLOSED_FOUR;
  }
  if (
    s.includes('011100') ||
    s.includes('001110') ||
    s.includes('010110') ||
    s.includes('011010')
  ) {
    return PATTERN_INDEX.OPEN_THREE;
  }
  if (
    s.includes('001112') ||
    s.includes('211100') ||
    s.includes('010112') ||
    s.includes('211010') ||
    s.includes('011012') ||
    s.includes('210110') ||
    s.includes('10011') ||
    s.includes('11001') ||
    s.includes('10101')
  ) {
    return PATTERN_INDEX.CLOSED_THREE;
  }
  if (
    s.includes('001100') ||
    s.includes('011000') ||
    s.includes('000110') ||
    s.includes('010100') ||
    s.includes('001010') ||
    s.includes('010010')
  ) {
    return PATTERN_INDEX.OPEN_TWO;
  }
  if (
    s.includes('000112') ||
    s.includes('211000') ||
    s.includes('001012') ||
    s.includes('210100') ||
    s.includes('010012') ||
    s.includes('210010') ||
    s.includes('10001')
  ) {
    return PATTERN_INDEX.CLOSED_TWO;
  }
  return PATTERN_INDEX.SINGLE;
};

/**
 * 3 進エンコードされた 9 セルライン → パターン種別インデックスの変換テーブル。
 * 19,683 エントリ。モジュールロード時に 1 回だけ生成される。
 *
 * PATTERN_TABLE[code] でパターン種別インデックス（0〜7）を直接取得できる。
 */
export const PATTERN_TABLE: Uint8Array = (() => {
  const table = new Uint8Array(LINE_CODE_SPACE);
  for (let code = 0; code < LINE_CODE_SPACE; code++) {
    let temp = code;
    let s = '';
    for (let i = 0; i < 9; i++) {
      s += String(temp % 3);
      temp = Math.floor(temp / 3);
    }
    table[code] = detectPatternForTable(s);
  }
  return table;
})();

// ============================================================
// 勝利判定マスク
// ============================================================

/**
 * 9 桁のセル値配列にちょうど 5 連（長連を除外）があるか判定する。
 * Black の勝利判定に使用する。
 */
const hasExactFiveInDigits = (digits: number[]): boolean => {
  for (let start = 0; start <= 4; start++) {
    if (
      digits[start] === 1 &&
      digits[start + 1] === 1 &&
      digits[start + 2] === 1 &&
      digits[start + 3] === 1 &&
      digits[start + 4] === 1
    ) {
      const beforeOk = start === 0 || digits[start - 1] !== 1;
      const afterOk = start + 5 >= 9 || digits[start + 5] !== 1;
      if (beforeOk && afterOk) {
        return true;
      }
    }
  }
  return false;
};

/**
 * 9 桁のセル値配列に 5 連以上があるか判定する。
 * White の勝利判定に使用する。
 */
const hasFiveOrMoreInDigits = (digits: number[]): boolean => {
  for (let start = 0; start <= 4; start++) {
    if (
      digits[start] === 1 &&
      digits[start + 1] === 1 &&
      digits[start + 2] === 1 &&
      digits[start + 3] === 1 &&
      digits[start + 4] === 1
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Black 用勝利判定マスク。
 * ちょうど 5 連があるラインコードを 1、それ以外を 0 とする。
 * 6 連以上（長連）は含まない。
 */
export const BLACK_WIN_MASK: Uint8Array = (() => {
  const mask = new Uint8Array(LINE_CODE_SPACE);
  for (let code = 0; code < LINE_CODE_SPACE; code++) {
    let temp = code;
    const digits: number[] = [];
    for (let i = 0; i < 9; i++) {
      digits.push(temp % 3);
      temp = Math.floor(temp / 3);
    }
    mask[code] = hasExactFiveInDigits(digits) ? 1 : 0;
  }
  return mask;
})();

/**
 * White 用勝利判定マスク。
 * 5 連以上があるラインコードを 1、それ以外を 0 とする。
 */
export const WHITE_WIN_MASK: Uint8Array = (() => {
  const mask = new Uint8Array(LINE_CODE_SPACE);
  for (let code = 0; code < LINE_CODE_SPACE; code++) {
    let temp = code;
    const digits: number[] = [];
    for (let i = 0; i < 9; i++) {
      digits.push(temp % 3);
      temp = Math.floor(temp / 3);
    }
    mask[code] = hasFiveOrMoreInDigits(digits) ? 1 : 0;
  }
  return mask;
})();

/**
 * LineCache を利用した高速勝利判定。
 *
 * applySearchMove 直後に LineCache が更新済みの状態で呼び出す。
 * 着手位置の 4 方向ラインコードを WIN_MASK テーブルで参照し、
 * いずれかの方向で勝利パターンが検出されれば true を返す。
 *
 * Black はちょうど 5 連（BLACK_WIN_MASK）、
 * White は 5 連以上（WHITE_WIN_MASK）で判定する。
 */
export const checkWinWithLineCache = (
  lineCache: LineCacheState,
  row: number,
  col: number,
  player: Player
): boolean => {
  const mask = player === 'Black' ? BLACK_WIN_MASK : WHITE_WIN_MASK;
  const caches = lineCache.caches[player];
  for (let d = 0; d < DIRECTIONS.length; d++) {
    const code = caches[d][row][col];
    if (mask[code] === 1) return true;
  }
  return false;
};

// 位置評価のホットパスで再利用するスクラッチバッファ。
// 評価関数は同期的・単一スレッドで呼び出され、戻り値はスカラ―のため、
// バッファを再利用しても評価結果に影響しない。
const scratchAttackCounts = createEmptyPatternCount();
const scratchOppBeforeCounts = createEmptyPatternCount();
const scratchOppAfterCounts = createEmptyPatternCount();

// ============================================================
// 位置評価
// ============================================================

/**
 * 中央近接ボーナス（tie-breaker）。
 *
 * POSITION_BONUS_EPSILON はスコア体系の最小刻み幅（AI_SCORES.SINGLE = 1）より
 * 2 桁小さいため、素点が異なる候補同士の順位を逆転させることはない。
 */
const POSITION_BONUS_EPSILON = 0.01;
const BOARD_CENTER = (BOARD_SIZE - 1) / 2;
const MAX_CENTER_DISTANCE = Math.sqrt(2) * BOARD_CENTER;

const computePositionBonus = (row: number, col: number): number => {
  const distance = Math.sqrt(
    (row - BOARD_CENTER) ** 2 + (col - BOARD_CENTER) ** 2
  );
  return (1 - distance / MAX_CENTER_DISTANCE) * POSITION_BONUS_EPSILON;
};

// ============================================================
// 形状ボーナス
// ============================================================

/**
 * board ベースの形状ボーナス。
 *
 * 4方向 × 距離1,2 の近接自石を数え、極小ボーナスを加算する。
 * 即時戦術スコアには影響しない。
 */
const computeShapeBonusFromBoard = (
  board: BoardState,
  row: number,
  col: number,
  playerColor: Player
): number => {
  if (!EVALUATION_FEATURES.ENABLE_SHAPE_BONUS) return 0;
  let bonus = 0;
  for (const [dx, dy] of DIRECTIONS) {
    for (const dist of [1, 2]) {
      const r1 = row + dx * dist;
      const c1 = col + dy * dist;
      if (
        r1 >= 0 &&
        r1 < BOARD_SIZE &&
        c1 >= 0 &&
        c1 < BOARD_SIZE &&
        board[r1][c1] === playerColor
      ) {
        bonus += EVAL_CONFIG.SHAPE_BONUS_PER_STONE;
      }
      const r2 = row - dx * dist;
      const c2 = col - dy * dist;
      if (
        r2 >= 0 &&
        r2 < BOARD_SIZE &&
        c2 >= 0 &&
        c2 < BOARD_SIZE &&
        board[r2][c2] === playerColor
      ) {
        bonus += EVAL_CONFIG.SHAPE_BONUS_PER_STONE;
      }
    }
  }
  return Math.min(bonus, EVAL_CONFIG.SHAPE_MAX_BONUS);
};

/**
 * LineCache ベースの形状ボーナス。
 *
 * ラインコードの index 2,3,5,6（中心から距離 1,2）に
 * 自石（値 1）があるかを数える。
 */
export const computeShapeBonusFromLines = (
  ownLineCaches: number[][][],
  r: number,
  c: number
): number => {
  if (!EVALUATION_FEATURES.ENABLE_SHAPE_BONUS) return 0;
  let bonus = 0;
  for (let d = 0; d < DIRECTIONS.length; d++) {
    const code = ownLineCaches[d][r][c];
    // index 2 = 距離-2, index 3 = 距離-1, index 5 = 距離+1, index 6 = 距離+2
    if (extractDigit(code, 2) === 1) bonus += EVAL_CONFIG.SHAPE_BONUS_PER_STONE;
    if (extractDigit(code, 3) === 1) bonus += EVAL_CONFIG.SHAPE_BONUS_PER_STONE;
    if (extractDigit(code, 5) === 1) bonus += EVAL_CONFIG.SHAPE_BONUS_PER_STONE;
    if (extractDigit(code, 6) === 1) bonus += EVAL_CONFIG.SHAPE_BONUS_PER_STONE;
  }
  return Math.min(bonus, EVAL_CONFIG.SHAPE_MAX_BONUS);
};

// ============================================================
// 位置評価本体
// ============================================================

/**
 * 指定位置への着手価値を playerColor の視点で返す（位置補正なしの素点）。
 *
 * 評価フロー:
 *   攻撃パターン → 相手 before パターン → 相手 after パターン →
 *   即時評価 → 通常スコア加算。
 *
 * 中央近接ボーナスは呼び出し元の evaluatePosition が加算する。
 */
const evaluatePositionRaw = (
  board: BoardState,
  row: number,
  col: number,
  playerColor: Player
): number => {
  const opponentColor = opponentOf(playerColor);

  scratchAttackCounts.fill(0);
  scratchOppBeforeCounts.fill(0);
  scratchOppAfterCounts.fill(0);

  for (const [dx, dy] of DIRECTIONS) {
    const attackCode = getLineCode(board, row, col, dx, dy, playerColor, 1);
    scratchAttackCounts[PATTERN_TABLE[attackCode]]++;

    const beforeCode = getLineCode(board, row, col, dx, dy, opponentColor, 1);
    scratchOppBeforeCounts[PATTERN_TABLE[beforeCode]]++;

    const afterCode = getLineCode(board, row, col, dx, dy, opponentColor, 2);
    scratchOppAfterCounts[PATTERN_TABLE[afterCode]]++;
  }

  // --- 即時評価 ---
  if (scratchAttackCounts[PATTERN_INDEX.WIN] > 0) return AI_SCORES.WIN;
  if (
    scratchOppBeforeCounts[PATTERN_INDEX.WIN] > 0 &&
    scratchOppAfterCounts[PATTERN_INDEX.WIN] === 0
  ) {
    return AI_SCORES.DEFEND_WIN;
  }
  if (scratchAttackCounts[PATTERN_INDEX.OPEN_FOUR] > 0) return AI_SCORES.OPEN_FOUR;
  if (scratchAttackCounts[PATTERN_INDEX.CLOSED_FOUR] >= 2) return AI_SCORES.DOUBLE_FOUR;
  if (
    scratchAttackCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
    scratchAttackCounts[PATTERN_INDEX.OPEN_THREE] >= 1
  ) {
    return AI_SCORES.FOUR_THREE;
  }
  if (
    scratchOppBeforeCounts[PATTERN_INDEX.OPEN_FOUR] > 0 &&
    scratchOppAfterCounts[PATTERN_INDEX.OPEN_FOUR] <
      scratchOppBeforeCounts[PATTERN_INDEX.OPEN_FOUR]
  ) {
    return AI_SCORES.OPEN_FOUR;
  }
  if (
    scratchOppBeforeCounts[PATTERN_INDEX.CLOSED_FOUR] >= 2 &&
    scratchOppAfterCounts[PATTERN_INDEX.CLOSED_FOUR] < 2
  ) {
    return AI_SCORES.DOUBLE_FOUR;
  }
  if (
    scratchOppBeforeCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
    scratchOppBeforeCounts[PATTERN_INDEX.OPEN_THREE] >= 1 &&
    !(
      scratchOppAfterCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
      scratchOppAfterCounts[PATTERN_INDEX.OPEN_THREE] >= 1
    )
  ) {
    return AI_SCORES.FOUR_THREE;
  }
  if (scratchAttackCounts[PATTERN_INDEX.OPEN_THREE] >= 2) return AI_SCORES.DOUBLE_THREE;
  if (
    scratchOppBeforeCounts[PATTERN_INDEX.OPEN_THREE] >= 2 &&
    scratchOppAfterCounts[PATTERN_INDEX.OPEN_THREE] < 2
  ) {
    return AI_SCORES.DOUBLE_THREE;
  }

  // --- 通常評価 ---
  let attackScore = 0;
  attackScore += scratchAttackCounts[PATTERN_INDEX.CLOSED_FOUR] * AI_SCORES.CLOSED_FOUR;
  attackScore += scratchAttackCounts[PATTERN_INDEX.OPEN_THREE] * AI_SCORES.OPEN_THREE;
  attackScore += scratchAttackCounts[PATTERN_INDEX.CLOSED_THREE] * AI_SCORES.CLOSED_THREE;
  attackScore += scratchAttackCounts[PATTERN_INDEX.OPEN_TWO] * AI_SCORES.OPEN_TWO;
  attackScore += scratchAttackCounts[PATTERN_INDEX.CLOSED_TWO] * AI_SCORES.CLOSED_TWO;
  attackScore += scratchAttackCounts[PATTERN_INDEX.SINGLE] * AI_SCORES.SINGLE;

  const defenseScore = Math.max(
    0,
    calcTotalOppScore(scratchOppBeforeCounts) -
      calcTotalOppScore(scratchOppAfterCounts)
  );

  const shapeBonus = computeShapeBonusFromBoard(board, row, col, playerColor);

  return attackScore * AI_CONFIG.ATTACK_WEIGHT + defenseScore + shapeBonus;
};

/**
 * 指定位置への着手価値を playerColor の視点で返す。
 *
 * 本体は evaluatePositionRaw に委譲し、
 * 同点候補の tie-breaker として中央近接ボーナスのみを加算する。
 */
export const evaluatePosition = (
  board: BoardState,
  row: number,
  col: number,
  playerColor: Player
): number =>
  evaluatePositionRaw(board, row, col, playerColor) +
  computePositionBonus(row, col);

// ============================================================
// LineCache 利用版
// ============================================================

/**
 * LineCache を利用して指定位置への着手価値を playerColor 視点で返す。
 *
 * 評価ロジック・スコア体系は evaluatePosition と完全に同一。
 * 違いは、ラインコードを LineCache から取得し、
 * 中心セルへの仮想着手を整数加算で表現する点のみ。
 *
 * LineCache の中心セル（index 4）は空マス（値 0）であるため、
 * 自石を置く場合は CENTER_WEIGHT を加算、
 * 相手石を置く場合は 2 * CENTER_WEIGHT を加算する。
 */
export const evaluatePositionWithCache = (
  lineCache: LineCacheState,
  row: number,
  col: number,
  playerColor: Player
): number => {
  const opponentColor = opponentOf(playerColor);
  const ownCaches = lineCache.caches[playerColor];
  const oppCaches = lineCache.caches[opponentColor];

  scratchAttackCounts.fill(0);
  scratchOppBeforeCounts.fill(0);
  scratchOppAfterCounts.fill(0);

  for (let d = 0; d < DIRECTIONS.length; d++) {
    // 自石を置いた場合: 中心セル 0 → 1
    const ownCode = ownCaches[d][row][col];
    scratchAttackCounts[PATTERN_TABLE[ownCode + CENTER_WEIGHT]]++;

    // 相手が置いた場合の before: 中心セル 0 → 1（相手視点の自石）
    const oppCode = oppCaches[d][row][col];
    scratchOppBeforeCounts[PATTERN_TABLE[oppCode + CENTER_WEIGHT]]++;

    // 相手が置いた場合の after: 中心セル 0 → 2（相手視点の相手石）
    scratchOppAfterCounts[PATTERN_TABLE[oppCode + 2 * CENTER_WEIGHT]]++;
  }

  // --- 即時評価（evaluatePosition と同一） ---
  if (scratchAttackCounts[PATTERN_INDEX.WIN] > 0) {
    return AI_SCORES.WIN + computePositionBonus(row, col);
  }
  if (
    scratchOppBeforeCounts[PATTERN_INDEX.WIN] > 0 &&
    scratchOppAfterCounts[PATTERN_INDEX.WIN] === 0
  ) {
    return AI_SCORES.DEFEND_WIN + computePositionBonus(row, col);
  }
  if (scratchAttackCounts[PATTERN_INDEX.OPEN_FOUR] > 0) {
    return AI_SCORES.OPEN_FOUR + computePositionBonus(row, col);
  }
  if (scratchAttackCounts[PATTERN_INDEX.CLOSED_FOUR] >= 2) {
    return AI_SCORES.DOUBLE_FOUR + computePositionBonus(row, col);
  }
  if (
    scratchAttackCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
    scratchAttackCounts[PATTERN_INDEX.OPEN_THREE] >= 1
  ) {
    return AI_SCORES.FOUR_THREE + computePositionBonus(row, col);
  }
  if (
    scratchOppBeforeCounts[PATTERN_INDEX.OPEN_FOUR] > 0 &&
    scratchOppAfterCounts[PATTERN_INDEX.OPEN_FOUR] <
      scratchOppBeforeCounts[PATTERN_INDEX.OPEN_FOUR]
  ) {
    return AI_SCORES.OPEN_FOUR + computePositionBonus(row, col);
  }
  if (
    scratchOppBeforeCounts[PATTERN_INDEX.CLOSED_FOUR] >= 2 &&
    scratchOppAfterCounts[PATTERN_INDEX.CLOSED_FOUR] < 2
  ) {
    return AI_SCORES.DOUBLE_FOUR + computePositionBonus(row, col);
  }
  if (
    scratchOppBeforeCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
    scratchOppBeforeCounts[PATTERN_INDEX.OPEN_THREE] >= 1 &&
    !(
      scratchOppAfterCounts[PATTERN_INDEX.CLOSED_FOUR] >= 1 &&
      scratchOppAfterCounts[PATTERN_INDEX.OPEN_THREE] >= 1
    )
  ) {
    return AI_SCORES.FOUR_THREE + computePositionBonus(row, col);
  }
  if (scratchAttackCounts[PATTERN_INDEX.OPEN_THREE] >= 2) {
    return AI_SCORES.DOUBLE_THREE + computePositionBonus(row, col);
  }
  if (
    scratchOppBeforeCounts[PATTERN_INDEX.OPEN_THREE] >= 2 &&
    scratchOppAfterCounts[PATTERN_INDEX.OPEN_THREE] < 2
  ) {
    return AI_SCORES.DOUBLE_THREE + computePositionBonus(row, col);
  }

  // --- 通常評価 ---
  let attackScore = 0;
  attackScore += scratchAttackCounts[PATTERN_INDEX.CLOSED_FOUR] * AI_SCORES.CLOSED_FOUR;
  attackScore += scratchAttackCounts[PATTERN_INDEX.OPEN_THREE] * AI_SCORES.OPEN_THREE;
  attackScore += scratchAttackCounts[PATTERN_INDEX.CLOSED_THREE] * AI_SCORES.CLOSED_THREE;
  attackScore += scratchAttackCounts[PATTERN_INDEX.OPEN_TWO] * AI_SCORES.OPEN_TWO;
  attackScore += scratchAttackCounts[PATTERN_INDEX.CLOSED_TWO] * AI_SCORES.CLOSED_TWO;
  attackScore += scratchAttackCounts[PATTERN_INDEX.SINGLE] * AI_SCORES.SINGLE;

  const defenseScore = Math.max(
    0,
    calcTotalOppScore(scratchOppBeforeCounts) -
      calcTotalOppScore(scratchOppAfterCounts)
  );

  const raw = attackScore * AI_CONFIG.ATTACK_WEIGHT + defenseScore;
  const shapeBonus = computeShapeBonusFromLines(ownCaches, row, col);

  return raw + computePositionBonus(row, col) + shapeBonus;
};