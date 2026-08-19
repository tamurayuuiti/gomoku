// src/hooks/useAiPlayer.ts
// AI プレイヤーの思考と着手を管理するカスタムフック。
//
// 責務:
//   - Worker の生成・postMessage・リスナ登録・terminate
//   - 応答世代管理と演出遅延
//   - 対局終了通知
//
// 注意:
//   - AI 探索ロジック自体には関与しない。
//   - Worker へ渡す禁手マトリクスは postMessage 直前に同期計算する。
//   - UI の useForbiddenRule を options.forbiddenRuleEnabled として常時伝搬する。
//   - AI レベルに応じた depth / timeLimitMs を SearchOptions へ設定する。

import { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import type {
  Player,
  BoardState,
  GameStatus,
  GameMode,
  Position,
  AiLevel,
} from '../types/game';
import type {
  AiWorkerRequest,
  AiWorkerResponse,
  AiWorkerControlMessage,
  AiGameResult,
} from '../workers/aiWorker.types';
import type { SearchOptions } from '../types/ai';
import { computeForbiddenMatrix } from '../utils/gameLogic';
import { AI_LEVEL_TABLE } from '../utils/ai/constants';

/**
 * 着手までの最低演出遅延 [ms] の既定値。
 * AI レベル別に minThinkDisplayMs prop から上書きできる。
 */
const DEFAULT_MIN_THINK_DISPLAY_MS = 500;

interface UseAiPlayerProps {
  board: BoardState;
  currentPlayer: Player;
  gameStatus: GameStatus;
  gameMode: GameMode;
  playerColor: Player;
  /** AI の強さレベル。depth / timeLimitMs を決定する。 */
  aiLevel: AiLevel;
  /** 禁じ手ルールが有効かどうか。Worker へ送る禁手マトリクスの計算に使う。 */
  useForbiddenRule: boolean;
  onMove: (row: number, col: number) => void;
  /**
   * 直前手（任意）。
   * Countermove Heuristic のルート精度を上げたい場合に渡す。
   */
  lastMove?: Position | null;
  /**
   * 着手までの最低演出遅延 [ms]。既定 600。
   */
  minThinkDisplayMs?: number;
}

export const useAiPlayer = ({
  board,
  currentPlayer,
  gameStatus,
  gameMode,
  playerColor,
  aiLevel,
  useForbiddenRule,
  onMove,
  lastMove,
  minThinkDisplayMs = DEFAULT_MIN_THINK_DISPLAY_MS,
}: UseAiPlayerProps) => {
  // 応答（またはエラー）を受け取り、表示上の最低遅延も消化し終えたターンの ID。
  // Worker からの非同期イベントに応じてのみ変化する値なので state として保持する。
  const [resolvedTurnId, setResolvedTurnId] = useState<string>('');

  // 直近で Worker へ送信済みのターン ID。
  // レンダー結果には使わないため ref で保持し、同一ターンの二重送信のみを防ぐ。
  const requestedTurnIdRef = useRef<string>('');
  const workerRef = useRef<Worker | null>(null);

  // 対局終了通知の二重送信防止用。
  const prevGameStatusRef = useRef<GameStatus>(gameStatus);

  // latest-ref 群。
  // コミット後に更新し、非同期コールバック内でのみ読み出す。
  const onMoveRef = useRef(onMove);
  /** 現在応答を待っているターン。null = 応答待ちではない。 */
  const pendingRef = useRef<{ turnId: string } | null>(null);
  /** 送信済みで未応答のリクエスト数。応答の世代管理に使う。 */
  const inflightRef = useRef(0);
  /** 応答待ちリクエストの思考開始時刻（演出遅延の計算用）。 */
  const thinkStartRef = useRef(0);
  /** 保留中の演出遅延タイマ。 */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // latest-ref の更新はレンダー中ではなくコミット後に行う。
  useLayoutEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  // AI の手番かどうかは props から同期的に導出できるため useMemo で計算する。
  const isAiTurn = useMemo(
    () =>
      gameMode === 'PvE' &&
      currentPlayer !== playerColor &&
      gameStatus === 'Playing',
    [gameMode, currentPlayer, playerColor, gameStatus]
  );

  // 現在の盤面を一意に表す ID。
  const turnId = useMemo(() => board.map(r => r.join(',')).join('|'), [board]);

  // lastMove の参照が毎回変わっても Effect を不必要に再実行しないよう、
  // 座標キーで安定化させる。
  const lastMoveKey = useMemo(
    () => (lastMove ? `${lastMove.row},${lastMove.col}` : ''),
    [lastMove]
  );

  // ------------------------------------------------------------
  // E1: Worker 生成・破棄
  // ------------------------------------------------------------
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/aiWorker.ts', import.meta.url),
      {
        type: 'module',
      }
    );
    workerRef.current = worker;

    // Worker が再生成された場合、直前までの送信・応答待ち状態はすべて無効になる。
    // ガードをリセットして、Worker への再送信を許可する。
    requestedTurnIdRef.current = '';
    pendingRef.current = null;
    inflightRef.current = 0;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // ------------------------------------------------------------
  // E2: 応答リスナ（常駐。思考中に削除されることは絶対にない）
  // ------------------------------------------------------------
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    const handleMessage = (event: MessageEvent<AiWorkerResponse>) => {
      // Worker は単一スレッドで FIFO に応答する。
      // 未応答リクエストが複数ある場合、先に到着した不要な応答は破棄し、
      // 最新リクエストの応答だけを適用する。
      inflightRef.current = Math.max(0, inflightRef.current - 1);

      const pending = pendingRef.current;
      if (!pending) return;

      // より新しいリクエストが未応答なら、この応答は破棄する。
      if (inflightRef.current > 0) return;

      const { nextMove, error } = event.data;
      const turnId = pending.turnId;
      pendingRef.current = null;

      if (error) {
        console.error('[useAiPlayer] AI worker error:', error);
        setResolvedTurnId(turnId);
        return;
      }

      const elapsed = performance.now() - thinkStartRef.current;
      // 着手までの表示上の遅延は max(minThinkDisplayMs, 実際の思考時間) とする。
      const remainingDelay = Math.max(0, minThinkDisplayMs - elapsed);

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (nextMove) {
          onMoveRef.current(nextMove.row, nextMove.col);
        }
        setResolvedTurnId(turnId);
      }, remainingDelay);
    };

    const handleError = (event: ErrorEvent) => {
      // Worker 内で捕捉されなかった例外（構文エラー等）に対するフォールバック。
      console.error('[useAiPlayer] AI worker crashed:', event.message);
      inflightRef.current = 0;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        setResolvedTurnId(pending.turnId);
      }
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);

    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    };
  }, [minThinkDisplayMs]);

  // ------------------------------------------------------------
  // E3: リクエスト送信（冪等。依存変化による再実行は無害）
  // ------------------------------------------------------------
  useEffect(() => {
    if (!isAiTurn) return;

    // 同一ターンの二重送信防止。
    if (requestedTurnIdRef.current === turnId) return;

    const worker = workerRef.current;
    if (!worker) return;

    // 前ターンの保留演出タイマを取消す。
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    requestedTurnIdRef.current = turnId;
    pendingRef.current = { turnId };
    inflightRef.current += 1;
    thinkStartRef.current = performance.now();

    // Worker 用禁手マトリクスを postMessage 直前に同期計算する。
    // 要求時点の盤面に対する全走査。
    const forbiddenMoves = computeForbiddenMatrix(
      board,
      currentPlayer,
      gameStatus,
      useForbiddenRule
    );

    // AI レベルに応じた探索深度・思考時間・診断用レベルを SearchOptions へ設定する。
    const levelParams = AI_LEVEL_TABLE[aiLevel];
    const options: SearchOptions = {
      forbiddenRuleEnabled: useForbiddenRule,
      depth: levelParams.depth,
      timeLimitMs: levelParams.timeLimitMs,
      aiLevel,
    };

    // lastMove が指定されている場合のみ options.lastMove を付与する。
    if (lastMoveKey) {
      const [row, col] = lastMoveKey.split(',').map(Number);
      options.lastMove = { row, col };
    }

    const request: AiWorkerRequest = {
      board,
      forbiddenMoves,
      currentPlayer,
      options,
    };
    worker.postMessage(request);
  }, [
    isAiTurn,
    turnId,
    board,
    currentPlayer,
    gameStatus,
    useForbiddenRule,
    lastMoveKey,
    aiLevel,
  ]);

  // ------------------------------------------------------------
  // AI 手番の終了時に保留中の演出タイマを取消す
  // ------------------------------------------------------------
  // 演出遅延中にリセットやモード切替が行われた場合、
  // 前のターンの着手がリセット後の盤面に適用されてはならない。
  useEffect(() => {
    if (!isAiTurn && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [isAiTurn]);

  // ------------------------------------------------------------
  // 対局終了通知
  // ------------------------------------------------------------
  useEffect(() => {
    const prev = prevGameStatusRef.current;
    prevGameStatusRef.current = gameStatus;

    if (gameMode !== 'PvE') return;

    // Playing -> 終了状態への遷移だけを対象にする。
    if (prev === 'Playing' && gameStatus !== 'Playing') {
      const worker = workerRef.current;
      if (!worker) return;

      let aiResult: AiGameResult = 'Unknown';
      if (gameStatus === 'Draw') {
        aiResult = 'Draw';
      } else if (gameStatus === 'BlackWins') {
        // playerColor は人間の色。AI はその反対。
        aiResult = playerColor === 'Black' ? 'Loss' : 'Win';
      } else if (gameStatus === 'WhiteWins') {
        aiResult = playerColor === 'White' ? 'Loss' : 'Win';
      }

      const message: AiWorkerControlMessage = {
        control: 'finalizeGameSession',
        aiResult,
      };
      worker.postMessage(message);
    }
  }, [gameStatus, gameMode, playerColor]);

  // ------------------------------------------------------------
  // アンマウント時: 保留タイマの破棄
  // ------------------------------------------------------------
  // Worker は E1 の cleanup で terminate される。
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // ------------------------------------------------------------
  // Undo / リセット時のターン管理状態初期化
  // ------------------------------------------------------------
  // requestedTurnIdRef と resolvedTurnId を初期化し、Undo やリセット後に
  // AI 手番へ移った場合でも E3 effect が正しく発火できるようにする。
  // inflightRef は Worker 応答の破棄判定に使うため初期化しない。
  const resetAiTurnState = useCallback(() => {
    requestedTurnIdRef.current = '';
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setResolvedTurnId('');
  }, []);

  // 「Worker に問い合わせ中」＝ AI の手番であり、かつ現在のターンがまだ解決していない場合。
  const isAiThinking = isAiTurn && turnId !== resolvedTurnId;

  return { isAiThinking, resetAiTurnState };
};