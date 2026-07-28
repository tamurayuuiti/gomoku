// src/utils/ai/minimax.ts
// ミニマックス探索エンジン
//
// SearchContext による探索状態の一元管理、αβ 枝刈り付きミニマックス再帰、
// Transposition Table 連携、公開 API（findBestMove）を担う。
// 候補手生成 → candidateGenerator.ts、葉ノード盤面評価 → boardEvaluator.ts に委譲する。
//
// 第2弾:
//   - Countermove Heuristic
//   - Late Move Reduction（LMR）
//   - PVS / NegaScout
//
// 第3弾:
//   - LineCache 差分ラインキャッシュ
//   - CandidateSet 候補集合増分管理
//   - evaluateBoardWithCache / evaluatePositionWithCache への接続
//
// 第4弾:
//   - SearchContext に統計情報を保持し、探索挙動を変えずに計測する。
//
// 第5弾:
//   - Static Eval Cache 接続
//   - checkWin / 葉評価の診断計測
//   - PVS null-window 抑制モード
//   - ルート PVS 条件付き実験
//
// 第5.5.1弾:
//   - Static Eval Cache を外部から注入可能にし、思考単位で共有できるようにする。
//
// 第6.2弾:
//   - apply / undo を searchState.ts へ共通化する。
//   - DynamicForbiddenController を注入可能にする。
//   - 候補手生成へ currentHash と dynamicForbidden を渡す。
//
// 第8.1弾:
//   - 葉ノードで戦術 Quiescence を呼び出す。
//   - QSearchController を注入可能にする。
import type { BoardState, Position, Player } from '../../types/game';
import type {
  KillerTable,
  HistoryTable,
  TTFlag,
  CountermoveTable,
  OrderedCandidate,
  LineCacheState,
  CandidateSetState,
  SearchStats,
} from '../../types/ai';
import { checkWin } from '../gameLogic';
import {
  AI_CONFIG,
  AI_SCORES,
  AI_FEATURES,
  LMR_CONFIG,
  PVS_CONFIG,
  SEARCH_TUNING_FEATURES,
  SEARCH_TUNING_CONFIG,
} from './constants';
import { TIMING_DIAGNOSTICS_CONFIG } from './diagnosticsFlags';
import { opponentOf } from './evaluator';
import { evaluateBoard, evaluateBoardWithCache } from './boardEvaluator';
import {
  CRITICAL_SCORE_THRESHOLD,
  createKillerTable,
  createHistoryTable,
  createCountermoveTable,
  createCandidateSet,
  storeKiller,
  storeHistory,
  storeCountermove,
  generateOrderedCandidates,
} from './candidateGenerator';
import { TranspositionTable } from './transpositionTable';
import { calculateInitialHash } from './zobrist';
import { createLineCache } from './lineCache';
import {
  createSearchStats,
  shouldLogVerboseSearch,
  recordCandidateSetSize,
} from './searchStats';
import {
  createStaticEvalCache,
  type StaticEvalCache,
} from './staticEvalCache';
import {
  applySearchMove,
  undoSearchMove,
} from './searchState';
import type { DynamicForbiddenController } from './dynamicForbidden';
import {
  runQuiescenceAtLeaf,
  type QSearchController,
} from './quiescence';

// ============================================================
// SearchContext
// ============================================================

/**
 * 探索コンテキスト。探索木全体を通じて共有される状態をまとめる。
 */
interface SearchContext {
  /**
   * 探索対象盤面。
   * minimax / findBestMove に渡される board と同一参照を保持する。
   *
   * 第6.2弾で searchState.ts の applySearchMove / undoSearchMove が
   * SearchStateContainers を受け取る設計になったため、
   * SearchContext 側も board を保持して構造的に互換にする。
   */
  board: BoardState;
  aiPlayer: Player;
  forbiddenMoves: boolean[][];
  killerTable: KillerTable;
  historyTable: HistoryTable;
  countermoveTable: CountermoveTable;
  lineCache: LineCacheState | null;
  candidateSet: CandidateSetState | null;
  staticEvalCache: StaticEvalCache | null;
  deadline: number;
  tt: TranspositionTable;
  aborted: boolean;
  stats: SearchStats;
  dynamicForbidden: DynamicForbiddenController | null;
  /** 第8.1弾: 戦術 Quiescence コントローラ */
  qsearchController: QSearchController | null;
}

