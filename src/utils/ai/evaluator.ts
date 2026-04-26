// src/utils/ai/evaluator.ts
// AIが盤面を評価するロジックを定義するファイル

import type { BoardState, Player } from '../../types/game';
import type { PatternType, PatternCount } from './constants';
import { BOARD_SIZE } from '../gameLogic';
import { AI_SCORES, AI_CONFIG, DIRECTIONS } from './constants';

// 周辺に石があるか判定
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

// パターン検出
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

// 評価関数
export const evaluatePosition = (
  board: BoardState,
  row: number,
  col: number,
  playerColor: Player
): number => {
  const opponentColor: Player =
    playerColor === 'Black' ? 'White' : 'Black';

  // 1. 自分の攻撃評価
  const attackCounts: PatternCount = {
    WIN: 0, OPEN_FOUR: 0, CLOSED_FOUR: 0, OPEN_THREE: 0,
    CLOSED_THREE: 0, OPEN_TWO: 0, CLOSED_TWO: 0, SINGLE: 0,
  };

  // 2. 相手の脅威評価
  const oppBeforeCounts: PatternCount = {
    WIN: 0, OPEN_FOUR: 0, CLOSED_FOUR: 0, OPEN_THREE: 0,
    CLOSED_THREE: 0, OPEN_TWO: 0, CLOSED_TWO: 0, SINGLE: 0,
  };
  const oppAfterCounts: PatternCount = {
    WIN: 0, OPEN_FOUR: 0, CLOSED_FOUR: 0, OPEN_THREE: 0,
    CLOSED_THREE: 0, OPEN_TWO: 0, CLOSED_TWO: 0, SINGLE: 0,
  };

  for (const [dx, dy] of DIRECTIONS) {
    // 攻撃パターンの取得
    const attackPtn = detectPattern(getLineString(board, row, col, dx, dy, playerColor, '1'));
    attackCounts[attackPtn]++;

    // 相手のBeforeパターンの取得
    const beforePtn = detectPattern(getLineString(board, row, col, dx, dy, opponentColor, '1'));
    oppBeforeCounts[beforePtn]++;

    // 相手のAfterパターンの取得
    const afterPtn = detectPattern(getLineString(board, row, col, dx, dy, opponentColor, '2'));
    oppAfterCounts[afterPtn]++;
  }

  // --- 即時評価 ---
  if (attackCounts.WIN > 0) return AI_SCORES.WIN;

  // 相手の勝利を阻止できるか
  if (oppBeforeCounts.WIN > 0 && oppAfterCounts.WIN === 0)
    return AI_SCORES.DEFEND_WIN;

  // 自分の攻撃
  if (attackCounts.OPEN_FOUR > 0) return AI_SCORES.OPEN_FOUR;
  if (attackCounts.CLOSED_FOUR >= 2) return AI_SCORES.DOUBLE_FOUR;
  if (attackCounts.CLOSED_FOUR >= 1 && attackCounts.OPEN_THREE >= 1)
    return AI_SCORES.FOUR_THREE;

  // 相手の強力な攻めを阻止できたか
  if (
    oppBeforeCounts.OPEN_FOUR > 0 &&
    oppAfterCounts.OPEN_FOUR < oppBeforeCounts.OPEN_FOUR
  ) {
    return AI_SCORES.OPEN_FOUR;
  }

  const isOppBeforeDoubleFour = oppBeforeCounts.CLOSED_FOUR >= 2;
  const isOppAfterDoubleFour = oppAfterCounts.CLOSED_FOUR >= 2;
  if (isOppBeforeDoubleFour && !isOppAfterDoubleFour)
    return AI_SCORES.DOUBLE_FOUR;

  const isOppBeforeFourThree =
    oppBeforeCounts.CLOSED_FOUR >= 1 && oppBeforeCounts.OPEN_THREE >= 1;
  const isOppAfterFourThree =
    oppAfterCounts.CLOSED_FOUR >= 1 && oppAfterCounts.OPEN_THREE >= 1;
  if (isOppBeforeFourThree && !isOppAfterFourThree)
    return AI_SCORES.FOUR_THREE;

  if (attackCounts.OPEN_THREE >= 2) return AI_SCORES.DOUBLE_THREE;

  const isOppBeforeDoubleThree = oppBeforeCounts.OPEN_THREE >= 2;
  const isOppAfterDoubleThree = oppAfterCounts.OPEN_THREE >= 2;
  if (isOppBeforeDoubleThree && !isOppAfterDoubleThree)
    return AI_SCORES.DOUBLE_THREE;

  // --- 通常評価 ---
  let attackScore = 0;
  attackScore += attackCounts.CLOSED_FOUR * AI_SCORES.CLOSED_FOUR;
  attackScore += attackCounts.OPEN_THREE * AI_SCORES.OPEN_THREE;
  attackScore += attackCounts.CLOSED_THREE * AI_SCORES.CLOSED_THREE;
  attackScore += attackCounts.OPEN_TWO * AI_SCORES.OPEN_TWO;
  attackScore += attackCounts.CLOSED_TWO * AI_SCORES.CLOSED_TWO;
  attackScore += attackCounts.SINGLE * AI_SCORES.SINGLE;

  // 防御評価の差分計算
  const calculateTotalOppScore = (counts: PatternCount): number => {
    let score = 0;
    score += counts.CLOSED_FOUR * AI_SCORES.CLOSED_FOUR;
    score += counts.OPEN_THREE * AI_SCORES.OPEN_THREE;
    score += counts.CLOSED_THREE * AI_SCORES.CLOSED_THREE;
    score += counts.OPEN_TWO * AI_SCORES.OPEN_TWO;
    score += counts.CLOSED_TWO * AI_SCORES.CLOSED_TWO;
    return score;
  };

  const oppBeforeScore = calculateTotalOppScore(oppBeforeCounts);
  const oppAfterScore = calculateTotalOppScore(oppAfterCounts);
  
  // 防御スコア = 阻止したことによって減らした相手のスコア量
  const defenseScore = Math.max(0, oppBeforeScore - oppAfterScore);

  return attackScore * AI_CONFIG.ATTACK_WEIGHT + defenseScore;
};