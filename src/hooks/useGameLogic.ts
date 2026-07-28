// src/hooks/useGameLogic.ts
// ゲームのコア進行ロジック（盤面、手番、勝敗判定）を管理するカスタムHook
//
// 第9弾: executeMove を latest-ref パターンで安定化した。
// - 依存配列 [] の安定した identity を持ち、呼び出し側のコールバック
//   メモ化（App.handleCellClick → Cell の React.memo）を阻害しない。
// - ref を着手時に即時更新するため、同一タスク内での二重呼び出しでも
//   盤面・手番の整合が保たれる（stale 更新余地の解消）。
// - 埋まったマスへの着手を無視する防御ガードを追加した。
// state の分割・勝敗・引き分けの判定ロジックは変更していない。
//
// lint 対応: latest-ref のレンダー中更新をやめ、コミット後に更新する。

import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import type { Player, BoardState, GameStatus, Position } from '../types/game';
import { checkWin, checkDraw, createEmptyBoard } from '../utils/gameLogic';

export const useGameLogic = () => {
  const [board, setBoard] = useState<BoardState>(createEmptyBoard());
  const [currentPlayer, setCurrentPlayer] = useState<Player>('Black');
  const [gameStatus, setGameStatus] = useState<GameStatus>('Playing');
  const [lastMove, setLastMove] = useState<Position | null>(null);

  // latest-ref: イベントコールバック内でのみ読み出す。
  // レンダー中ではなくコミット後に更新する。
  const stateRef = useRef({ board, currentPlayer });

  useLayoutEffect(() => {
    stateRef.current = { board, currentPlayer };
  }, [board, currentPlayer]);

  const executeMove = useCallback((row: number, col: number) => {
    const { board: currentBoard, currentPlayer: player } = stateRef.current;

    // 防御ガード: 埋まったマスへの着手（同一タスク内の二重適用など）を無視する。
    if (currentBoard[row][col] !== null) return;

    const newBoard = currentBoard.map((r, rIdx) =>
      rIdx === row ? r.map((c, cIdx) => (cIdx === col ? player : c)) : r
    );

    const move: Position = { row, col };

    let nextStatus: GameStatus | null = null;

    if (checkWin(newBoard, move, player)) {
      nextStatus = player === 'Black' ? 'BlackWins' : 'WhiteWins';
    } else if (checkDraw(newBoard)) {
      nextStatus = 'Draw';
    }

    const nextPlayer: Player = player === 'Black' ? 'White' : 'Black';

    // ref の即時更新: 再レンダー前に再度呼び出されても整合状態を保つ。
    stateRef.current = { board: newBoard, currentPlayer: nextPlayer };

    setBoard(newBoard);
    setLastMove(move);

    if (nextStatus) {
      setGameStatus(nextStatus);
    } else {
      setCurrentPlayer(nextPlayer);
    }
  }, []);

  const resetGameLogic = useCallback(() => {
    setBoard(createEmptyBoard());
    setCurrentPlayer('Black');
    setGameStatus('Playing');
    setLastMove(null);
  }, []);

  return {
    board,
    currentPlayer,
    gameStatus,
    lastMove,
    executeMove,
    resetGameLogic,
  };
};