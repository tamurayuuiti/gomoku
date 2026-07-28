// src/hooks/useForbiddenMoves.ts
// 禁じ手の事前計算を行うカスタムフック
//
// 第9弾: 表示専用（ホバー UI）へ役割を変更。
// - 禁手全走査をレンダーフェーズから描画後（useEffect + state）へ退避した。
//   盤面に対して最大1フレーム遅れるが、表示専用であるため許容する。
// - 着手受理の権威ある判定は App.handleCellClick 内の checkForbiddenMove
//   直接呼び出し（単一マス）が担う。このマトリクスをルール判定のゲート
//   として参照してはならない。

import { useEffect, useState } from 'react';
import type { Player, BoardState, GameStatus } from '../types/game';
import { BOARD_SIZE, computeForbiddenMatrix } from '../utils/gameLogic';

/** 全面 false のマトリクスを生成する（軽量パス / 初期値） */
const createAllFalseMatrix = (): boolean[][] =>
  Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));

/** 2つのマトリクスの内容一致を比較する（µs オーダー。無駄な再レンダーを抑制する） */
const isSameMatrix = (a: boolean[][], b: boolean[][]): boolean => {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
};

export const useForbiddenMoves = (
  board: BoardState,
  currentPlayer: Player,
  gameStatus: GameStatus,
  useForbiddenRule: boolean
): boolean[][] => {
  const [matrix, setMatrix] = useState<boolean[][]>(createAllFalseMatrix);

  // 第9弾: 描画後に非同期で計算する。
  // 内容が変化していなければ前回の参照を返して再レンダーを抑制する。
  useEffect(() => {
    const next = computeForbiddenMatrix(board, currentPlayer, gameStatus, useForbiddenRule);
    setMatrix(prev => (isSameMatrix(prev, next) ? prev : next));
  }, [board, currentPlayer, gameStatus, useForbiddenRule]);

  return matrix;
};