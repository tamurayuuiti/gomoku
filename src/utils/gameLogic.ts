// src/utils/gameLogic.ts
// ゲームのロジックを担当する純粋関数を定義するファイル

import type { BoardState, Player, Position } from '../types/game';

// 盤面のサイズ（一般的な五目並べは15x15）
export const BOARD_SIZE = 15;

// 空の盤面を生成する純粋関数
export const createEmptyBoard = (): BoardState => {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
};

// 指定された方向に対して連続している石の数を数える純粋関数
const countStonesInDirection = (
  board: BoardState,
  pos: Position,
  player: Player,
  dRow: number,
  dCol: number
): number => {
  let count = 0;
  let r = pos.row + dRow;
  let c = pos.col + dCol;

  // 盤面の範囲内であり、かつ指定されたプレイヤーの石である限りカウントを続ける
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
    count++;
    r += dRow;
    c += dCol;
  }

  return count;
};

// 勝利判定を行う純粋関数（打たれた石の周囲のみをスキャンしパフォーマンスを最適化）
export const checkWin = (board: BoardState, lastMove: Position, player: Player): boolean => {
  // 検索する4つの方向（水平、垂直、右下がり対角線、右上がり対角線）
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  for (const [dRow, dCol] of directions) {
    // 正の方向と負の方向の両方をカウントし、起点となる打たれた石(1)を加算
    const count =
      1 +
      countStonesInDirection(board, lastMove, player, dRow, dCol) +
      countStonesInDirection(board, lastMove, player, -dRow, -dCol);

    // 5つ以上連続して並んでいれば勝利
    if (count >= 5) {
      return true;
    }
  }

  return false;
};

// 引き分け判定（盤面がすべて埋まっているか）
export const checkDraw = (board: BoardState): boolean => {
  return board.every(row => row.every(cell => cell !== null));
};