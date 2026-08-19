// src/utils/ai/search.ts
// AI の次の一手を計算する探索マネージャ。
//
// 責務:
//   - 初手中央
//   - Root VCF
//   - 固定深度探索
//   - 反復深化
//   - 統計最終化 / ログ / セッション記録
//
// 注意:
//   - 探索本体は minimax.ts 以下に委譲する。
//   - 公開 API calculateNextMove のシグネチャは変更しない。

import type { BoardState, Position, Player, AiLevel } from '../../types/game';
import type { SearchOptions, SearchStats } from '../../types/ai';
import {
  BOARD_SIZE,
  checkWin,
  checkForbiddenMove,
  countStones,
} from '../gameLogic';
import {
  AI_CONFIG,
  AI_SCORES,
  TT_CONFIG,
  AI_FEATURES,
  SEARCH_TUNING_FEATURES,
  SEARCH_TUNING_CONFIG,
  THREAT_FORBIDDEN_FEATURES,
  VCF_FEATURES,
} from './constants';
import { findBestMove } from './minimax';
import { TranspositionTable } from './transpositionTable';
import { hasStoneNearby } from './evaluator';
import {
  createStaticEvalCache,
  type StaticEvalCache,
} from './staticEvalCache';
import {
  createDynamicForbiddenController,
  type DynamicForbiddenController,
} from './dynamicForbidden';
import {
  createSearchStats,
  mergeTTStats,
  finalizeSearchStats,
  logSearchSummary,
  shouldLogVerboseSearch,
  ensureGameSession,
  isGameSessionActive,
  getActiveGameSession,
  recordMoveToSession,
  finalizeGameSession,
} from './searchStats';
import { runRootVcf } from './vcfSolver';
import { createQSearchController } from './quiescence';

// ============================================================
// Aspiration Window
// ============================================================

/**
 * Aspiration Window を適用してよいか判定する。
 *
 * - depth >= 2
 * - 前回スコアがある
 * - 前回スコアが WIN / LOSS 付近ではない
 */
const shouldUseAspiration = (
  depth: number,
  prevScore: number | null
): boolean => {
  if (!AI_FEATURES.ENABLE_ASPIRATION_WINDOW) return false;
  if (depth < 2) return false;
  if (prevScore === null) return false;

  const absScore = Math.abs(prevScore);

  // WIN / LOSS 付近ではウィンドウを狭めるリスクを避ける。
  if (absScore >= AI_SCORES.WIN / 2) return false;

  // 戦術的スコア領域では score 変動が大きいため、full window を使う。
  if (
    SEARCH_TUNING_FEATURES.ENABLE_ASPIRATION_QUIET_ONLY &&
    absScore >= SEARCH_TUNING_CONFIG.ASPIRATION_QUIET_THRESHOLD
  ) {
    return false;
  }

  return true;
};

// ============================================================
// 対局セッション補助
// ============================================================

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
  stonesBefore: number,
  aiLevel: AiLevel | null
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
  ensureGameSession(aiPlayer, aiLevel);
};

/**
 * AI の着手が勝利かどうかを判定する。
 * board を一時的に書き換えて checkWin を呼び、すぐ復元する。
 *
 * 注意:
 * threatModel.wouldWin とは「着手マスが空でない場合」の挙動が異なるため、
 * v2.0.0 前の低リスク整理ではあえてこの local 実装を維持する。
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

// ============================================================
// 探索パラメータ解決
// ============================================================

interface ResolvedSearchParameters {
  maxDepth: number;
  timeLimitMs: number | undefined;
  lastMove: Position | null;
  aiLevel: AiLevel | null;
}

/**
 * SearchOptions から探索パラメータを解決する。
 *
 * 既存の挙動を完全に維持するため、
 * onlyLastMove / onlyForbiddenRule の判定条件は変更しない。
 */
