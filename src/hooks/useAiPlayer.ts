// src/hooks/useAiPlayer.ts
// AIプレイヤーの思考と着手を管理するカスタムフック
//
// AI探索（calculateNextMove 以降）は UIスレッドをブロックしないよう
// aiWorker（src/workers/aiWorker.ts）内で実行する。このフックは Worker の
// 生成・postMessage・リスナ登録・アンマウント時の terminate() のみを担い、
// 探索ロジック自体には関与しない。
//
// --- 第9弾: 構造変更 ---
// 1. 「応答リスナ登録」effect（E2）と「リクエスト送信」effect（E3）を分離した。
//    旧実装は送信ガードがリスナ登録より前にあったため、思考中の依存変化で
//    リスナが削除されたまま再登録されず、Worker 応答が消失して
//    「AIが思考中...」のままハングし得る構造だった。新実装ではリスナを
//    常駐させ、応答を ref 経由で突合する。
// 2. 応答世代管理: inflight カウンタ（inflightRef）により、思考中リセット
//    などで生じた旧盤面の応答を破棄し、幻の石の発生を防ぐ。
// 3. Worker へ渡す禁手マトリクスは、E3 内で postMessage 直前に
//    computeForbiddenMatrix により同期計算する（要求時点の最新盤面に対する
//    新鮮な全走査）。旧実装（レンダー中の useMemo 結果を渡す）と同一の
//    セマンティクスを保ったまま、重い走査をレンダーフェーズから退避する。
// 4. 演出遅延の下限は minThinkDisplayMs で上書き可能（既定 600ms で変更なし）。
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
//
// --- 対局終了通知（追加） ---
// gameStatus が Playing から終了状態へ遷移したとき、Worker へ
// finalizeGameSession 制御メッセージを送信する。
// これにより、人間勝ち・引き分け時にも対局全体統計を確定できる。
//
// --- 禁手設定伝搬（v2.0.0 整合性修正） ---
// UI の useForbiddenRule を Single Source of Truth とし、
// Worker へ options.forbiddenRuleEnabled として常時伝搬する。
import { useState, useEffect, useMemo, useRef } from 'react';
import type {
  Player,
  BoardState,
  GameStatus,
  GameMode,
  Position,
} from '../types/game';
import type {
  AiWorkerRequest,
  AiWorkerResponse,
  AiWorkerControlMessage,
  AiGameResult,
} from '../workers/aiWorker.types';
import type { SearchOptions } from '../types/ai';
import { computeForbiddenMatrix } from '../utils/gameLogic';

/**
 * 着手までの最低演出遅延 [ms] の既定値。
 * v2.0.0 の既定は 600（既存の体感を変更しない）。
 * AI レベル別に minThinkDisplayMs prop から上書きできる。
 */
const DEFAULT_MIN_THINK_DISPLAY_MS = 600;

interface UseAiPlayerProps {
  board: BoardState;
  currentPlayer: Player;
  gameStatus: GameStatus;
  gameMode: GameMode;
  playerColor: Player;
  /** 禁じ手ルールが有効かどうか。Worker へ送る禁手マトリクスの計算に使う。 */
  useForbiddenRule: boolean;
  onMove: (row: number, col: number) => void;
  /**
   * 直前手（任意）。
   * Countermove Heuristic のルート精度を上げたい場合に渡す。
   * 未指定でも AI 探索内部では着手ごとに lastMove が伝播する。
   */
  lastMove?: Position | null;
  /**
   * 着手までの最低演出遅延 [ms]。既定 600。
   * AI レベル別の preset からの上書きを想定する。
   */
  minThinkDisplayMs?: number;
}