const createSearchContext = (
  board: BoardState,
  aiPlayer: Player,
  forbiddenMoves: boolean[][],
  deadline: number = Infinity,
  tt: TranspositionTable,
  stats: SearchStats,
  sharedStaticEvalCache?: StaticEvalCache | null,
  dynamicForbidden: DynamicForbiddenController | null = null,
  qsearchController: QSearchController | null = null
): SearchContext => {
  const lineCache = AI_FEATURES.ENABLE_LINE_CACHE
    ? createLineCache(board)
    : null;
  const candidateSet = AI_FEATURES.ENABLE_INCREMENTAL_CANDIDATES
    ? createCandidateSet(board, forbiddenMoves)
    : null;
  /**
   * 第5.5.1弾:
   * 外部から sharedStaticEvalCache が渡された場合はそれを優先する。
   * undefined の場合のみ、後方互換のため内部で新規生成する。
   * null が渡された場合は、明示的に cache なしとして扱う。
   */
  const staticEvalCache =
    sharedStaticEvalCache !== undefined
      ? sharedStaticEvalCache
      : SEARCH_TUNING_FEATURES.ENABLE_STATIC_EVAL_CACHE
        ? createStaticEvalCache(
            {
              limit: SEARCH_TUNING_CONFIG.STATIC_EVAL_CACHE_LIMIT,
              evictionRatio: SEARCH_TUNING_CONFIG.STATIC_EVAL_CACHE_EVICTION_RATIO,
            },
            {
              aiPlayer,
              forbiddenMoves,
              candidateSetEnabled: candidateSet !== null,
            }
          )
        : null;

  const ctx: SearchContext = {
    board,
    aiPlayer,
    forbiddenMoves,
    killerTable: createKillerTable(),
    historyTable: createHistoryTable(),
    countermoveTable: createCountermoveTable(),
    lineCache,
    candidateSet,
    staticEvalCache,
    deadline,
    tt,
    aborted: false,
    stats,
    dynamicForbidden,
    qsearchController,
  };

  if (ctx.candidateSet) {
    ctx.stats.candidateSet.used = true;
    recordCandidateSetSize(ctx.stats, ctx.candidateSet.candidates.size);
  }

  return ctx;
};

/**
 * 時間切れ判定。
 * 一度でも時間切れを検知したら ctx.aborted = true を設定し、
 * 以降の探索結果が TT に保存されないようにする。
 */
const isTimeUp = (ctx: SearchContext): boolean => {
  if (ctx.aborted) {
    ctx.stats.time.aborted = true;
    return true;
  }
  if (ctx.deadline !== Infinity && performance.now() >= ctx.deadline) {
    ctx.aborted = true;
    ctx.stats.time.aborted = true;
    return true;
  }
  return false;
};

// ============================================================
// 第5弾：診断・キャッシュ用ヘルパー
// ============================================================

/**
 * Static Eval Cache の内部統計を SearchStats へ同期する。
 */
const syncStaticEvalCacheStats = (ctx: SearchContext): void => {
  const cache = ctx.staticEvalCache;
  if (!cache) return;
  const st = cache.stats;
  const target = ctx.stats.staticEvalCache;
  target.lookups = st.lookups;
  target.hits = st.hits;
  target.misses = st.misses;
  target.stores = st.stores;
  target.evictions = st.evictions;
  target.size = st.size;
  target.maxSize = st.maxSize;
  target.hitRate = target.lookups > 0 ? target.hits / target.lookups : 0;
};

/**
 * checkWin を計測付きで呼び出す。
 * 判定ロジック自体は変更しない。
 */
const checkWinInstrumented = (
  board: BoardState,
  move: Position,
  player: Player,
  ctx: SearchContext
): boolean => {
  ctx.stats.diagnostics.checkWinCalls++;
  if (!TIMING_DIAGNOSTICS_CONFIG.ENABLE_CHECKWIN_TIMING) {
    return checkWin(board, move, player);
  }
  const start = performance.now();
  const result = checkWin(board, move, player);
  ctx.stats.diagnostics.checkWinTimeMs += performance.now() - start;
  return result;
};

// ============================================================
// 葉ノード評価
// ============================================================

