// src/utils/ai/search.ts
// AIの次の一手を計算するロジックを定義するファイル
//
// 初手処理（盤面空き → 中央）、反復深化（iterative deepening）ループの制御、
// Aspiration Window による探索ウィンドウ管理、findBestMove の呼び出しと結果の返却を担う。
// 探索ロジック本体（αβ・move ordering・評価関数・TT・LMR・PVS・LineCache）は
// minimax.ts 以下に完全委譲し、このファイルは "薄いアダプタ" として常に軽量に保つ。
//
// 第3弾:
//   - Aspiration Window を安全な形で再有効化
//   - fail-high / fail-low 時は必ず full window で再探索
//   - WIN / LOSS 付近では Aspiration を使わない
//
// 第4弾:
//   - 思考単位で統計情報を生成し、思考終了後にサマリログを出力する。
//   - 探索挙動・時間制御・Aspiration の有効/無効条件は変更しない。
//
// 追加:
//   - 対局全体統計セッションを開始・記録・終了する。
//   - AI が勝った場合はその場で GameSession を終了する。
//   - 人間勝ち・引き分けは UI からの制御メッセージで終了する。
//
// 第5弾:
//   - Aspiration Window の再調整（flag 付き）
//   - adaptive Aspiration（flag 付き）
//   - 時間予測（flag 付き）
//   - 中心パターンキャッシュ統計の反映
//
// 第5.5弾:
//   - Aspiration tuning / adaptive を既定で活用するための制御を追加
//   - adaptive window の簡易収縮を追加
//   - 時間予測の適用開始深度を保守化
//
// 第5.5.1弾:
//   - Static Eval Cache を calculateNextMove 単位で生成し、全 findBestMove で共有
//   - Aspiration quiet-only 条件を追加

import type { BoardState, Position, Player } from '../../types/game';
import type { SearchOptions } from '../../types/ai';
import { BOARD_SIZE, checkWin } from '../gameLogic';
import {
  AI_CONFIG,
  AI_SCORES,
  TT_CONFIG,
  AI_FEATURES,
  PHASE5_FEATURES,
  PHASE5_CONFIG,
} from './constants';
import { findBestMove } from './minimax';
import { TranspositionTable } from './transpositionTable';
import {
  resetPatternCacheStats,
  getPatternCacheStats,
  resetCenterPatternCacheStats,
  getCenterPatternCacheStats,
} from './evaluator';
import {
  createStaticEvalCache,
  type StaticEvalCache,
} from './staticEvalCache';
import {
  createSearchStats,
  mergeTTStats,
  mergePatternCacheStats,
  mergeCenterPatternCacheStats,
  finalizeSearchStats,
  logSearchSummary,
  shouldLogVerboseSearch,
  ensureGameSession,
  isGameSessionActive,
  getActiveGameSession,
  recordMoveToSession,
  finalizeGameSession,
} from './searchStats';

/**
 * Aspiration Window を適用してよいか判定する。
 *
 * - depth >= 2
 * - 前回スコアがある
 * - 前回スコアが WIN / LOSS 付近ではない
 *
 * 第5.5.1弾:
 * - ENABLE_ASPIRATION_QUIET_ONLY 有効時は、
 *   abs(prevScore) >= ASPIRATION_QUIET_THRESHOLD の戦術的領域で Aspiration を使わない。
 */
const shouldUseAspiration = (
  depth: number,
  prevScore: number | null
): boolean => {
  if (!AI_FEATURES.ENABLE_SAFE_ASPIRATION) return false;
  if (depth < 2) return false;
  if (prevScore === null) return false;

  const absScore = Math.abs(prevScore);

  // WIN / LOSS 付近ではウィンドウを狭めるリスクを避ける
  if (absScore >= AI_SCORES.WIN / 2) return false;

  // 戦術的スコア領域では score 変動が大きいため、full window を使う
  if (
    PHASE5_FEATURES.ENABLE_ASPIRATION_QUIET_ONLY &&
    absScore >= PHASE5_CONFIG.ASPIRATION_QUIET_THRESHOLD
  ) {
    return false;
  }

  return true;
};

/**
 * 盤上の石数を数える。
 * 対局統計の推定総手数に使う。
 */
