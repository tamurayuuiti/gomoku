// src/hooks/useGameLogic.ts
// ゲームのコア進行ロジック（盤面、手番、勝敗判定）を管理するカスタムHook

import { useState, useCallback } from 'react';
import type { Player, BoardState, GameStatus, Position } from '../types/game';
import { checkWin, checkDraw, createEmptyBoard } from '../utils/gameLogic';

export const useGameLogic = () => {
  const [board, setBoard] = useState<BoardState>(createEmptyBoard());
  const [currentPlayer, setCurrentPlayer] = useState<Player>('Black');
  const [gameStatus, setGameStatus] = useState<GameStatus>('Playing');
  const [lastMove, setLastMove] = useState<Position | null>(null);

  const executeMove = useCallback((row: number, col: number) => {
    const newBoard = board.map((r, rIdx) =>
      rIdx === row ? r.map((c, cIdx) => (cIdx === col ? currentPlayer : c)) : r
    );

    setBoard(newBoard);
    setLastMove({ row, col });

    const move: Position = { row, col };
    if (checkWin(newBoard, move, currentPlayer)) {
      setGameStatus(currentPlayer === 'Black' ? 'BlackWins' : 'WhiteWins');
      return;
    }

    if (checkDraw(newBoard)) {
      setGameStatus('Draw');
      return;
    }

    setCurrentPlayer(prev => (prev === 'Black' ? 'White' : 'Black'));
  }, [board, currentPlayer]);

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