/**
 * 葉ノード評価。LineCache があれば cache 版を使う。
 *
 * 第5弾:
 *   Static Eval Cache を参照し、miss 時のみ実際の葉評価を行う。
 *
 * 第8.1弾:
 *   Static Eval Cache より前に Quiescence を試行する。
 *   Quiescence が proof スコアを返した場合はそれを採用し、静的評価は行わない。
 */
const evaluateLeaf = (
  board: BoardState,
  ctx: SearchContext,
  currentHash: bigint,
  currentPlayer: Player
): number => {
  // 第8.1弾: Quiescence を先に試行
  if (ctx.qsearchController) {
    const qResult = runQuiescenceAtLeaf({
      board,
      lineCache: ctx.lineCache,
      forbiddenMoves: ctx.forbiddenMoves,
      side: currentPlayer,
      hash: currentHash,
      controller: ctx.qsearchController,
      stats: ctx.stats,
    });
    if (qResult.score !== null) {
      return qResult.score;
    }
  }

  if (ctx.staticEvalCache) {
    const cached = ctx.staticEvalCache.lookup(currentHash);
    syncStaticEvalCacheStats(ctx);
    if (cached !== undefined) {
      return cached;
    }
  }

  ctx.stats.diagnostics.leafEvalCalls++;
  const shouldTimeLeaf = TIMING_DIAGNOSTICS_CONFIG.ENABLE_LEAF_TIMING;
  const start = shouldTimeLeaf ? performance.now() : 0;

  let score: number;
  if (ctx.lineCache) {
    ctx.stats.cache.lineCacheEvalCalls++;
    score = evaluateBoardWithCache(
      board,
      ctx.lineCache,
      ctx.aiPlayer,
      ctx.forbiddenMoves,
      ctx.candidateSet
    );
  } else {
    ctx.stats.cache.lineCacheFallbackCalls++;
    score = evaluateBoard(board, ctx.aiPlayer, ctx.forbiddenMoves);
  }

  if (shouldTimeLeaf) {
    ctx.stats.diagnostics.leafEvalTimeMs += performance.now() - start;
  }

  if (ctx.staticEvalCache && !ctx.aborted) {
    ctx.staticEvalCache.store(currentHash, score);
    syncStaticEvalCacheStats(ctx);
  }

  return score;
};

// ============================================================
// LMR
// ============================================================

/**
 * LMR の削減量を返す。
 *
 * 保守性を重視し、以下には適用しない。
 * - ルートノード（ALLOW_ROOT = false の場合）
 * - 浅い深度
 * - 序盤の move index
 * - TT Move / Killer / Countermove
 * - CRITICAL / 戦術手
 *
 * 第4弾：stats を任意で受け取り、LMR 判定回数を計測する。
 * ただし、実際の reduced 回数は呼び出し側で canNull 判定後に計測する。
 */
const getReduction = (
  depth: number,
  moveIndex: number,
  flags: OrderedCandidate['flags'],
  isRoot: boolean,
  stats?: SearchStats
): number => {
  if (!AI_FEATURES.ENABLE_LMR) return 0;
  if (isRoot && !LMR_CONFIG.ALLOW_ROOT) return 0;
  if (depth < LMR_CONFIG.MIN_DEPTH) return 0;
  if (moveIndex < LMR_CONFIG.MIN_MOVE_INDEX) return 0;

  if (stats) {
    stats.lmr.attempted++;
  }

  if (!flags.reductionAllowed) {
    if (stats) {
      if (flags.isTTMove) {
        stats.lmr.skippedTTMove++;
      } else if (flags.isKiller) {
        stats.lmr.skippedKiller++;
      } else if (flags.isCountermove) {
        stats.lmr.skippedCountermove++;
      } else if (flags.isTactical || flags.isCritical) {
        stats.lmr.skippedTactical++;
      }
    }
    return 0;
  }

  if (
    flags.isTTMove ||
    flags.isKiller ||
    flags.isCountermove ||
    flags.isCritical ||
    flags.isTactical
  ) {
    return 0;
  }

  let reduction = 1;
  if (
    depth >= LMR_CONFIG.DEEP_REDUCTION_DEPTH &&
    moveIndex >= LMR_CONFIG.DEEP_REDUCTION_MOVE_INDEX
  ) {
    reduction = 2;
  }

  const maxPossibleReduction = Math.max(0, depth - 1);
  return Math.min(
    reduction,
    LMR_CONFIG.MAX_REDUCTION,
    maxPossibleReduction
  );
};

