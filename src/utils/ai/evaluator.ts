// src/utils/ai/evaluator.ts
// AIが盤面を評価するロジックを定義するファイル
//
// パターン検出（getLineString / detectPattern）、位置評価（evaluatePosition）、
// 共有ユーティリティ（opponentOf / hasStoneNearby）を担う。
// 全盤評価（evaluateBoard）は boardEvaluator.ts に移管済み。

import type { BoardState, Player } from '../../types/game';
import type { PatternType, PatternCount } from '../../types/ai';
import { BOARD_SIZE } from '../gameLogic';
import { AI_SCORES, AI_CONFIG, DIRECTIONS } from './constants';


// ============================================================
// 共有ユーティリティ
// ============================================================

export const opponentOf = (player: Player): Player =>
  player === 'Black' ? 'White' : 'Black';

/** 指定セルの周辺（SEARCH_RANGE 以内）に石があるか判定（候補手の絞り込みに使用） */
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
// パターン検出
// ============================================================

/**
 * 指定位置を中心とした 1 方向 9 セルの文字列を返す（'1'=color の石, '0'=空マス, '2'=盤外/相手石）。
 * centerChar を '2' にすると「ここに相手石が置かれた場合」の after-state パターンとして使える。
 */
export const getLineString = (
  board: BoardState,
  row: number,
  col: number,
  dx: number,
  dy: number,
  color: Player,
  centerChar: string = '1'
): string => {
  let s = '';
  for (let i = -4; i <= 4; i++) {
    if (i === 0) {
      s += centerChar;
      continue;
    }
    const r = row + i * dx;
    const c = col + i * dy;

    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
      s += '2';
    } else if (board[r][c] === color) {
      s += '1';
    } else if (board[r][c] === null) {
      s += '0';
    } else {
      s += '2';
    }
  }
  return s;
};

/** 9 文字のライン文字列からパターン種別を判定する */
export const detectPattern = (s: string): PatternType => {
  if (s.includes('11111')) return 'WIN';

  if (s.includes('011110')) return 'OPEN_FOUR';

  if (
    s.includes('011112') || s.includes('211110') ||
    s.includes('10111') || s.includes('11011') || s.includes('11101')
  ) return 'CLOSED_FOUR';

  if (
    s.includes('011100') || s.includes('001110') ||
    s.includes('010110') || s.includes('011010')
  ) return 'OPEN_THREE';

  if (
    s.includes('001112') || s.includes('211100') ||
    s.includes('010112') || s.includes('211010') ||
    s.includes('011012') || s.includes('210110') ||
    s.includes('10011') || s.includes('11001') || s.includes('10101')
  ) return 'CLOSED_THREE';

  if (
    s.includes('001100') || s.includes('011000') || s.includes('000110') ||
    s.includes('010100') || s.includes('001010') || s.includes('010010')
  ) return 'OPEN_TWO';

  if (
    s.includes('000112') || s.includes('211000') ||
    s.includes('001012') || s.includes('210100') ||
    s.includes('010012') || s.includes('210010') ||
    s.includes('10001')
  ) return 'CLOSED_TWO';

  return 'SINGLE';
};


// ============================================================
// 位置評価
// ============================================================

/**
 * 中央近接ボーナス（tie-breaker）。
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

/**
 * 指定位置への着手価値を playerColor の視点で返す（位置補正なしの素点）。
 * 評価フロー: 攻撃パターン → 相手 before パターン → 相手 after パターン →
 * 即時評価 → 通常スコア加算。中央近接ボーナスは呼び出し元の evaluatePosition が加算する。
 */
