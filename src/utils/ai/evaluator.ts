// src/utils/ai/evaluator.ts
// AIが盤面を評価するロジックを定義するファイル

import type { BoardState, Player } from '../../types/game';
import { BOARD_SIZE } from '../gameLogic';
import { AI_SCORES, AI_CONFIG, DIRECTIONS } from './constants';

// 指定座標から特定の方向に連続する石の数とブロック数をカウントする関数
export const scanLine = (
  board: BoardState,
  row: number,
  col: number,
  dx: number,
  dy: number,
  color: Player
): { consecutive: number; block: number } => {
  let consecutive = 1;
  let block = 0;

  // 正方向（dx, dy）のスキャン
  let r = row + dx;
  let c = col + dy;
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
    if (board[r][c] === color) {
      consecutive++;
    } else if (board[r][c] === null) {
      break;
    } else {
      block++;
      break;
    }
    r += dx;
    c += dy;
  }
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) block++;

  // 負方向（-dx, -dy）のスキャン
  r = row - dx;
  c = col - dy;
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
    if (board[r][c] === color) {
      consecutive++;
    } else if (board[r][c] === null) {
      break;
    } else {
      block++;
      break;
    }
    r -= dx;
    c -= dy;
  }
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) block++;

  return { consecutive, block };
};

// パターンに応じたスコアを返す関数
export const getPatternScore = (consecutive: number, block: number): number => {
  if (consecutive >= 5) return AI_SCORES.FIVE;

  switch (consecutive) {
    case 4:
      return block === 0 ? AI_SCORES.OPEN_FOUR : (block === 1 ? AI_SCORES.CLOSED_FOUR : AI_SCORES.NONE);
    case 3:
      return block === 0 ? AI_SCORES.OPEN_THREE : (block === 1 ? AI_SCORES.CLOSED_THREE : AI_SCORES.NONE);
    case 2:
      return block === 0 ? AI_SCORES.OPEN_TWO : (block === 1 ? AI_SCORES.CLOSED_TWO : AI_SCORES.NONE);
    case 1:
      return block === 0 ? AI_SCORES.SINGLE : AI_SCORES.NONE;
    default:
      return AI_SCORES.NONE;
  }
};

// AIが指定座標に石を置いた場合の総合評価値を算出する関数
export const evaluatePosition = (
  board: BoardState,
  row: number,
  col: number,
  playerColor: Player
): number => {
  const opponentColor: Player = playerColor === 'Black' ? 'White' : 'Black';
  let totalScore = 0;

  for (const [dx, dy] of DIRECTIONS) {
    // 自身の攻撃スコア
    const attackStats = scanLine(board, row, col, dx, dy, playerColor);
    const attackScore = getPatternScore(attackStats.consecutive, attackStats.block);

    // 相手の妨害（防御）スコア
    const defenseStats = scanLine(board, row, col, dx, dy, opponentColor);
    const defenseScore = getPatternScore(defenseStats.consecutive, defenseStats.block);

    totalScore += (attackScore * AI_CONFIG.ATTACK_WEIGHT) + defenseScore;
  }

  return totalScore;
};