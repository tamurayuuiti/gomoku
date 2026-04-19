// src/utils/aiLogic.ts

import type { BoardState, Position } from '../types/game';
import { BOARD_SIZE } from './gameLogic';

/**
 * AIが探索する際の「石からの距離」
 * 1だと隣接のみ、2だと一マス飛ばしまでを候補に含めます
 */
const SEARCH_RANGE = 2;

/**
 * 指定した座標の周辺に石があるかどうかを判定する
 */
const hasStoneNearby = (board: BoardState, row: number, col: number): boolean => {
  for (let r = Math.max(0, row - SEARCH_RANGE); r <= Math.min(BOARD_SIZE - 1, row + SEARCH_RANGE); r++) {
    for (let c = Math.max(0, col - SEARCH_RANGE); c <= Math.min(BOARD_SIZE - 1, col + SEARCH_RANGE); c++) {
      if (board[r][c] !== null) return true;
    }
  }
  return false;
};

/**
 * 次の一手を計算する
 * @param board 現在の盤面
 * @param forbiddenMoves 禁じ手情報の二次元配列（trueが禁じ手）
 */
export const calculateNextMove = (
  board: BoardState,
  forbiddenMoves: boolean[][]
): Position | null => {
  const candidates: Position[] = [];
  const isBoardEmpty = board.flat().every((cell) => cell === null);

  // 1. 盤面が空なら中央付近を返す
  if (isBoardEmpty) {
    const center = Math.floor(BOARD_SIZE / 2);
    return { row: center, col: center };
  }

  // 2. 候補手の抽出（石の周辺 かつ 空きマス かつ 禁じ手でない）
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (
        board[r][c] === null &&          // 空きマスである
        !forbiddenMoves[r][c] &&         // 禁じ手ではない
        hasStoneNearby(board, r, c)      // 周辺に石がある
      ) {
        candidates.push({ row: r, col: c });
      }
    }
  }

  // もし石の周辺に有効な手がない場合のフォールバック（理論上ほぼありえないが安全のため）
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

  // 3. 将来的な拡張のための評価フェーズ（現在はランダム）
  return selectBestMove(candidates);
};

/**
 * 候補手の中から最適な手を選択する
 * 将来的にMinimax法や評価関数を導入する場合はここを拡張する
 */
const selectBestMove = (candidates: Position[]): Position => {
  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex];
};