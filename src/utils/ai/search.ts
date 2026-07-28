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
//
// 第6.2弾:
//   - DynamicForbiddenController を calculateNextMove 単位で生成し、全 findBestMove で共有
//   - root 最終着手の禁手再検証と安全フォールバックを追加
//
// 第7.1弾:
//   - Root VCF を通常探索前に実行
//   - VCF で勝ち証明できた場合のみ早期 return
//   - VCF 最終手の安全検証を追加
//
// 第8.1弾:
//   - QSearchController を calculateNextMove 単位で生成し、全 findBestMove で共有
//
// v2.0.0 禁手整合性修正:
//   - options.forbiddenRuleEnabled のみが渡された場合もデフォルト時間制御を維持する。
import type { BoardState, Position, Player } from '../../types/game';
import type { SearchOptions, SearchStats } from '../../types/ai';
import { BOARD_SIZE, checkWin, checkForbiddenMove } from '../gameLogic';
import {
  AI_CONFIG,
  AI_SCORES,
  TT_CONFIG,
  AI_FEATURES,
  PHASE5_FEATURES,
  PHASE5_CONFIG,
  PHASE6_FEATURES,
  PHASE7_FEATURES,
} from './constants';
import { findBestMove } from './minimax';
import { TranspositionTable } from './transpositionTable';
import {
  resetPatternCacheStats,
  getPatternCacheStats,
  resetCenterPatternCacheStats,
  getCenterPatternCacheStats,
  hasStoneNearby,
} from './evaluator';
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
import { runRootVcf } from './vcfSolver';
import { createQSearchController } from './quiescence';

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
 * 第6.2弾:
 * 1回の calculateNextMove 全体で共有する DynamicForbiddenController を生成する。
 */
const createPerMoveDynamicForbidden = (
  options?: SearchOptions
): DynamicForbiddenController =>
  createDynamicForbiddenController({
    forbiddenRuleEnabled: options?.forbiddenRuleEnabled,
  });

/**
 * 第6.2弾:
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
    !PHASE6_FEATURES.ENABLE_DYNAMIC_FORBIDDEN ||
    !PHASE6_FEATURES.ENABLE_DYNAMIC_FORBIDDEN_ROOT
  ) {
    return false;
  }
  return checkForbiddenMove(board, move, player).isForbidden;
};

/**
 * 第6.2弾:
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
      PHASE6_FEATURES.ENABLE_DYNAMIC_FORBIDDEN &&
      PHASE6_FEATURES.ENABLE_DYNAMIC_FORBIDDEN_ROOT
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
 * 第7.1弾:
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
    !PHASE7_FEATURES.ENABLE_VCF_RETURN_ON_WIN ||
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
 * 第7.1弾:
 * VCF 早期 return 時の統計確定・セッション記録・勝利確定を行う。
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

  mergePatternCacheStats(stats, getPatternCacheStats());
  mergeCenterPatternCacheStats(stats, getCenterPatternCacheStats());
  finalizeSearchStats(stats);
  logSearchSummary(stats);
  recordMoveToSession(stats, stonesBefore + 1, true);

  if (immediateWin) {
    finalizeGameSession('Win');
  }

  return move;
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

  const dynamicForbidden = createPerMoveDynamicForbidden(options);

  const isBoardEmpty = stonesBefore === 0;

  // 初手は中央
  if (isBoardEmpty) {
    const center = Math.floor(BOARD_SIZE / 2);
    const centerMove: Position = { row: center, col: center };

    const stats = createSearchStats(currentTurn, 'center', 0, null, null);
    stats.forbidden.forbiddenRuleEnabled = dynamicForbidden.ruleEnabled;
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
    : (!explicitDepth && (options === undefined || onlyLastMove || onlyForbiddenRule)
      ? AI_CONFIG.DEFAULT_TIME_LIMIT_MS
      : undefined);

  const lastMove = options?.lastMove ?? null;

  // --- timeLimitMs 未指定: 従来通りの固定深さ探索 ---
  if (timeLimitMs === undefined) {
    const stats = createSearchStats(currentTurn, 'fixed', maxDepth, null, lastMove);
    stats.forbidden.forbiddenRuleEnabled = dynamicForbidden.ruleEnabled;

    // 第7.1弾: Root VCF
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

    // 第8.1弾: QSearchController 生成
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

    let finalMove = result.move;
    let finalScore: number | null = result.move ? result.score : null;

    if (
      finalMove &&
      isRootMoveDynamicallyForbidden(
        board,
        finalMove,
        currentTurn,
        dynamicForbidden
      )
    ) {
      stats.forbidden.rootMoveRejectedByForbidden++;
      finalMove = findLegalFallbackMove(
        board,
        forbiddenMoves,
        currentTurn,
        dynamicForbidden
      );
      finalScore = null;
    }

    stats.selectedMove = finalMove;
    stats.selectedScore = finalScore;
    stats.completedDepth = finalMove ? maxDepth : 0;
    stats.time.elapsedMs = performance.now() - startTime;

    mergeTTStats(stats, tt.stats);
    mergePatternCacheStats(stats, getPatternCacheStats());
    mergeCenterPatternCacheStats(stats, getCenterPatternCacheStats());
    finalizeSearchStats(stats);
    logSearchSummary(stats);

    const movePlayed = finalMove !== null;
    recordMoveToSession(
      stats,
      stonesBefore + (movePlayed ? 1 : 0),
      movePlayed
    );

    if (finalMove && isWinningMove(board, finalMove, currentTurn)) {
      finalizeGameSession('Win');
    }

    return finalMove;
  }

  // --- timeLimitMs 指定: 反復深化（iterative deepening） ---
  const stats = createSearchStats(
    currentTurn,
    'iterative',
    maxDepth,
    timeLimitMs,
    lastMove
  );
  stats.forbidden.forbiddenRuleEnabled = dynamicForbidden.ruleEnabled;

  // 第7.1弾:
  // deadline は startTime 基準とし、Root VCF の消費時間も全体時間に含める。
  const deadline = startTime + timeLimitMs;

  // 第7.1弾: Root VCF
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

  // 第8.1弾: QSearchController 生成（VCF 後、反復深化ループ前）
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

  let finalBest = best;
  let finalScore: number | null = best ? prevScore : null;

  if (
    finalBest &&
    isRootMoveDynamicallyForbidden(
      board,
      finalBest,
      currentTurn,
      dynamicForbidden
    )
  ) {
    stats.forbidden.rootMoveRejectedByForbidden++;
    finalBest = findLegalFallbackMove(
      board,
      forbiddenMoves,
      currentTurn,
      dynamicForbidden
    );
    finalScore = null;
  }

  stats.selectedMove = finalBest;
  stats.selectedScore = finalScore;
  stats.completedDepth = completedDepth;
  stats.time.elapsedMs = performance.now() - startTime;

  mergeTTStats(stats, tt.stats);
  mergePatternCacheStats(stats, getPatternCacheStats());
  mergeCenterPatternCacheStats(stats, getCenterPatternCacheStats());
  finalizeSearchStats(stats);
  logSearchSummary(stats);

  const movePlayed = finalBest !== null;
  recordMoveToSession(
    stats,
    stonesBefore + (movePlayed ? 1 : 0),
    movePlayed
  );

  if (finalBest && isWinningMove(board, finalBest, currentTurn)) {
    finalizeGameSession('Win');
  }

  return finalBest;
};