// ============================================================
// 第5弾：PVS null-window 判定ヘルパー
// ============================================================

/**
 * 内部ノードの PVS null-window 可否を返す。
 *
 * 第5弾:
 *   ENABLE_PVS_NULL_MODE 有効時は、quiet_only / off モードで抑制する。
 *   baseline モードでは第4弾と同一挙動。
 */
const resolveInternalPvsNull = (
  ctx: SearchContext,
  moveIndex: number,
  canNull: boolean,
  isRoot: boolean,
  flags: OrderedCandidate['flags']
): boolean => {
  const baselinePvsNull =
    AI_FEATURES.ENABLE_PVS &&
    moveIndex > 0 &&
    canNull &&
    !(isRoot && !PVS_CONFIG.ENABLE_ROOT_PVS);

  if (!baselinePvsNull) return false;

  if (!SEARCH_TUNING_FEATURES.ENABLE_PVS_NULL_MODE_POLICY) {
    return true;
  }

  if (SEARCH_TUNING_CONFIG.PVS_NULL_MODE === 'off') {
    ctx.stats.pvs.tacticalNullSkips++;
    return false;
  }

  if (
    SEARCH_TUNING_CONFIG.PVS_NULL_MODE === 'quiet_only' &&
    !flags.reductionAllowed
  ) {
    ctx.stats.pvs.tacticalNullSkips++;
    return false;
  }

  return true;
};

// ============================================================
// ミニマックス探索本体
// ============================================================

/**
 * αβ 枝刈り付きミニマックス探索（TT / PVS / LMR / Countermove / LineCache 対応版）。
 */
