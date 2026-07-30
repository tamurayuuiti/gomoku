// src/hooks/useForbiddenMoves.ts
// 禁じ手の事前計算を行うカスタムフック。
//
// 責務:
//   - 表示専用（ホバー UI）の禁手マトリクスを描画後に計算する。
//   - 内容が変化していなければ前回の参照を返して再レンダーを抑制する。
//
// 注意:
//   - 着手受理の権威ある判定は App.handleCellClick 内の checkForbiddenMove が担う。
//   - このマトリクスをルール判定のゲートとして参照してはならない。
//
// lint 対応:
//   - 本フックの effect 内 setState は「表示専用の重い全走査を描画後へ退避する」
//     設計意図に基づくため、局所的に抑止する。
//   - 将来の責務分離では、派生値（useMemo / useDeferredValue 等）への再設計を検討する。

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

  // 描画後に非同期で計算する。
  // 内容が変化していなければ前回の参照を返して再レンダーを抑制する。
  useEffect(() => {
    const next = computeForbiddenMatrix(
      board,
      currentPlayer,
      gameStatus,
      useForbiddenRule
    );

    // 設計意図: 表示専用ホバー行列のため、重い全走査をレンダーフェーズから退避する。
    // 権威ある着手判定は App.handleCellClick 内 checkForbiddenMove が担う。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMatrix(prev => (isSameMatrix(prev, next) ? prev : next));
  }, [board, currentPlayer, gameStatus, useForbiddenRule]);

  return matrix;
};