const countStones = (board: BoardState): number => {
  let count = 0;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null) count++;
    }
  }

  return count;
};

/**
 * 対局セッションを開始する。
 *
 * 基本は AI の着手要求が来た時点でセッションを確保する。
 * ただし、以下のような場合は別対局とみなして直前のセッションを Reset 終了する。
 *
 * - 盤面が空になっている
 * - 盤面の石が 1 個だけ（人間先手の新規対局開始直後とみなす）
 * - AI 手番色が前セッションと異なる
 */
const startGameSessionForMove = (
  aiPlayer: Player,
  stonesBefore: number
): void => {
  if (isGameSessionActive()) {
    const active = getActiveGameSession();

    if (
      !active ||
      active.aiPlayer !== aiPlayer ||
      stonesBefore === 0 ||
      stonesBefore === 1
    ) {
      finalizeGameSession('Reset');
    }
  }

  ensureGameSession(aiPlayer);
};

/**
 * AI の着手が勝利かどうかを判定する。
 * board を一時的に書き換えて checkWin を呼び、すぐ復元する。
 */
const isWinningMove = (
  board: BoardState,
  move: Position,
  player: Player
): boolean => {
  board[move.row][move.col] = player;
  const win = checkWin(board, move, player);
  board[move.row][move.col] = null;

  return win;
};

/**
 * 第5.5.1弾:
 * 1回の calculateNextMove 全体で共有する Static Eval Cache を生成する。
 */
const createPerMoveStaticEvalCache = (
  forbiddenMoves: boolean[][],
  aiPlayer: Player
): StaticEvalCache | null => {
  if (!PHASE5_FEATURES.ENABLE_STATIC_EVAL_CACHE) return null;

  return createStaticEvalCache(
    {
      limit: PHASE5_CONFIG.STATIC_EVAL_CACHE_LIMIT,
      evictionRatio: PHASE5_CONFIG.STATIC_EVAL_CACHE_EVICTION_RATIO,
    },
    {
      aiPlayer,
      forbiddenMoves,
      candidateSetEnabled: AI_FEATURES.ENABLE_INCREMENTAL_CANDIDATES,
    }
  );
};

/**
 * AIの次の一手を計算して返す。
 *
 * 公開インターフェース: この関数のシグネチャは変更禁止。
 */
