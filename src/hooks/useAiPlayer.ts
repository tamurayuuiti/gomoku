// src/hooks/useAiPlayer.ts
// AIプレイヤーの思考と着手を管理するカスタムフック
//
// AI探索（calculateNextMove 以降）は UIスレッドをブロックしないよう
// aiWorker（src/workers/aiWorker.ts）内で実行する。このフックは Worker の
// 生成・postMessage・onmessage・onerror・アンマウント時の terminate() のみを担い、
// 探索ロジック自体には関与しない。
//
// --- isAiThinking の設計方針 ---
// isAiTurn・turnId は props から同期的に導出できる値のため、Effect 内で
// state にコピーせず useMemo で計算する（react-hooks/set-state-in-effect が
// 指摘する「導出可能な値の不要な state 化」を避けるため）。
//
// 「Workerに問い合わせ中かどうか」は turnId と resolvedTurnId（Workerからの
// 応答・エラーを受け取り、表示上の最低遅延も消化し終えたターンのID）の比較
// から導出する：isAiTurn && turnId !== resolvedTurnId。resolvedTurnId は
// Workerのイベントや setTimeout のコールバックという、Reactの外側で発生する
// 非同期イベントに応じてのみ更新する state であり、Effect本体の同期実行部分で
// setState を呼ぶ箇所は存在しない。
//
// これにより、旧実装で専用Effectが担っていた「AIの手番でなくなったら
// isAiThinking を false に戻す」という挙動も、isAiTurn を導出値の算出に
// 組み込むことで自然に再現している。
//
// --- lastMove（第2弾追加） ---
// 任意で lastMove を受け取り、Worker へ options.lastMove として渡す。
// 未指定の場合は従来通り options なしで Worker を呼び出す。

import { useState, useEffect, useMemo, useRef } from 'react';
import type {
  Player,
  BoardState,
  GameStatus,
  GameMode,
  Position,
} from '../types/game';
import type { AiWorkerRequest, AiWorkerResponse } from '../workers/aiWorker.types';

interface UseAiPlayerProps {
  board: BoardState;
  currentPlayer: Player;
  gameStatus: GameStatus;
  gameMode: GameMode;
  playerColor: Player;
  forbiddenMoves: boolean[][];
  onMove: (row: number, col: number) => void;

  /**
   * 直前手（任意）。
   * Countermove Heuristic のルート精度を上げたい場合に渡す。
   * 未指定でも AI 探索内部では着手ごとに lastMove が伝播する。
   */
  lastMove?: Position | null;
}

export const useAiPlayer = ({
  board,
  currentPlayer,
  gameStatus,
  gameMode,
  playerColor,
  forbiddenMoves,
  onMove,
  lastMove,
}: UseAiPlayerProps) => {
  // 応答（またはエラー）を受け取り、表示上の最低遅延も消化し終えたターンのID。
  // Workerからの非同期イベントに応じてのみ変化する値なので state として保持する。
  const [resolvedTurnId, setResolvedTurnId] = useState<string>('');

  // 直近でWorkerへ送信済みのターンID。レンダー結果には使わないため ref で保持し、
  // 依存配列の参照変化による同一ターンの二重送信のみを防ぐ。
  const requestedTurnIdRef = useRef<string>('');

  const workerRef = useRef<Worker | null>(null);

  // AIの手番かどうかは props から同期的に導出できるため useMemo で計算する
  const isAiTurn = useMemo(
    () =>
      gameMode === 'PvE' &&
      currentPlayer !== playerColor &&
      gameStatus === 'Playing',
    [gameMode, currentPlayer, playerColor, gameStatus],
  );

  // 現在の盤面を一意に表すID
  const turnId = useMemo(() => board.map((r) => r.join(',')).join('|'), [board]);

  // lastMove の参照が毎回変わっても Effect を不必要に再実行しないよう、
  // 座標キーで安定化させる。
  const lastMoveKey = useMemo(
    () => (lastMove ? `${lastMove.row},${lastMove.col}` : ''),
    [lastMove],
  );

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

    if (!isAiTurn) return;

    // 同一ターンの二重送信防止（依存配列内の参照変化でEffectが再実行されても送信しない）
    if (requestedTurnIdRef.current === turnId) return;

    const worker = workerRef.current;
    if (!worker) return;

    requestedTurnIdRef.current = turnId;

    const thinkStartTime = performance.now();

    const handleMessage = (event: MessageEvent<AiWorkerResponse>) => {
      const { nextMove, error } = event.data;

      if (error) {
        console.error('[useAiPlayer] AI worker error:', error);
        if (isMounted) setResolvedTurnId(turnId);
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

        setResolvedTurnId(turnId);
      }, remainingDelay);
    };

    const handleError = (event: ErrorEvent) => {
      // Worker 内で捕捉されなかった例外（構文エラー等）に対するフォールバック
      console.error('[useAiPlayer] AI worker crashed:', event.message);
      if (isMounted) setResolvedTurnId(turnId);
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);

    const request: AiWorkerRequest = {
      board,
      forbiddenMoves,
      currentPlayer,
    };

    // lastMove が指定されている場合のみ options を付与する。
    // これにより、既存の呼び出し側（lastMove 未指定）は完全に従来動作となる。
    if (lastMoveKey) {
      const [row, col] = lastMoveKey.split(',').map(Number);
      request.options = {
        lastMove: { row, col },
      };
    }

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
    isAiTurn,
    turnId,
    lastMoveKey,
  ]);

  // 「Workerに問い合わせ中」＝ AIの手番であり、かつ現在のターンがまだ解決していない場合
  const isAiThinking = isAiTurn && turnId !== resolvedTurnId;

  return { isAiThinking };
};