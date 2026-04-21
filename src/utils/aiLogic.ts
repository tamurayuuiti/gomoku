// src/utils/aiLogic.ts

import type { BoardState, Position, Player } from '../types/game';
import { BOARD_SIZE } from './gameLogic';
import { AI_SCORES, AI_CONFIG } from '../constants/aiSettings';

/**
 * 指定した座標の周辺に石があるかどうかを判定する
 */
const hasStoneNearby = (board: BoardState, row: number, col: number): boolean => {
  const range = AI_CONFIG.SEARCH_RANGE;
  for (let r = Math.max(0, row - range); r <= Math.min(BOARD_SIZE - 1, row + range); r++) {
    for (let c = Math.max(0, col - range); c <= Math.min(BOARD_SIZE - 1, col + range); c++) {
      if (board[r][c] !== null) return true;
    }
  }
  return false;
};

/**
 * [抽出処理] 指定方向の連続数とブロック数をスキャンする
 */
const scanLine = (
  board: BoardState,
  row: number,
  col: number,
  dx: number,
  dy: number,
  color: Player
): { consecutive: number; block: number } => {
  let consecutive = 1;
  let block = 0;

  // 正方向のスキャン
  let r = row + dx;
  let c = col + dy;
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
    if (board[r][c] === color) {
      consecutive++;
    } else if (board[r][c] === null) {
      break;
    } else {
      block++; // 敵石によるブロック
      break;
    }
    r += dx;
    c += dy;
  }
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) block++;

  // 負方向のスキャン
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

/**
 * [評価処理] スキャン結果に基づいてスコアを割り当てる
 */
const getPatternScore = (consecutive: number, block: number): number => {
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

/**
 * 指定された座標の「盤面全体の価値」を評価する
 */
export const evaluatePosition = (
  board: BoardState,
  row: number,
  col: number,
  playerColor: Player
): number => {
  const opponentColor: Player = playerColor === 'Black' ? 'White' : 'Black';
  let totalScore = 0;

  const directions = [
    [1, 0], [0, 1], [1, 1], [1, -1]
  ];

  for (const [dx, dy] of directions) {
    // 自分の攻撃スコア
    const attackStats = scanLine(board, row, col, dx, dy, playerColor);
    const attackScore = getPatternScore(attackStats.consecutive, attackStats.block);

    // 相手の防御スコア
    const defenseStats = scanLine(board, row, col, dx, dy, opponentColor);
    const defenseScore = getPatternScore(defenseStats.consecutive, defenseStats.block);

    // 重み付けして加算
    totalScore += (attackScore * AI_CONFIG.ATTACK_WEIGHT) + defenseScore;
  }

  return totalScore;
};

/**
 * 次の一手を計算する（エントリーポイント）
 * 後方互換性を維持：App.tsx からの呼び出しを変更せずに動作
 */
export const calculateNextMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  currentTurn: Player
): Position | null => {
  const candidates: Position[] = [];
  const isBoardEmpty = board.flat().every((cell) => cell === null);

  if (isBoardEmpty) {
    const center = Math.floor(BOARD_SIZE / 2);
    return { row: center, col: center };
  }

  // 1. 候補手の抽出
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (
        board[r][c] === null &&
        !forbiddenMoves[r][c] &&
        hasStoneNearby(board, r, c)
      ) {
        candidates.push({ row: r, col: c });
      }
    }
  }

  // フォールバック
  if (candidates.length === 0) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === null && !forbiddenMoves[r][c]) {
          candidates.push({ row: r, col: c });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // 2. スコアリングに基づき最善手を選択
  let maxScore = -Infinity;
  let bestCandidates: Position[] = [];

  for (const pos of candidates) {
    const score = evaluatePosition(board, pos.row, pos.col, currentTurn);
    
    if (score > maxScore) {
      maxScore = score;
      bestCandidates = [pos];
    } else if (score === maxScore) {
      bestCandidates.push(pos);
    }
  }

  const randomIndex = Math.floor(Math.random() * bestCandidates.length);
  return bestCandidates[randomIndex];
};