export const calculateNextMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  currentTurn: Player,
  options?: SearchOptions
): Position | null => {
  const startTime = performance.now();

  resetPatternCacheStats();
  resetCenterPatternCacheStats();

  const stonesBefore = countStones(board);
  startGameSessionForMove(currentTurn, stonesBefore);

  const isBoardEmpty = stonesBefore === 0;

  // 初手は中央
  if (isBoardEmpty) {
    const center = Math.floor(BOARD_SIZE / 2);
    const centerMove: Position = { row: center, col: center };

    const stats = createSearchStats(currentTurn, 'center', 0, null, null);

    stats.selectedMove = centerMove;
    stats.selectedScore = 0;
    stats.completedDepth = 0;
    stats.time.elapsedMs = performance.now() - startTime;

    mergePatternCacheStats(stats, getPatternCacheStats());
    mergeCenterPatternCacheStats(stats, getCenterPatternCacheStats());

    finalizeSearchStats(stats);
    logSearchSummary(stats);

    recordMoveToSession(stats, 1, true);

    return centerMove;
  }

  const explicitDepth = options?.depth !== undefined;
  const explicitTime = options?.timeLimitMs !== undefined;

  /**
   * lastMove だけが渡された場合は「探索パラメータはデフォルト」として扱う。
   * これにより、Worker 経由で lastMove を追加しても従来の時間制御が壊れない。
   */
  const onlyLastMove =
    options !== undefined &&
    !explicitDepth &&
    !explicitTime &&
    options.lastMove !== undefined;

  const maxDepth = explicitDepth
    ? (options!.depth as number)
    : AI_CONFIG.MINIMAX_DEPTH;

  const timeLimitMs = explicitTime
    ? (options!.timeLimitMs as number)
    : (!explicitDepth && (options === undefined || onlyLastMove)
        ? AI_CONFIG.DEFAULT_TIME_LIMIT_MS
        : undefined);

  const lastMove = options?.lastMove ?? null;

  // --- timeLimitMs 未指定: 従来通りの固定深さ探索 ---
  if (timeLimitMs === undefined) {
    const stats = createSearchStats(currentTurn, 'fixed', maxDepth, null, lastMove);
    const tt = new TranspositionTable();

    const staticEvalCache = createPerMoveStaticEvalCache(
      forbiddenMoves,
      currentTurn
    );

    const result = findBestMove(
      board,
      forbiddenMoves,
      currentTurn,
      maxDepth,
      Infinity,
      tt,
      -Infinity,
      Infinity,
      lastMove,
      stats,
      staticEvalCache
    );

    stats.selectedMove = result.move;
    stats.selectedScore = result.move ? result.score : null;
    stats.completedDepth = result.move ? maxDepth : 0;
    stats.time.elapsedMs = performance.now() - startTime;

    mergeTTStats(stats, tt.stats);
    mergePatternCacheStats(stats, getPatternCacheStats());
    mergeCenterPatternCacheStats(stats, getCenterPatternCacheStats());

    finalizeSearchStats(stats);
    logSearchSummary(stats);

    const movePlayed = result.move !== null;

    recordMoveToSession(
      stats,
      stonesBefore + (movePlayed ? 1 : 0),
      movePlayed
    );

    if (result.move && isWinningMove(board, result.move, currentTurn)) {
      finalizeGameSession('Win');
    }

    return result.move;
  }

  // --- timeLimitMs 指定: 反復深化（iterative deepening） ---
  const stats = createSearchStats(
    currentTurn,
    'iterative',
    maxDepth,
    timeLimitMs,
    lastMove
  );

  const deadline = performance.now() + timeLimitMs;
  const tt = new TranspositionTable();

  /**
   * 第5.5.1弾:
   * Static Eval Cache を calculateNextMove 単位で 1 回だけ生成し、
   * 反復深化の全 depth / Aspiration 再探索で共有する。
   */
  const staticEvalCache = createPerMoveStaticEvalCache(
    forbiddenMoves,
    currentTurn
  );

  let best: Position | null = null;
  let completedDepth = 0;
  let prevScore: number | null = null;

  // 第5弾：Aspiration 調整用状態
  const baseAspirationWindow = PHASE5_FEATURES.ENABLE_ASPIRATION_TUNING
    ? PHASE5_CONFIG.ASPIRATION_WINDOW_OVERRIDE
    : TT_CONFIG.ASPIRATION_WINDOW;

  let adaptiveAspirationWindow = baseAspirationWindow;
  let prevAspirationFailed = false;

  for (let d = 1; d <= maxDepth; d++) {
    const iterStart = performance.now();

    // depth=1 は時間制限なしで探索し、極端に短い timeLimitMs でも AI が無反応にならない保証とする
    const effectiveDeadline = d === 1 ? Infinity : deadline;

    let alpha = -Infinity;
    let beta = Infinity;

    const aspirationCandidate =
      AI_FEATURES.ENABLE_SAFE_ASPIRATION &&
      d >= 2 &&
      prevScore !== null;

    const useAspiration = shouldUseAspiration(d, prevScore);

    if (aspirationCandidate && !useAspiration) {
      stats.aspiration.disabledNearWin++;
    }

    /**
     * Aspiration を使わない場合は adaptive window を base に戻す。
     * これにより、戦術領域から静かな領域へ戻ったときに広い window を引きずらない。
     */
    if (!useAspiration) {
      adaptiveAspirationWindow = baseAspirationWindow;
    }

    let depthAspirationFailed = false;

    if (useAspiration) {
      let window = adaptiveAspirationWindow;

      if (
        PHASE5_FEATURES.ENABLE_ADAPTIVE_ASPIRATION &&
        prevAspirationFailed
      ) {
        window = Math.min(
          PHASE5_CONFIG.ASPIRATION_ADAPTIVE_MAX_WINDOW,
          window * 2
        );

        adaptiveAspirationWindow = window;
        stats.aspiration.adaptiveExpansions++;
      }

      alpha = (prevScore as number) - window;
      beta = (prevScore as number) + window;

      stats.aspiration.attempts++;
      stats.aspiration.windowSum += window;

      if (window > stats.aspiration.windowMax) {
        stats.aspiration.windowMax = window;
      }
    }

    // 探索実行
    let result = findBestMove(
      board,
      forbiddenMoves,
      currentTurn,
      d,
      effectiveDeadline,
      tt,
      alpha,
      beta,
      lastMove,
      stats,
      staticEvalCache
    );

    // ------------------------------------------------------------
    // Aspiration Window fail-high / fail-low 再探索
    // 安全側: どちらかに触れたら原則 full window で再探索する。
    // ------------------------------------------------------------
    if (useAspiration && result.move !== null) {
      if (result.score >= beta) {
        stats.aspiration.failHigh++;
        stats.aspiration.fullResearches++;
        depthAspirationFailed = true;

        if (shouldLogVerboseSearch()) {
          console.log(
            `[Search] depth=${d} aspiration fail-high (score=${result.score}, window=[${alpha}, ${beta}]), ` +
            `re-searching with full window`
          );
        }

        result = findBestMove(
          board,
          forbiddenMoves,
          currentTurn,
          d,
          effectiveDeadline,
          tt,
          -Infinity,
          Infinity,
          lastMove,
          stats,
          staticEvalCache
        );
      } else if (result.score <= alpha) {
        stats.aspiration.failLow++;
        stats.aspiration.fullResearches++;
        depthAspirationFailed = true;

        if (shouldLogVerboseSearch()) {
          console.log(
            `[Search] depth=${d} aspiration fail-low (score=${result.score}, window=[${alpha}, ${beta}]), ` +
            `re-searching with full window`
          );
        }

        result = findBestMove(
          board,
          forbiddenMoves,
          currentTurn,
          d,
          effectiveDeadline,
          tt,
          -Infinity,
          Infinity,
          lastMove,
          stats,
          staticEvalCache
        );
      }
    }

    // null = この深さは時間切れで未完了。直前の完全な結果を採用して打ち切る。
    if (!result.move) break;

    best = result.move;
    prevScore = result.score;
    completedDepth = d;

    const iterElapsed = performance.now() - iterStart;
    stats.time.lastIterationMs = iterElapsed;

    /**
     * 第5.5弾:
     * adaptive aspiration の簡易収縮。
     * fail しなかった場合は、広げた window を base へ戻していく。
     */
    if (
      PHASE5_FEATURES.ENABLE_ADAPTIVE_ASPIRATION &&
      useAspiration &&
      !depthAspirationFailed &&
      adaptiveAspirationWindow > baseAspirationWindow
    ) {
      adaptiveAspirationWindow = Math.max(
        baseAspirationWindow,
        Math.floor(adaptiveAspirationWindow / 2)
      );
    }

    // 次の深さに進む余地がなければここで打ち切る
    if (performance.now() >= deadline) break;

    // 第5弾：時間予測（保守的）
    // 第5.5弾: 適用開始深度を TIME_PREDICTION_MIN_DEPTH へ引き上げ。
    if (
      PHASE5_FEATURES.ENABLE_TIME_PREDICTION &&
      d >= PHASE5_CONFIG.TIME_PREDICTION_MIN_DEPTH
    ) {
      const remaining = deadline - performance.now();
      const estimate = iterElapsed * PHASE5_CONFIG.TIME_PREDICTION_SAFETY;

      if (remaining < estimate) {
        stats.time.predictedSkips++;
        stats.time.remainingAtSkipMs = remaining;
        break;
      }
    }

    prevAspirationFailed = depthAspirationFailed && useAspiration;
  }

  stats.selectedMove = best;
  stats.selectedScore = best ? prevScore : null;
  stats.completedDepth = completedDepth;
  stats.time.elapsedMs = performance.now() - startTime;

  mergeTTStats(stats, tt.stats);
  mergePatternCacheStats(stats, getPatternCacheStats());
  mergeCenterPatternCacheStats(stats, getCenterPatternCacheStats());

  finalizeSearchStats(stats);
  logSearchSummary(stats);

  const movePlayed = best !== null;

  recordMoveToSession(
    stats,
    stonesBefore + (movePlayed ? 1 : 0),
    movePlayed
  );

  if (best && isWinningMove(board, best, currentTurn)) {
    finalizeGameSession('Win');
  }

  return best;
};