const evaluatePositionRaw = (
  board: BoardState,
  row: number,
  col: number,
  playerColor: Player
): number => {
  const opponentColor = opponentOf(playerColor);

  const attackCounts: PatternCount = {
    WIN: 0, OPEN_FOUR: 0, CLOSED_FOUR: 0, OPEN_THREE: 0,
    CLOSED_THREE: 0, OPEN_TWO: 0, CLOSED_TWO: 0, SINGLE: 0,
  };
  const oppBeforeCounts: PatternCount = {
    WIN: 0, OPEN_FOUR: 0, CLOSED_FOUR: 0, OPEN_THREE: 0,
    CLOSED_THREE: 0, OPEN_TWO: 0, CLOSED_TWO: 0, SINGLE: 0,
  };
  const oppAfterCounts: PatternCount = {
    WIN: 0, OPEN_FOUR: 0, CLOSED_FOUR: 0, OPEN_THREE: 0,
    CLOSED_THREE: 0, OPEN_TWO: 0, CLOSED_TWO: 0, SINGLE: 0,
  };

  for (const [dx, dy] of DIRECTIONS) {
    const attackPtn = detectPattern(getLineString(board, row, col, dx, dy, playerColor, '1'));
    attackCounts[attackPtn]++;

    const beforePtn = detectPattern(getLineString(board, row, col, dx, dy, opponentColor, '1'));
    oppBeforeCounts[beforePtn]++;

    const afterPtn = detectPattern(getLineString(board, row, col, dx, dy, opponentColor, '2'));
    oppAfterCounts[afterPtn]++;
  }

  // --- 即時評価 ---
  if (attackCounts.WIN > 0) return AI_SCORES.WIN;

  if (oppBeforeCounts.WIN > 0 && oppAfterCounts.WIN === 0)
    return AI_SCORES.DEFEND_WIN;

  if (attackCounts.OPEN_FOUR > 0) return AI_SCORES.OPEN_FOUR;
  if (attackCounts.CLOSED_FOUR >= 2) return AI_SCORES.DOUBLE_FOUR;
  if (attackCounts.CLOSED_FOUR >= 1 && attackCounts.OPEN_THREE >= 1)
    return AI_SCORES.FOUR_THREE;

  if (
    oppBeforeCounts.OPEN_FOUR > 0 &&
    oppAfterCounts.OPEN_FOUR < oppBeforeCounts.OPEN_FOUR
  ) return AI_SCORES.OPEN_FOUR;

  if (oppBeforeCounts.CLOSED_FOUR >= 2 && oppAfterCounts.CLOSED_FOUR < 2)
    return AI_SCORES.DOUBLE_FOUR;

  if (
    oppBeforeCounts.CLOSED_FOUR >= 1 && oppBeforeCounts.OPEN_THREE >= 1 &&
    !(oppAfterCounts.CLOSED_FOUR >= 1 && oppAfterCounts.OPEN_THREE >= 1)
  ) return AI_SCORES.FOUR_THREE;

  if (attackCounts.OPEN_THREE >= 2) return AI_SCORES.DOUBLE_THREE;

  if (oppBeforeCounts.OPEN_THREE >= 2 && oppAfterCounts.OPEN_THREE < 2)
    return AI_SCORES.DOUBLE_THREE;

  // --- 通常評価 ---
  let attackScore = 0;
  attackScore += attackCounts.CLOSED_FOUR * AI_SCORES.CLOSED_FOUR;
  attackScore += attackCounts.OPEN_THREE * AI_SCORES.OPEN_THREE;
  attackScore += attackCounts.CLOSED_THREE * AI_SCORES.CLOSED_THREE;
  attackScore += attackCounts.OPEN_TWO * AI_SCORES.OPEN_TWO;
  attackScore += attackCounts.CLOSED_TWO * AI_SCORES.CLOSED_TWO;
  attackScore += attackCounts.SINGLE * AI_SCORES.SINGLE;

  const calcTotalOppScore = (counts: PatternCount): number => {
    let score = 0;
    score += counts.CLOSED_FOUR * AI_SCORES.CLOSED_FOUR;
    score += counts.OPEN_THREE * AI_SCORES.OPEN_THREE;
    score += counts.CLOSED_THREE * AI_SCORES.CLOSED_THREE;
    score += counts.OPEN_TWO * AI_SCORES.OPEN_TWO;
    score += counts.CLOSED_TWO * AI_SCORES.CLOSED_TWO;
    return score;
  };

  const defenseScore = Math.max(
    0,
    calcTotalOppScore(oppBeforeCounts) - calcTotalOppScore(oppAfterCounts)
  );

  return attackScore * AI_CONFIG.ATTACK_WEIGHT + defenseScore;
};

/**
 * 指定位置への着手価値を playerColor の視点で返す。
 * 本体は evaluatePositionRaw に委譲し、同点候補の tie-breaker として
 * 中央近接ボーナス（computePositionBonus）のみを加算する。
 */
export const evaluatePosition = (
  board: BoardState,
  row: number,
  col: number,
  playerColor: Player
): number =>
  evaluatePositionRaw(board, row, col, playerColor) + computePositionBonus(row, col);