const minimax = (
  board: BoardState,
  depth: number,
  isMaximizing: boolean,
  currentPlayer: Player,
  ctx: SearchContext,
  alpha: number,
  beta: number,
  currentHash: bigint,
  lastMove: Position | null,
  isRoot: boolean = false
): number => {
  // 既に探索が中断されている場合、このノードの結果は信頼できない。
  if (ctx.aborted) {
    return 0;
  }

  // --- 葉ノード評価 ---
  if (depth === 0) {
    ctx.stats.nodes.total++;
    ctx.stats.nodes.leaf++;
    return evaluateLeaf(board, ctx, currentHash, currentPlayer);
  }

  // --- Transposition Table Lookup ---
  const alphaOrig = alpha;
  const betaOrig = beta;
  const ttScore = ctx.tt.lookup(currentHash, depth, alpha, beta);
  if (ttScore !== null) {
    ctx.stats.nodes.total++;
    ctx.stats.nodes.internal++;
    ctx.stats.nodes.ttCutoff++;
    return ttScore;
  }

  // --- TT Best Move の取得（Move Ordering 用） ---
  const ttBestMove = ctx.tt.getBestMove(currentHash);

  // --- 候補手生成 ---
  const candidates = generateOrderedCandidates(
    board,
    currentPlayer,
    ctx.forbiddenMoves,
    ctx.killerTable,
    ctx.historyTable,
    ctx.countermoveTable,
    depth,
    lastMove,
    ttBestMove,
    isRoot,
    ctx.lineCache,
    ctx.candidateSet,
    ctx.stats,
    currentHash,
    ctx.dynamicForbidden
  );

  // 候補なし（盤面満杯等）→ 葉ノード評価にフォールバック
  if (candidates.length === 0) {
    ctx.stats.nodes.total++;
    ctx.stats.nodes.leaf++;
    return evaluateLeaf(board, ctx, currentHash, currentPlayer);
  }

  ctx.stats.nodes.total++;
  ctx.stats.nodes.internal++;

  let bestMove: Position | null = null;

  if (isMaximizing) {
    let maxScore = -Infinity;
    let ttStoreDepth = depth;

    for (let moveIndex = 0; moveIndex < candidates.length; moveIndex++) {
      if (isTimeUp(ctx)) break;

      const { pos, score: moveScore, flags } = candidates[moveIndex];
      const { row, col } = pos;
      const currentMove: Position = { row, col };

      const { undo: moveUndo, nextHash } = applySearchMove(
        ctx,
        currentHash,
        currentMove,
        currentPlayer
      );

      // 即時勝利検出
      if (checkWinInstrumented(board, currentMove, ctx.aiPlayer, ctx)) {
        undoSearchMove(ctx, moveUndo);
        ctx.stats.nodes.immediateWin++;
        return AI_SCORES.WIN;
      }

      let reduction = getReduction(depth, moveIndex, flags, isRoot, ctx.stats);

      // null-window 探索は alpha が有限でないと安全に使えない。
      const canNull = Number.isFinite(alpha);
      if (reduction > 0 && !canNull) {
        reduction = 0;
      }

      if (reduction > 0) {
        ctx.stats.lmr.reduced++;
        ctx.stats.lmr.reductionTotal += reduction;
      }

      const usePvsNull = resolveInternalPvsNull(
        ctx,
        moveIndex,
        canNull,
        isRoot,
        flags
      );

      let score: number;

      if (usePvsNull || reduction > 0) {
        const childDepth = Math.max(0, depth - 1 - reduction);
        const nullBeta = alpha + 1;

        if (usePvsNull) {
          ctx.stats.pvs.nullSearches++;
          if (flags.reductionAllowed) {
            ctx.stats.pvs.quietNullSearches++;
          }
        }

        // 削減 or PVS null-window 探索
        score = minimax(
          board,
          childDepth,
          false,
          opponentOf(currentPlayer),
          ctx,
          alpha,
          nullBeta,
          nextHash,
          currentMove,
          false
        );

        if (ctx.aborted) {
          undoSearchMove(ctx, moveUndo);
          return score;
        }

        // fail-high: 通常深度・通常ウィンドウで再探索
        if (score > alpha) {
          if (usePvsNull) {
            ctx.stats.pvs.failHighResearches++;
            ctx.stats.pvs.fullResearches++;
          }
          if (reduction > 0) {
            ctx.stats.lmr.researches++;
          }

          score = minimax(
            board,
            depth - 1,
            false,
            opponentOf(currentPlayer),
            ctx,
            alpha,
            beta,
            nextHash,
            currentMove,
            false
          );

          if (ctx.aborted) {
            undoSearchMove(ctx, moveUndo);
            return score;
          }
        } else if (reduction > 0) {
          // 削減探索で fail-low した結果は信用度を下げ、TT store depth を保守化する。
          ttStoreDepth = Math.min(ttStoreDepth, depth - reduction);
        }
      } else {
        // full-window 通常探索
        score = minimax(
          board,
          depth - 1,
          false,
          opponentOf(currentPlayer),
          ctx,
          alpha,
          beta,
          nextHash,
          currentMove,
          false
        );

        if (ctx.aborted) {
          undoSearchMove(ctx, moveUndo);
          return score;
        }
      }

      undoSearchMove(ctx, moveUndo);

      if (score > maxScore) {
        maxScore = score;
        bestMove = currentMove;
      }
      if (score > alpha) alpha = score;

      // β カットオフ: CRITICAL 未満の手のみ killer / history / countermove に記録
      if (beta <= alpha) {
        if (moveScore < CRITICAL_SCORE_THRESHOLD) {
          storeKiller(ctx.killerTable, depth, currentMove);
          ctx.stats.ordering.killerStores++;
          storeHistory(ctx.historyTable, currentPlayer, depth, currentMove);
          ctx.stats.ordering.historyStores++;
          if (AI_FEATURES.ENABLE_COUNTERMOVE && lastMove) {
            storeCountermove(
              ctx.countermoveTable,
              currentPlayer,
              lastMove,
              currentMove
            );
            ctx.stats.ordering.countermoveStores++;
          }
        }
        bestMove = currentMove;
        break;
      }
    }

    // 時間切れで中断した結果は TT に保存しない。
    if (ctx.aborted) {
      return maxScore;
    }

    // --- Transposition Table Store ---
    let flag: TTFlag = 'EXACT';
    if (maxScore <= alphaOrig) {
      flag = 'UPPERBOUND';
    } else if (maxScore >= betaOrig) {
      flag = 'LOWERBOUND';
    }
    ctx.tt.store(currentHash, ttStoreDepth, maxScore, flag, bestMove);
    return maxScore;
  } else {
    let minScore = Infinity;
    let ttStoreDepth = depth;

    for (let moveIndex = 0; moveIndex < candidates.length; moveIndex++) {
      if (isTimeUp(ctx)) break;

      const { pos, score: moveScore, flags } = candidates[moveIndex];
      const { row, col } = pos;
      const currentMove: Position = { row, col };

      const { undo: moveUndo, nextHash } = applySearchMove(
        ctx,
        currentHash,
        currentMove,
        currentPlayer
      );

      // 即時勝利検出（相手視点）
      if (checkWinInstrumented(board, currentMove, currentPlayer, ctx)) {
        undoSearchMove(ctx, moveUndo);
        ctx.stats.nodes.immediateLoss++;
        return -AI_SCORES.WIN;
      }

      let reduction = getReduction(depth, moveIndex, flags, isRoot, ctx.stats);

      // null-window 探索は beta が有限でないと安全に使えない。
      const canNull = Number.isFinite(beta);
      if (reduction > 0 && !canNull) {
        reduction = 0;
      }

      if (reduction > 0) {
        ctx.stats.lmr.reduced++;
        ctx.stats.lmr.reductionTotal += reduction;
      }

      const usePvsNull = resolveInternalPvsNull(
        ctx,
        moveIndex,
        canNull,
        isRoot,
        flags
      );

      let score: number;

      if (usePvsNull || reduction > 0) {
        const childDepth = Math.max(0, depth - 1 - reduction);
        const nullAlpha = beta - 1;

        if (usePvsNull) {
          ctx.stats.pvs.nullSearches++;
          if (flags.reductionAllowed) {
            ctx.stats.pvs.quietNullSearches++;
          }
        }

        // 削減 or PVS null-window 探索
        score = minimax(
          board,
          childDepth,
          true,
          opponentOf(currentPlayer),
          ctx,
          nullAlpha,
          beta,
          nextHash,
          currentMove,
          false
        );

        if (ctx.aborted) {
          undoSearchMove(ctx, moveUndo);
          return score;
        }

        // fail-low: 通常深度・通常ウィンドウで再探索
        if (score < beta) {
          if (usePvsNull) {
            ctx.stats.pvs.failLowResearches++;
            ctx.stats.pvs.fullResearches++;
          }
          if (reduction > 0) {
            ctx.stats.lmr.researches++;
          }

          score = minimax(
            board,
            depth - 1,
            true,
            opponentOf(currentPlayer),
            ctx,
            alpha,
            beta,
            nextHash,
            currentMove,
            false
          );

          if (ctx.aborted) {
            undoSearchMove(ctx, moveUndo);
            return score;
          }
        } else if (reduction > 0) {
          // 削減探索で fail-high した結果は信用度を下げ、TT store depth を保守化する。
          ttStoreDepth = Math.min(ttStoreDepth, depth - reduction);
        }
      } else {
        // full-window 通常探索
        score = minimax(
          board,
          depth - 1,
          true,
          opponentOf(currentPlayer),
          ctx,
          alpha,
          beta,
          nextHash,
          currentMove,
          false
        );

        if (ctx.aborted) {
          undoSearchMove(ctx, moveUndo);
          return score;
        }
      }

      undoSearchMove(ctx, moveUndo);

      if (score < minScore) {
        minScore = score;
        bestMove = currentMove;
      }
      if (score < beta) beta = score;

      // α カットオフ: CRITICAL 未満の手のみ killer / history / countermove に記録
      if (beta <= alpha) {
        if (moveScore < CRITICAL_SCORE_THRESHOLD) {
          storeKiller(ctx.killerTable, depth, currentMove);
          ctx.stats.ordering.killerStores++;
          storeHistory(ctx.historyTable, currentPlayer, depth, currentMove);
          ctx.stats.ordering.historyStores++;
          if (AI_FEATURES.ENABLE_COUNTERMOVE && lastMove) {
            storeCountermove(
              ctx.countermoveTable,
              currentPlayer,
              lastMove,
              currentMove
            );
            ctx.stats.ordering.countermoveStores++;
          }
        }
        bestMove = currentMove;
        break;
      }
    }

    // 時間切れで中断した結果は TT に保存しない。
    if (ctx.aborted) {
      return minScore;
    }

    // --- Transposition Table Store ---
    let flag: TTFlag = 'EXACT';
    if (minScore <= alphaOrig) {
      flag = 'UPPERBOUND';
    } else if (minScore >= betaOrig) {
      flag = 'LOWERBOUND';
    }
    ctx.tt.store(currentHash, ttStoreDepth, minScore, flag, bestMove);
    return minScore;
  }
};

