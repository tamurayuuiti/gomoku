// src/hooks/useGameLogic.ts
// ゲームのコア進行ロジックを管理するカスタムフック。
//
// 責務:
//   - 盤面・手番・勝敗・直前手の管理
//   - executeMove の安定した identity 提供
//
// 注意:
//   - state の分割・勝敗・引き分け判定ロジックは変更しない。
//   - latest-ref はコミット後に更新し、イベントコールバック内でのみ読み出す。

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