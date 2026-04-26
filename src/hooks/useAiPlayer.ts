// src/hooks/useAiPlayer.ts
// AIプレイヤーの思考と着手を管理するカスタムフック

import { useState, useEffect, useRef } from 'react';
import type { Player, BoardState, GameStatus, GameMode } from '../types/game';
import { calculateNextMove } from '../utils/ai/search';

interface UseAiPlayerProps {
  board: BoardState;
  currentPlayer: Player;
  gameStatus: GameStatus;
  gameMode: GameMode;
  playerColor: Player;
  forbiddenMoves: boolean[][];
  onMove: (row: number, col: number) => void;
}

export const useAiPlayer = ({
  board,
  currentPlayer,
  gameStatus,
  gameMode,
  playerColor,
  forbiddenMoves,
  onMove,
}: UseAiPlayerProps) => {
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const lastProcessedTurnRef = useRef<string>('');

  // --- AI実行ロジック ---
  useEffect(() => {
    let isMounted = true;

    const isAiTurn =
      gameMode === 'PvE' &&
      currentPlayer !== playerColor &&
      gameStatus === 'Playing';

    const turnId = board.map((r) => r.join(',')).join('|');

    // AIのターンでなければ何もしない
    if (!isAiTurn) return;

    // 同一ターンの二重実行防止
    if (lastProcessedTurnRef.current === turnId) return;

    lastProcessedTurnRef.current = turnId;
    setIsAiThinking(true);

    const timerId = setTimeout(() => {
      if (!isMounted) return;

      const nextMove = calculateNextMove(board, forbiddenMoves, currentPlayer);

      if (nextMove) {
        onMove(nextMove.row, nextMove.col);
      }

      setIsAiThinking(false);
    }, 600);

    return () => {
      isMounted = false;
      clearTimeout(timerId);
    };
  }, [
    board,
    currentPlayer,
    gameStatus,
    gameMode,
    playerColor,
    forbiddenMoves,
    onMove,
  ]);

  // --- 思考フラグの整合性維持 ---
  useEffect(() => {
    const isAiTurn =
      gameMode === 'PvE' &&
      currentPlayer !== playerColor &&
      gameStatus === 'Playing';

    if (!isAiTurn) {
      setIsAiThinking(false);
    }
  }, [gameMode, currentPlayer, playerColor, gameStatus]);

  return { isAiThinking };
};