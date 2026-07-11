// src/hooks/useAiPlayer.ts
// AIプレイヤーの思考と着手を管理するカスタムフック
//
// AI探索（calculateNextMove 以降）は UIスレッドをブロックしないよう
// aiWorker（src/workers/aiWorker.ts）内で実行する。このフックは Worker の
// 生成・postMessage・onmessage・onerror・アンマウント時の terminate() のみを担い、
// 探索ロジック自体には関与しない。

import { useState, useEffect, useRef } from 'react';
import type { Player, BoardState, GameStatus, GameMode } from '../types/game';
import type { AiWorkerRequest, AiWorkerResponse } from '../workers/aiWorker.types';

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
  const workerRef = useRef<Worker | null>(null);

  // --- Worker生成・破棄 ---
  useEffect(() => {
    const worker = new Worker(new URL('../workers/aiWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // --- AI実行ロジック ---
  useEffect(() => {
    let isMounted = true;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    const isAiTurn =
      gameMode === 'PvE' &&
      currentPlayer !== playerColor &&
      gameStatus === 'Playing';

    const turnId = board.map((r) => r.join(',')).join('|');

    if (!isAiTurn) return;

    // 同一ターンの二重実行防止
    if (lastProcessedTurnRef.current === turnId) return;

    const worker = workerRef.current;
    if (!worker) return;

    lastProcessedTurnRef.current = turnId;
    setIsAiThinking(true);

    const thinkStartTime = performance.now();

    const handleMessage = (event: MessageEvent<AiWorkerResponse>) => {
      const { nextMove, error } = event.data;

      if (error) {
        console.error('[useAiPlayer] AI worker error:', error);
        if (isMounted) setIsAiThinking(false);
        return;
      }

      const elapsed = performance.now() - thinkStartTime;
      // 着手までの表示上の遅延は max(600ms, 実際の思考時間) とする
      const remainingDelay = Math.max(0, 600 - elapsed);

      timerId = setTimeout(() => {
        if (!isMounted) return;

        if (nextMove) {
          onMove(nextMove.row, nextMove.col);
        }

        setIsAiThinking(false);
      }, remainingDelay);
    };

    const handleError = (event: ErrorEvent) => {
      // Worker 内で捕捉されなかった例外（構文エラー等）に対するフォールバック
      console.error('[useAiPlayer] AI worker crashed:', event.message);
      if (isMounted) setIsAiThinking(false);
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);

    const request: AiWorkerRequest = {
      board,
      forbiddenMoves,
      currentPlayer,
    };
    worker.postMessage(request);

    return () => {
      isMounted = false;
      clearTimeout(timerId);
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
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