const resolveSearchParameters = (
  options?: SearchOptions
): ResolvedSearchParameters => {
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

  /**
   * forbiddenRuleEnabled だけが渡された場合も「探索パラメータはデフォルト」として扱う。
   * UI から options として禁手設定を常時伝搬するため、従来の時間制御を維持する。
   */
  const onlyForbiddenRule =
    options !== undefined &&
    !explicitDepth &&
    !explicitTime &&
    options.lastMove === undefined &&
    options.forbiddenRuleEnabled !== undefined &&
    options.vcfEnabled === undefined &&
    options.vcfTimeBudgetMs === undefined &&
    options.vcfNodeLimit === undefined &&
    options.qsearchEnabled === undefined &&
    options.qsearchMaxPly === undefined &&
    options.qsearchNodeLimitPerLeaf === undefined &&
    options.qsearchTotalNodeLimit === undefined &&
    options.qsearchTimeBudgetMs === undefined;

  const maxDepth = explicitDepth
    ? (options!.depth as number)
    : AI_CONFIG.MINIMAX_DEPTH;

  const timeLimitMs = explicitTime
    ? (options!.timeLimitMs as number)
    : (!explicitDepth &&
      (options === undefined || onlyLastMove || onlyForbiddenRule)
        ? AI_CONFIG.DEFAULT_TIME_LIMIT_MS
        : undefined);

  const lastMove = options?.lastMove ?? null;
  const aiLevel = options?.aiLevel ?? null;

  return {
    maxDepth,
    timeLimitMs,
    lastMove,
    aiLevel,
  };
};

// ============================================================
// 統計確定補助
// ============================================================

/**
 * 統計のマージ・確定・ログ出力を共通化する。
 *
 * 注意:
 * - elapsedMs の設定は呼び出し側で行う。
 * - TT 統計は fixed / iterative のみでマージする。
 * - center / VCF は tt = null を渡す。
 */
const finalizeSearchStatsAndLog = (
  stats: SearchStats,
  tt: TranspositionTable | null
): void => {
  if (tt) {
    mergeTTStats(stats, tt.stats);
  }
  finalizeSearchStats(stats);
  logSearchSummary(stats);
};

/**
 * fixed / iterative 探索終了時の session 記録と勝利確定を共通化する。
 *
 * 呼び出し順は既存と同一にする。
 * 1. recordMoveToSession
 * 2. isWinningMove
 * 3. finalizeGameSession('Win')
 */
const recordNormalMoveSessionAndFinalizeWin = (
  board: BoardState,
  move: Position | null,
  player: Player,
  stats: SearchStats,
  stonesBefore: number
): void => {
  const movePlayed = move !== null;
  recordMoveToSession(
    stats,
    stonesBefore + (movePlayed ? 1 : 0),
    movePlayed
  );
  if (move && isWinningMove(board, move, player)) {
    finalizeGameSession('Win');
  }
};

// ============================================================
// 1手単位共有コントローラ / キャッシュ
// ============================================================

/**
 * 1回の calculateNextMove 全体で共有する Static Eval Cache を生成する。
 */
const createPerMoveStaticEvalCache = (
  forbiddenMoves: boolean[][],
  aiPlayer: Player
): StaticEvalCache | null => {
  if (!SEARCH_TUNING_FEATURES.ENABLE_STATIC_EVAL_CACHE) return null;
  return createStaticEvalCache({
    aiPlayer,
    forbiddenMoves,
    candidateSetEnabled: AI_FEATURES.ENABLE_INCREMENTAL_CANDIDATES,
  });
};

/**
 * 1回の calculateNextMove 全体で共有する DynamicForbiddenController を生成する。
 */
const createPerMoveDynamicForbidden = (
  options?: SearchOptions
): DynamicForbiddenController =>
  createDynamicForbiddenController({
    forbiddenRuleEnabled: options?.forbiddenRuleEnabled,
  });

// ============================================================
// root 禁手フォールバック
// ============================================================