export const useAiPlayer = ({
  board,
  currentPlayer,
  gameStatus,
  gameMode,
  playerColor,
  useForbiddenRule,
  onMove,
  lastMove,
  minThinkDisplayMs = DEFAULT_MIN_THINK_DISPLAY_MS,
}: UseAiPlayerProps) => {
  // 応答（またはエラー）を受け取り、表示上の最低遅延も消化し終えたターンのID。
  // Workerからの非同期イベントに応じてのみ変化する値なので state として保持する。
  const [resolvedTurnId, setResolvedTurnId] = useState<string>('');

  // 直近でWorkerへ送信済みのターンID。レンダー結果には使わないため ref で保持し、
  // 依存配列の参照変化による同一ターンの二重送信のみを防ぐ。
  const requestedTurnIdRef = useRef<string>('');

  const workerRef = useRef<Worker | null>(null);

  // 対局終了通知の二重送信防止用。
  const prevGameStatusRef = useRef<GameStatus>(gameStatus);

  // --- 第9弾: latest-ref 群（レンダーごとに書き込み、非同期コールバック内でのみ読み出す） ---
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  /** 現在応答を待っているターン。null = 応答待ちではない。 */
  const pendingRef = useRef<{ turnId: string } | null>(null);

  /** 送信済みで未応答のリクエスト数。旧応答の世代管理に使う。 */
  const inflightRef = useRef(0);

  /** 応答待ちリクエストの思考開始時刻（演出遅延の計算用）。 */
  const thinkStartRef = useRef(0);

  /** 保留中の演出遅延タイマ。 */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // --- E1: Worker生成・破棄 ---
  useEffect(() => {
    const worker = new Worker(new URL('../workers/aiWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    // 第9弾（StrictMode / HMR 対応）: Worker が再生成された場合、直前までの
    // 送信・応答待ち状態はすべて無効になるため、ガードをリセットして
    // 新しい Worker への再送信を許可する。
    requestedTurnIdRef.current = '';
    pendingRef.current = null;
    inflightRef.current = 0;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // --- E2: 応答リスナ（常駐。思考中に削除されることは絶対にない） ---
  // 第9弾: 旧実装の「ガードがリスナ登録より前」構造を逆転させた。
  // 応答は pendingRef / inflightRef で突合し、onMove は onMoveRef 経由で
  // 常に最新のコールバックを呼ぶ。
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    const handleMessage = (event: MessageEvent<AiWorkerResponse>) => {
      // Worker は単一スレッドで FIFO に応答する。
      // 未応答リクエストが複数ある場合（思考中リセット等）、
      // 古い応答は破棄し、最新リクエストの応答だけを適用する。
      inflightRef.current = Math.max(0, inflightRef.current - 1);

      const pending = pendingRef.current;
      if (!pending) return;
      if (inflightRef.current > 0) return; // より新しいリクエストが未応答 → この旧応答は破棄

      const { nextMove, error } = event.data;
      const turnId = pending.turnId;
      pendingRef.current = null;

      if (error) {
        console.error('[useAiPlayer] AI worker error:', error);
        setResolvedTurnId(turnId);
        return;
      }

      const elapsed = performance.now() - thinkStartRef.current;

      // 着手までの表示上の遅延は max(minThinkDisplayMs, 実際の思考時間) とする
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
      // Worker 内で捕捉されなかった例外（構文エラー等）に対するフォールバック
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

  // --- E3: リクエスト送信（冪等。依存変化による再実行は無害） ---
  // 第9弾: Worker 用禁手マトリクスをここで postMessage 直前に同期計算する
  // （要求時点の最新盤面に対する新鮮な全走査。旧実装と同一セマンティクス）。
  //
  // v2.0.0 整合性修正:
  // UI の useForbiddenRule を options.forbiddenRuleEnabled として常時伝搬する。
  useEffect(() => {
    if (!isAiTurn) return;

    // 同一ターンの二重送信防止（依存配列内の参照変化でEffectが再実行されても送信しない）
    if (requestedTurnIdRef.current === turnId) return;

    const worker = workerRef.current;
    if (!worker) return;

    // 前ターンの保留演出タイマ（リセット等で生き残っている場合）を取消す。
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    requestedTurnIdRef.current = turnId;
    pendingRef.current = { turnId };
    inflightRef.current += 1;
    thinkStartRef.current = performance.now();

    const forbiddenMoves = computeForbiddenMatrix(
      board,
      currentPlayer,
      gameStatus,
      useForbiddenRule
    );

    const options: SearchOptions = {
      forbiddenRuleEnabled: useForbiddenRule,
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
  ]);

  // --- 第9弾: AI手番の終了時に保留中の演出タイマを取消す ---
  // 演出遅延中（応答受信済み・タイマ保留中）にリセットやモード切替が
  // 行われた場合、旧ターンの着手が新しい盤面に適用されてはならない。
  useEffect(() => {
    if (!isAiTurn && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [isAiTurn]);

  // --- 対局終了通知 ---
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

  // --- アンマウント時: 保留タイマの破棄（Worker は E1 の cleanup で terminate される） ---
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // 「Workerに問い合わせ中」＝ AIの手番であり、かつ現在のターンがまだ解決していない場合
  const isAiThinking = isAiTurn && turnId !== resolvedTurnId;

  return { isAiThinking };
};