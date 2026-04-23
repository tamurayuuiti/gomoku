// src/hooks/useForbiddenMoves.ts
// 禁じ手の事前計算を行うカスタムフック

import { useMemo } from 'react';
import type { Player, BoardState, GameStatus } from '../types/game';
import { BOARD_SIZE, checkForbiddenMove } from '../utils/gameLogic';

// 禁じ手の事前計算
export const useForbiddenMoves = (
  board: BoardState,
  currentPlayer: Player,
  gameStatus: GameStatus,
  useForbiddenRule: boolean
): boolean[][] => {
  const forbiddenMoves = useMemo(() => {
    const matrix = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));

    // ルールがOFF、または現在の手番が白（禁じ手なし）の場合は計算不要
    if (gameStatus !== 'Playing' || !useForbiddenRule || currentPlayer !== 'Black') {
      return matrix;
    }

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === null) {
          const result = checkForbiddenMove(board, { row: r, col: c }, 'Black');
          if (result.isForbidden) {
            matrix[r][c] = true;
          }
        }
      }
    }
    return matrix;
  }, [board, currentPlayer, gameStatus, useForbiddenRule]);

  return forbiddenMoves;
};