// ============================================================
// 公開 API
// ============================================================

/**
 * findBestMove の戻り値型。
 */
export interface FindBestMoveResult {
  /** 最善手。候補なし・時間切れ未完了の場合は null */
  move: Position | null;
  /** 探索スコア（aiPlayer 視点）。時間切れ未完了の場合は -Infinity */
  score: number;
}

/**
 * ミニマックス探索で最善手を求めて返す（TT / PVS / LMR / Countermove / LineCache 対応版）。
 *
 * 第4弾：stats を任意で受け取る。未指定の場合は内部で一時統計を作成するが、
 * 呼び出し元へは返さない（後方互換のため）。
 *
 * 第5.5.1弾：sharedStaticEvalCache を任意で受け取る。
 * search.ts からは calculateNextMove 単位で生成した cache を渡す。
 *
 * 第6.2弾：dynamicForbidden を任意で受け取る。
 * search.ts からは calculateNextMove 単位で生成した controller を渡す。
 *
 * 第8.1弾：qsearchController を任意で受け取る。
 * search.ts からは calculateNextMove 単位で生成した controller を渡す。
 * 現在の depth が QSEARCH_MIN_ROOT_DEPTH 未満の場合は使わない。
 */
export const findBestMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  aiPlayer: Player,
  depth: number = AI_CONFIG.MINIMAX_DEPTH,
  deadline: number = Infinity,
  tt: TranspositionTable,
  initialAlpha: number = -Infinity,
  initialBeta: number = Infinity,
  lastMove: Position | null = null,
  stats?: SearchStats,
  sharedStaticEvalCache?: StaticEvalCache | null,
  dynamicForbidden: DynamicForbiddenController | null = null,
  qsearchController?: QSearchController | null
): FindBestMoveResult => {
  const searchStats =
    stats ?? createSearchStats(aiPlayer, 'fixed', depth, null, lastMove);

  // 第8.1弾: 現在の depth が浅い場合は qsearch を使わない
  const effectiveQSearch =
    qsearchController && depth >= qsearchController.minRootDepth
      ? qsearchController
      : null;

  const ctx = createSearchContext(
    board,
    aiPlayer,
    forbiddenMoves,
    deadline,
    tt,
    searchStats,
    sharedStaticEvalCache,
    dynamicForbidden,
    effectiveQSearch
  );

  const verboseLog = shouldLogVerboseSearch();

  // 初期盤面ハッシュを計算（思考開始時に1回のみ）
  const initialHash = calculateInitialHash(board);

  // TT Best Move を取得（ルートノードの Move Ordering 用）
  const ttBestMove = ctx.tt.getBestMove(initialHash);

  const candidates = generateOrderedCandidates(
    board,
    aiPlayer,
    forbiddenMoves,
    ctx.killerTable,
    ctx.historyTable,
    ctx.countermoveTable,
    depth,
    lastMove,
    ttBestMove,
    true,
    ctx.lineCache,
    ctx.candidateSet,
    ctx.stats,
    initialHash,
    ctx.dynamicForbidden
  );

  if (candidates.length === 0) {
    ctx.stats.nodes.total++;
    ctx.stats.nodes.leaf++;
    return { move: null, score: -Infinity };
  }

  ctx.stats.nodes.total++;
  ctx.stats.nodes.internal++;

  let bestPos: Position = candidates[0].pos;
  let bestScore = -Infinity;

  // original window を保持し、最終的な TT flag 判定に使う。
  const alphaOrig = initialAlpha;
  const betaOrig = initialBeta;
  let alpha = initialAlpha;
  const beta = initialBeta;

  if (verboseLog) {
    console.log(
      `[Minimax] depth=${depth}, candidates=${candidates.length}, player=${aiPlayer}, ` +
      `window=[${alpha}, ${beta}], ttSize=${tt.size}`
    );
  }

  const rootPvsAllowed =
    PVS_CONFIG.ENABLE_ROOT_PVS ||
    (SEARCH_TUNING_FEATURES.ENABLE_CONDITIONAL_ROOT_PVS &&
      depth >= SEARCH_TUNING_CONFIG.ROOT_PVS_MIN_DEPTH);

  for (let moveIndex = 0; moveIndex < candidates.length; moveIndex++) {
    // 時間切れ: ルート候補を全て評価しきれていないため、この深さの結果は不採用とする
    if (isTimeUp(ctx)) {
      if (verboseLog) {
        console.log(`[Minimax] depth=${depth} timed out before completion`);
      }
      return { move: null, score: -Infinity };
    }

    const { pos } = candidates[moveIndex];
    const { row, col } = pos;
    const currentMove: Position = { row, col };

    const { undo: moveUndo, nextHash } = applySearchMove(
      ctx,
      initialHash,
      currentMove,
      aiPlayer
    );

    // ルートノード即時勝利（1 手詰め検出）
    if (checkWinInstrumented(board, currentMove, aiPlayer, ctx)) {
      undoSearchMove(ctx, moveUndo);
      ctx.stats.nodes.immediateWin++;
      if (verboseLog) {
        console.log(`[Minimax] Immediate Win at (${row}, ${col})`);
      }
      return { move: currentMove, score: AI_SCORES.WIN };
    }

    let score: number;

    const useRootPvsNull =
      AI_FEATURES.ENABLE_PVS &&
      rootPvsAllowed &&
      moveIndex > 0 &&
      Number.isFinite(alpha);

    if (useRootPvsNull) {
      const nullBeta = alpha + 1;
      ctx.stats.pvs.rootNullSearches++;
      ctx.stats.pvs.nullSearches++;

      score = minimax(
        board,
        depth - 1,
        false,
        opponentOf(aiPlayer),
        ctx,
        alpha,
        nullBeta,
        nextHash,
        currentMove,
        false
      );

      if (ctx.aborted) {
        undoSearchMove(ctx, moveUndo);
        if (verboseLog) {
          console.log(`[Minimax] depth=${depth} aborted during child search`);
        }
        return { move: null, score: -Infinity };
      }

      // fail-high: full window で再探索
      if (score > alpha) {
        ctx.stats.pvs.failHighResearches++;
        ctx.stats.pvs.fullResearches++;
        ctx.stats.pvs.rootFailHighResearches++;

        score = minimax(
          board,
          depth - 1,
          false,
          opponentOf(aiPlayer),
          ctx,
          alpha,
          beta,
          nextHash,
          currentMove,
          false
        );

        if (ctx.aborted) {
          undoSearchMove(ctx, moveUndo);
          if (verboseLog) {
            console.log(`[Minimax] depth=${depth} aborted during child search`);
          }
          return { move: null, score: -Infinity };
        }
      }
    } else {
      score = minimax(
        board,
        depth - 1,
        false,
        opponentOf(aiPlayer),
        ctx,
        alpha,
        beta,
        nextHash,
        currentMove,
        false
      );

      if (ctx.aborted) {
        undoSearchMove(ctx, moveUndo);
        if (verboseLog) {
          console.log(`[Minimax] depth=${depth} aborted during child search`);
        }
        return { move: null, score: -Infinity };
      }
    }

    undoSearchMove(ctx, moveUndo);

    if (score > bestScore) {
      bestScore = score;
      bestPos = currentMove;
    }

    // ルート α を更新して子ノードの枝刈り効率を高める
    if (score > alpha) alpha = score;

    // ルートで fail-high。
    if (alpha >= beta) {
      ctx.tt.store(initialHash, depth, bestScore, 'LOWERBOUND', bestPos);
      if (verboseLog) {
        console.log(
          `[Minimax] depth=${depth} fail-high: alpha=${alpha}, beta=${beta}, ` +
          `best=(${bestPos.row}, ${bestPos.col}), score=${bestScore}`
        );
      }
      return { move: bestPos, score: bestScore };
    }
  }

  // 探索完了後に aborted になっていれば保存しない。
  if (ctx.aborted) {
    return { move: null, score: -Infinity };
  }

  // ルートノードの結果を TT に保存。
  let flag: TTFlag = 'EXACT';
  if (bestScore <= alphaOrig) {
    flag = 'UPPERBOUND';
  } else if (bestScore >= betaOrig) {
    flag = 'LOWERBOUND';
  }
  ctx.tt.store(initialHash, depth, bestScore, flag, bestPos);

  if (verboseLog) {
    console.log(
      `[Minimax] best=(${bestPos.row}, ${bestPos.col}), score=${bestScore}, flag=${flag}`
    );
  }

  return { move: bestPos, score: bestScore };
};