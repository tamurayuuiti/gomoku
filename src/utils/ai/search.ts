// src/utils/ai/search.ts
// AIの次の一手を計算するロジックを定義するファイル
// 責務：初手判定・findBestMove の呼び出し・結果の返却
// 探索ロジックは minimax.ts に完全委譲している

import type { BoardState, Position, Player } from '../../types/game';
import { BOARD_SIZE } from '../gameLogic';
import { AI_CONFIG } from './constants';
import { findBestMove } from './minimax';

// AIの次の一手を計算する関数
export const calculateNextMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  currentTurn: Player
): Position | null => {
  const isBoardEmpty = board.flat().every((cell) => cell === null);

  // 初手は中央
  if (isBoardEmpty) {
    const center = Math.floor(BOARD_SIZE / 2);
    return { row: center, col: center };
  }

  // ミニマックス探索で最善手を決定
  const depth = AI_CONFIG.MINIMAX_DEPTH;
  const best = findBestMove(board, forbiddenMoves, currentTurn, depth);

  if (best) {
    console.log(
      `AI selected: (${best.row}, ${best.col}) via minimax depth=${depth} (turn: ${currentTurn})`
    );
  }

  return best;
};