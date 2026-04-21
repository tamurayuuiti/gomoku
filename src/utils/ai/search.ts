// src/utils/ai/search.ts

import type { BoardState, Position, Player } from '../../types/game';
import { BOARD_SIZE } from '../gameLogic';
import { AI_CONFIG } from './constants';
import { evaluatePosition } from './evaluator';

/**
 * 指定した座標の周辺に石があるかどうかを判定（探索範囲の限定）
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
 * AIの次の一手を計算する（エントリーポイント）
 */
export const calculateNextMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  currentTurn: Player
): Position | null => {
  const candidates: Position[] = [];
  const isBoardEmpty = board.flat().every((cell) => cell === null);

  // 初手は中央
  if (isBoardEmpty) {
    const center = Math.floor(BOARD_SIZE / 2);
    return { row: center, col: center };
  }

  // 1. 候補手の抽出（石の周辺 かつ 空きマス かつ 禁じ手でない）
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

  // フォールバック（周辺に石がない場合：全空きマスを対象）
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

  // 2. 評価（現在は1手読み。将来的にここでMinimaxを呼び出すことが可能）
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

  // スコアが同じ場合はランダムに選択
  const randomIndex = Math.floor(Math.random() * bestCandidates.length);
  return bestCandidates[randomIndex];
};