/**
 * root 最終着手が動的禁手に抵触するか簡易再検証する。
 *
 * 本来は候補手生成段階で除外されるが、
 * UI 静的禁手との不一致や将来拡張に備えて安全側で入れる。
 */
const isRootMoveDynamicallyForbidden = (
  board: BoardState,
  move: Position,
  player: Player,
  dynamicForbidden: DynamicForbiddenController
): boolean => {
  if (player !== 'Black') return false;
  if (!dynamicForbidden.ruleEnabled) return false;
  if (
    !THREAT_FORBIDDEN_FEATURES.ENABLE_DYNAMIC_FORBIDDEN ||
    !THREAT_FORBIDDEN_FEATURES.ENABLE_DYNAMIC_FORBIDDEN_ROOT
  ) {
    return false;
  }
  return checkForbiddenMove(board, move, player).isForbidden;
};

/**
 * root 最終着手が禁手だった場合の安全フォールバック。
 *
 * 通常は発火しないことを想定する。
 * 発火した場合は統計 rootMoveRejectedByForbidden を増やし、
 * 静的禁手でも動的禁手でもない空マスから単純に選ぶ。
 */
const findLegalFallbackMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  player: Player,
  dynamicForbidden: DynamicForbiddenController
): Position | null => {
  const isLegal = (row: number, col: number): boolean => {
    if (board[row][col] !== null) return false;
    if (forbiddenMoves[row][col]) return false;
    if (
      player === 'Black' &&
      dynamicForbidden.ruleEnabled &&
      THREAT_FORBIDDEN_FEATURES.ENABLE_DYNAMIC_FORBIDDEN &&
      THREAT_FORBIDDEN_FEATURES.ENABLE_DYNAMIC_FORBIDDEN_ROOT
    ) {
      if (checkForbiddenMove(board, { row, col }, player).isForbidden) {
        return false;
      }
    }
    return true;
  };

  // 1st pass: 石の近くを優先。
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (!isLegal(r, c)) continue;
      if (!hasStoneNearby(board, r, c)) continue;
      return { row: r, col: c };
    }
  }

  // 2nd pass: 任意の空マス。
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (!isLegal(r, c)) continue;
      return { row: r, col: c };
    }
  }

  return null;
};

/**
 * root 最終着手の動的禁手再検証と fallback を共通化する。
 *
 * fixed / iterative で同一の処理順を維持する。
 * 1. 最終着手が動的禁手か確認
 * 2. 禁手なら stats.forbidden.rootMoveRejectedByForbidden++
 * 3. fallback move を選択
 * 4. score を null へ落とす
 */
const resolveRootForbiddenFallback = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  player: Player,
  dynamicForbidden: DynamicForbiddenController,
  stats: SearchStats,
  candidateMove: Position | null,
  candidateScore: number | null
): { move: Position | null; score: number | null } => {
  let move = candidateMove;
  let score: number | null = move ? candidateScore : null;

  if (
    move &&
    isRootMoveDynamicallyForbidden(
      board,
      move,
      player,
      dynamicForbidden
    )
  ) {
    stats.forbidden.rootMoveRejectedByForbidden++;
    move = findLegalFallbackMove(
      board,
      forbiddenMoves,
      player,
      dynamicForbidden
    );
    score = null;
  }

  return { move, score };
};

// ============================================================
// Root VCF 補助
// ============================================================

/**
 * Root VCF を実行し、勝ち証明があれば安全検証の上で着手を返す。
 *
 * 返り値が null の場合は通常探索へ委譲する。
 */
const tryRootVcfMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  currentTurn: Player,
  dynamicForbidden: DynamicForbiddenController,
  options: SearchOptions | undefined,
  maxDepth: number,
  timeLimitMs: number | null,
  stonesBefore: number,
  stats: SearchStats
): Position | null => {
  const result = runRootVcf(
    {
      board,
      forbiddenMoves,
      mover: currentTurn,
      ruleEnabled: dynamicForbidden.ruleEnabled,
      maxDepth,
      timeLimitMs,
      stones: stonesBefore,
      options,
    },
    stats
  );

  if (
    result.outcome !== 'WIN' ||
    !VCF_FEATURES.ENABLE_VCF_RETURN_ON_WIN ||
    !result.move
  ) {
    return null;
  }

  const move = result.move;
  const { row, col } = move;

  // 最終安全検証。
  // VCF 内部でも合法性は確認しているが、root では二重防御を行う。
  if (board[row][col] !== null || forbiddenMoves[row][col]) {
    stats.vcf.rootRejectedByForbidden++;
    return null;
  }
  if (
    currentTurn === 'Black' &&
    dynamicForbidden.ruleEnabled &&
    checkForbiddenMove(board, move, currentTurn).isForbidden
  ) {
    stats.vcf.rootRejectedByForbidden++;
    return null;
  }

  return move;
};

/**
 * VCF 早期 return 時の統計確定・セッション記録・勝利確定を行う。
 *
 * VCF は fixed / iterative と以下が異なるため、専用パスを維持する。
 * - TT 統計をマージしない
 * - stats.vcf.rootUsedAsFinalMove を加算する
 * - stats.nodes.immediateWin を事前に加算する
 * - recordMoveToSession(stats, stonesBefore + 1, true) を使う
 */
const finalizeVcfReturn = (
  board: BoardState,
  move: Position,
  player: Player,
  stats: SearchStats,
  startTime: number,
  stonesBefore: number
): Position => {
  stats.selectedMove = move;
  stats.selectedScore = AI_SCORES.WIN;
  stats.completedDepth = 0;
  stats.time.elapsedMs = performance.now() - startTime;
  stats.vcf.rootUsedAsFinalMove++;

  const immediateWin = isWinningMove(board, move, player);
  if (immediateWin) {
    stats.nodes.immediateWin++;
  }

  finalizeSearchStatsAndLog(stats, null);
  recordMoveToSession(stats, stonesBefore + 1, true);

  if (immediateWin) {
    finalizeGameSession('Win');
  }

  return move;
};

// ============================================================
// calculateNextMove 内部分岐
// ============================================================

interface CenterOpeningParams {
  currentTurn: Player;
  dynamicForbidden: DynamicForbiddenController;
  startTime: number;
  aiLevel: AiLevel | null;
}

/**
 * 初手中央を処理する。
 */
const handleCenterOpening = ({
  currentTurn,
  dynamicForbidden,
  startTime,
  aiLevel,
}: CenterOpeningParams): Position => {
  const center = Math.floor(BOARD_SIZE / 2);
  const centerMove: Position = { row: center, col: center };

  const stats = createSearchStats(currentTurn, 'center', 0, null, null, aiLevel);
  stats.forbidden.forbiddenRuleEnabled = dynamicForbidden.ruleEnabled;
  stats.selectedMove = centerMove;
  stats.selectedScore = 0;
  stats.completedDepth = 0;
  stats.time.elapsedMs = performance.now() - startTime;

  finalizeSearchStatsAndLog(stats, null);
  recordMoveToSession(stats, 1, true);

  return centerMove;
};

interface FixedDepthSearchRequest {
  board: BoardState;
  forbiddenMoves: boolean[][];
  currentTurn: Player;
  options: SearchOptions | undefined;
  startTime: number;
  stonesBefore: number;
  dynamicForbidden: DynamicForbiddenController;
  maxDepth: number;
  lastMove: Position | null;
  aiLevel: AiLevel | null;
}

/**
 * timeLimitMs 未指定時の固定深度探索を処理する。
 */
