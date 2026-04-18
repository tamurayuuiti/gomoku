// src/utils/aiLogic.ts

import type { BoardState, Position } from '../types/game';

export const calculateNextMove = (board: BoardState): Position | null => {
  const availableMoves: Position[] = [];

  // 全ての空きマスをリストアップ
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      if (board[row][col] === null) {
        availableMoves.push({ row, col });
      }
    }
  }

  // 空きマスがない場合（通常は引き分け判定が先に入るため発生しにくい）
  if (availableMoves.length === 0) {
    return null;
  }

  // 現在は「ランダムに選択する」のみの簡素なロジック
  // TODO: 将来的にここでMinimax法や、モデルの推論結果を返すように拡張する
  const randomIndex = Math.floor(Math.random() * availableMoves.length);
  return availableMoves[randomIndex];
};