const runFixedDepthSearch = ({
  board,
  forbiddenMoves,
  currentTurn,
  options,
  startTime,
  stonesBefore,
  dynamicForbidden,
  maxDepth,
  lastMove,
  aiLevel,
}: FixedDepthSearchRequest): Position | null => {
  const stats = createSearchStats(
    currentTurn,
    'fixed',
    maxDepth,
    null,
    lastMove,
    aiLevel
  );
  stats.forbidden.forbiddenRuleEnabled = dynamicForbidden.ruleEnabled;

  // Root VCF
  const vcfMove = tryRootVcfMove(
    board,
    forbiddenMoves,
    currentTurn,
    dynamicForbidden,
    options,
    maxDepth,
    null,
    stonesBefore,
    stats
  );
  if (vcfMove) {
    return finalizeVcfReturn(
      board,
      vcfMove,
      currentTurn,
      stats,
      startTime,
      stonesBefore
    );
  }

  // QSearchController 生成
  const qsearchController = createQSearchController(
    {
      aiPlayer: currentTurn,
      forbiddenRuleEnabled: dynamicForbidden.ruleEnabled,
      timeLimitMs: null,
      deadline: Infinity,
      maxDepth,
      stonesBefore,
      options,
    },
    stats
  );

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
    staticEvalCache,
    dynamicForbidden,
    qsearchController
  );

  const resolvedFinal = resolveRootForbiddenFallback(
    board,
    forbiddenMoves,
    currentTurn,
    dynamicForbidden,
    stats,
    result.move,
    result.score
  );

  const finalMove = resolvedFinal.move;
  const finalScore = resolvedFinal.score;

  stats.selectedMove = finalMove;
  stats.selectedScore = finalScore;
  stats.completedDepth = finalMove ? maxDepth : 0;
  stats.time.elapsedMs = performance.now() - startTime;

  finalizeSearchStatsAndLog(stats, tt);
  recordNormalMoveSessionAndFinalizeWin(
    board,
    finalMove,
    currentTurn,
    stats,
    stonesBefore
  );

  return finalMove;
};

interface IterativeDeepeningSearchRequest {
  board: BoardState;
  forbiddenMoves: boolean[][];
  currentTurn: Player;
  options: SearchOptions | undefined;
  startTime: number;
  stonesBefore: number;
  dynamicForbidden: DynamicForbiddenController;
  maxDepth: number;
  timeLimitMs: number;
  lastMove: Position | null;
  aiLevel: AiLevel | null;
}

/**
 * timeLimitMs 指定時の反復深化を処理する。
 */
const runIterativeDeepeningSearch = ({
  board,
  forbiddenMoves,
  currentTurn,
  options,
  startTime,
  stonesBefore,
  dynamicForbidden,
  maxDepth,
  timeLimitMs,
  lastMove,
  aiLevel,
}: IterativeDeepeningSearchRequest): Position | null => {
  const stats = createSearchStats(
    currentTurn,
    'iterative',
    maxDepth,
    timeLimitMs,
    lastMove,
    aiLevel
  );
  stats.forbidden.forbiddenRuleEnabled = dynamicForbidden.ruleEnabled;

  // deadline は startTime 基準とし、Root VCF の消費時間も全体時間に含める。
  const deadline = startTime + timeLimitMs;

  // Root VCF
  const vcfMove = tryRootVcfMove(
    board,
    forbiddenMoves,
    currentTurn,
    dynamicForbidden,
    options,
    maxDepth,
    timeLimitMs,
    stonesBefore,
    stats
  );
  if (vcfMove) {
    return finalizeVcfReturn(
      board,
      vcfMove,
      currentTurn,
      stats,
      startTime,
      stonesBefore
    );
  }

  // QSearchController 生成（VCF 後、反復深化ループ前）
  const qsearchController = createQSearchController(
    {
      aiPlayer: currentTurn,
      forbiddenRuleEnabled: dynamicForbidden.ruleEnabled,
      timeLimitMs,
      deadline,
      maxDepth,
      stonesBefore,
      options,
    },
    stats
  );

  const tt = new TranspositionTable();

  /**
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

  // Adaptive Time Prediction 用の状態
  const depthElapsedTimes: number[] = [];
  const ratioBuffer = new Float64Array(16);

  // Aspiration 調整用状態
  const baseAspirationWindow = SEARCH_TUNING_FEATURES.ENABLE_ASPIRATION_WINDOW_TUNING
    ? SEARCH_TUNING_CONFIG.ASPIRATION_WINDOW_OVERRIDE
    : TT_CONFIG.ASPIRATION_WINDOW;
  let adaptiveAspirationWindow = baseAspirationWindow;
  let prevAspirationFailed = false;

  for (let d = 1; d <= maxDepth; d++) {
    const iterStart = performance.now();

    // depth=1 は時間制限なしで探索し、極端に短い timeLimitMs でも AI が無反応にならない保証とする。
    const effectiveDeadline = d === 1 ? Infinity : deadline;

    let alpha = -Infinity;
    let beta = Infinity;

    const aspirationCandidate =
      AI_FEATURES.ENABLE_ASPIRATION_WINDOW &&
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
        SEARCH_TUNING_FEATURES.ENABLE_ASPIRATION_ADAPTIVE_EXPANSION &&
        prevAspirationFailed
      ) {
        window = Math.min(
          SEARCH_TUNING_CONFIG.ASPIRATION_ADAPTIVE_MAX_WINDOW,
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
      staticEvalCache,
      dynamicForbidden,
      qsearchController
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
          staticEvalCache,
          dynamicForbidden,
          qsearchController
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
          staticEvalCache,
          dynamicForbidden,
          qsearchController
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

    // Adaptive Time Prediction 用の時間記録
    if (
      SEARCH_TUNING_FEATURES.ENABLE_TIME_PREDICTION &&
      SEARCH_TUNING_FEATURES.ENABLE_ADAPTIVE_TIME_PREDICTION
    ) {
      depthElapsedTimes.push(iterElapsed);
    }

    /**
     * adaptive aspiration の簡易収縮。
     * fail しなかった場合は、広げた window を base へ戻していく。
     */
    if (
      SEARCH_TUNING_FEATURES.ENABLE_ASPIRATION_ADAPTIVE_EXPANSION &&
      useAspiration &&
      !depthAspirationFailed &&
      adaptiveAspirationWindow > baseAspirationWindow
    ) {
      adaptiveAspirationWindow = Math.max(
        baseAspirationWindow,
        Math.floor(adaptiveAspirationWindow / 2)
      );
    }

    // 次の深さに進む余地がなければここで打ち切る。
    if (performance.now() >= deadline) break;

    // 時間予測（保守的）
    if (
      SEARCH_TUNING_FEATURES.ENABLE_TIME_PREDICTION &&
      d >= SEARCH_TUNING_CONFIG.TIME_PREDICTION_MIN_DEPTH
    ) {
      const remaining = deadline - performance.now();
      let estimate: number;

      if (
        SEARCH_TUNING_FEATURES.ENABLE_ADAPTIVE_TIME_PREDICTION &&
        depthElapsedTimes.length >= SEARCH_TUNING_CONFIG.TIME_PREDICTION_RATIO_MIN_SAMPLES + 1
      ) {
        // 比率ベース推定
        let ratioCount = 0;
        for (let i = 1; i < depthElapsedTimes.length; i++) {
          let ratio = depthElapsedTimes[i] / depthElapsedTimes[i - 1];
          if (ratio < SEARCH_TUNING_CONFIG.TIME_PREDICTION_RATIO_FLOOR) {
            ratio = SEARCH_TUNING_CONFIG.TIME_PREDICTION_RATIO_FLOOR;
          } else if (ratio > SEARCH_TUNING_CONFIG.TIME_PREDICTION_RATIO_CAP) {
            ratio = SEARCH_TUNING_CONFIG.TIME_PREDICTION_RATIO_CAP;
          }
          ratioBuffer[ratioCount++] = ratio;
        }

        // --- 直近比率の保存（ソート前に取得。トレンド追従用） ---
        const lastRatio = ratioBuffer[ratioCount - 1];
        const secondLastRatio = ratioCount >= 2
          ? ratioBuffer[ratioCount - 2]
          : lastRatio;
        const recentAvg = (lastRatio + secondLastRatio) / 2;

        // --- 挿入ソート（要素数は最大 11 程度） ---
        for (let i = 1; i < ratioCount; i++) {
          const key = ratioBuffer[i];
          let j = i - 1;
          while (j >= 0 && ratioBuffer[j] > key) {
            ratioBuffer[j + 1] = ratioBuffer[j];
            j--;
          }
          ratioBuffer[j + 1] = key;
        }

        // --- パーセンタイルベースの代表値 ---
        const percentile = SEARCH_TUNING_CONFIG.TIME_PREDICTION_PERCENTILE;
        const idx = Math.min(
          Math.floor(ratioCount * percentile),
          ratioCount - 1
        );
        const percentileRatio = ratioBuffer[idx];

        // --- 直近比率とパーセンタイルのうち保守的な方を採用 ---
        const effectiveRatio = Math.max(percentileRatio, recentAvg);

        estimate =
          depthElapsedTimes[depthElapsedTimes.length - 1] * effectiveRatio +
          SEARCH_TUNING_CONFIG.TIME_PREDICTION_FIXED_MARGIN_MS;

        stats.time.adaptivePredictionUsed = true;
        stats.time.adaptiveEstimateMs = estimate;
        stats.time.adaptiveRatioSamples = ratioCount;
        stats.time.adaptiveMedianRatio = effectiveRatio;
      } else {
        // 現行方式: 固定倍率
        estimate = iterElapsed * SEARCH_TUNING_CONFIG.TIME_PREDICTION_SAFETY;
      }

      if (remaining < estimate) {
        stats.time.predictedSkips++;
        stats.time.remainingAtSkipMs = remaining;
        break;
      }
    }

    prevAspirationFailed = depthAspirationFailed && useAspiration;
  }

  const resolvedFinal = resolveRootForbiddenFallback(
    board,
    forbiddenMoves,
    currentTurn,
    dynamicForbidden,
    stats,
    best,
    prevScore
  );

  const finalBest = resolvedFinal.move;
  const finalScore = resolvedFinal.score;

  stats.selectedMove = finalBest;
  stats.selectedScore = finalScore;
  stats.completedDepth = completedDepth;
  stats.time.elapsedMs = performance.now() - startTime;

  finalizeSearchStatsAndLog(stats, tt);
  recordNormalMoveSessionAndFinalizeWin(
    board,
    finalBest,
    currentTurn,
    stats,
    stonesBefore
  );

  return finalBest;
};

// ============================================================
// 公開 API
// ============================================================

/**
 * AI の次の一手を計算して返す。
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
  const stonesBefore = countStones(board);

  const { maxDepth, timeLimitMs, lastMove, aiLevel } = resolveSearchParameters(options);

  startGameSessionForMove(currentTurn, stonesBefore, aiLevel);
  const dynamicForbidden = createPerMoveDynamicForbidden(options);

  // 初手は中央
  if (stonesBefore === 0) {
    return handleCenterOpening({
      currentTurn,
      dynamicForbidden,
      startTime,
      aiLevel,
    });
  }

  // timeLimitMs 未指定: 従来通りの固定深さ探索
  if (timeLimitMs === undefined) {
    return runFixedDepthSearch({
      board,
      forbiddenMoves,
      currentTurn,
      options,
      startTime,
      stonesBefore,
      dynamicForbidden,
      maxDepth,
      lastMove,
      aiLevel,
    });
  }

  // timeLimitMs 指定: 反復深化
  return runIterativeDeepeningSearch({
    board,
    forbiddenMoves,
    currentTurn,
    options,
    startTime,
    stonesBefore,
    dynamicForbidden,
    maxDepth,
    timeLimitMs,
    lastMove,
    aiLevel,
  });
};