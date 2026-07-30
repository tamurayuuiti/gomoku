// src/utils/ai/quiescence.ts
// 葉ノードでの戦術 Quiescence を担うモジュール。
//
// 責務:
//   - 即時勝ち / 受け不能 / 連続四の proof 型読み伸ばし
//   - 時間予算 / ノード上限 / ply 上限による安全制御
//   - Black 禁手考慮（五連は禁手より優先）
//   - qsearch 統計の更新
//
// 注意:
//   - 証明できない場合は静的評価へフォールバックする。
//   - 任意手では LOSS を証明しない。
//   - board / lineCache は apply / undo で必ず復元する。

import type { BoardState, Player, Position } from '../../types/game';
import type { SearchOptions, SearchStats, LineCacheState } from '../../types/ai';
import {
  BOARD_SIZE,
  checkForbiddenMove,
  DIRECTIONS,
  countStones,
} from '../gameLogic';
import {
  AI_SCORES,
  QSEARCH_FEATURES,
  QSEARCH_CONFIG,
} from './constants';
import { DIAGNOSTICS_DEBUG_FLAGS } from './diagnosticsFlags';
import {
  applySearchMove,
  undoSearchMove,
} from './searchState';
import type { SearchStateContainers } from './searchState';
import { createSearchStats } from './searchStats';
import { hasStoneNearby, opponentOf } from './evaluator';
import { wouldWin, getHypotheticalPatternCounts } from './threatModel';

// ============================================================
// 公開型
// ============================================================

export type QSearchOutcome =
  | 'WIN'
  | 'LOSS'
  | 'UNKNOWN'
  | 'ABORTED'
  | 'DISABLED'
  | 'SKIPPED'
  | 'ERROR';

export interface QSearchLeafResult {
  score: number | null;
  outcome: QSearchOutcome;
}

export interface QSearchController {
  enabled: boolean;
  aiPlayer: Player;
  ruleEnabled: boolean;
  minRootDepth: number;
  budgetMs: number;
  totalNodeLimit: number;
  nodeLimitPerLeaf: number;
  maxPly: number;
  startTime: number;
  deadline: number;
  nodes: number;
  budgetExhausted: boolean;
  errorOccurred: boolean;
  resultCache: Map<bigint, QSearchCacheEntry>;
  forbiddenCache: Map<bigint, boolean>;
  ephemeralStats: SearchStats;
  stats: SearchStats;
}

// ============================================================
// 内部型
// ============================================================

interface QSearchCacheEntry {
  score: number | null;
  outcome: QSearchOutcome;
}

interface QSearchNodeResult {
  outcome: 'WIN' | 'LOSS' | 'UNKNOWN' | 'ABORTED';
  plyToWin: number | null;
}

interface QSearchCandidate {
  pos: Position;
  openFour: boolean;
  closedFour: number;
  order: number;
}

interface QSearchInternalContext {
  state: SearchStateContainers;
  aiPlayer: Player;
  side: Player;
  opponent: Player;
  ruleEnabled: boolean;
  controller: QSearchController;
}

// ============================================================
// 定数・ヘルパー
// ============================================================

const MASK64 = (1n << 64n) - 1n;
const MOVE_SALT_SEED = 0x9e3779b97f4a7c15n;
const PLAYER_SALT_BLACK = 0xbf58476d1ce4e5b9n;
const SIDE_SALT_BLACK = 0x9e3779b97f4a7c15n;
const SIDE_SALT_WHITE = 0xbf58476d1ce4e5b9n;
const RULE_SALT = 0x94d049bb133111ebn;

const moveSalt = (index: number): bigint =>
  (BigInt(index + 1) * MOVE_SALT_SEED) & MASK64;

// ============================================================
// 予算解決
// ============================================================

const resolveQSearchBudgetMs = (
  options: SearchOptions | undefined,
  timeLimitMs: number | null,
  deadline: number
): number => {
  if (options?.qsearchTimeBudgetMs !== undefined) {
    return Number.isFinite(options.qsearchTimeBudgetMs)
      ? options.qsearchTimeBudgetMs
      : 0;
  }

  if (timeLimitMs === null) {
    return QSEARCH_CONFIG.QSEARCH_FIXED_TIME_BUDGET_MS;
  }

  if (!Number.isFinite(timeLimitMs) || timeLimitMs <= 0) {
    return 0;
  }

  const raw = timeLimitMs * QSEARCH_CONFIG.QSEARCH_TOTAL_TIME_RATIO;

  let budget = Math.max(
    QSEARCH_CONFIG.QSEARCH_TOTAL_TIME_MIN_MS,
    Math.min(QSEARCH_CONFIG.QSEARCH_TOTAL_TIME_MAX_MS, raw)
  );

  // 全体 deadline を超えないようにする。
  if (deadline !== Infinity) {
    const remaining = deadline - performance.now();
    budget = Math.min(
      budget,
      Math.max(0, remaining - QSEARCH_CONFIG.QSEARCH_DEADLINE_SAFETY_MS)
    );
  }

  return budget;
};

const resolveQSearchNodeLimit = (
  options: SearchOptions | undefined
): number => {
  if (options?.qsearchTotalNodeLimit !== undefined) {
    return Number.isFinite(options.qsearchTotalNodeLimit)
      ? options.qsearchTotalNodeLimit
      : 0;
  }

  return QSEARCH_CONFIG.QSEARCH_TOTAL_NODE_LIMIT;
};

const resolveQSearchNodeLimitPerLeaf = (
  options: SearchOptions | undefined
): number => {
  if (options?.qsearchNodeLimitPerLeaf !== undefined) {
    return Number.isFinite(options.qsearchNodeLimitPerLeaf)
      ? options.qsearchNodeLimitPerLeaf
      : 0;
  }

  return QSEARCH_CONFIG.QSEARCH_NODE_LIMIT_PER_LEAF;
};

const resolveQSearchMaxPly = (
  options: SearchOptions | undefined
): number => {
  if (options?.qsearchMaxPly !== undefined) {
    return Number.isFinite(options.qsearchMaxPly)
      ? options.qsearchMaxPly
      : 0;
  }

  return QSEARCH_CONFIG.QSEARCH_MAX_PLY;
};

// ============================================================
// 公開 API: コントローラ生成
// ============================================================

export const createQSearchController = (
  params: {
    aiPlayer: Player;
    forbiddenRuleEnabled: boolean;
    timeLimitMs: number | null;
    deadline: number;
    maxDepth: number;
    stonesBefore: number;
    options?: SearchOptions;
  },
  stats: SearchStats
): QSearchController | null => {
  const qs = stats.qsearch;

  // --- 有効性チェック ---
  if (!QSEARCH_FEATURES.ENABLE_QSEARCH) {
    qs.disabled++;
    return null;
  }

  if (params.options?.qsearchEnabled === false) {
    qs.skippedByOption++;
    return null;
  }

  if (params.stonesBefore < QSEARCH_CONFIG.QSEARCH_MIN_STONES) {
    qs.skippedEarlyGame++;
    return null;
  }

  if (params.maxDepth < QSEARCH_CONFIG.QSEARCH_MIN_ROOT_DEPTH) {
    qs.skippedLowDepth++;
    return null;
  }

  if (
    params.timeLimitMs !== null &&
    params.timeLimitMs < QSEARCH_CONFIG.QSEARCH_MIN_TIME_LIMIT_MS &&
    params.options?.qsearchTimeBudgetMs === undefined
  ) {
    qs.skippedLowTime++;
    return null;
  }

  const budgetMs = resolveQSearchBudgetMs(
    params.options,
    params.timeLimitMs,
    params.deadline
  );

  const totalNodeLimit = resolveQSearchNodeLimit(params.options);
  const nodeLimitPerLeaf = resolveQSearchNodeLimitPerLeaf(params.options);
  const maxPly = resolveQSearchMaxPly(params.options);

  if (
    budgetMs <= 0 ||
    totalNodeLimit <= 0 ||
    nodeLimitPerLeaf <= 0 ||
    maxPly <= 0
  ) {
    qs.skippedByOption++;
    return null;
  }

  qs.budgetMs = budgetMs;

  // apply / undo 用の一時統計。
  // qsearch 固有統計は stats 側に記録し、通常探索統計を汚さない。
  const ephemeralStats = createSearchStats(
    params.aiPlayer,
    'fixed',
    0,
    null,
    null
  );

  return {
    enabled: true,
    aiPlayer: params.aiPlayer,
    ruleEnabled: params.forbiddenRuleEnabled,
    minRootDepth: QSEARCH_CONFIG.QSEARCH_MIN_ROOT_DEPTH,
    budgetMs,
    totalNodeLimit,
    nodeLimitPerLeaf,
    maxPly,
    startTime: performance.now(),
    deadline: params.deadline,
    nodes: 0,
    budgetExhausted: false,
    errorOccurred: false,
    resultCache: new Map<bigint, QSearchCacheEntry>(),
    forbiddenCache: new Map<bigint, boolean>(),
    ephemeralStats,
    stats,
  };
};

// ============================================================
// 時間 / 予算チェック
// ============================================================

const isQSearchTimeUp = (controller: QSearchController): boolean => {
  if (controller.budgetExhausted) return true;

  const now = performance.now();

  if (now - controller.startTime >= controller.budgetMs) {
    controller.budgetExhausted = true;
    return true;
  }

  if (
    controller.deadline !== Infinity &&
    now >= controller.deadline - QSEARCH_CONFIG.QSEARCH_DEADLINE_SAFETY_MS
  ) {
    controller.budgetExhausted = true;
    return true;
  }

  return false;
};

// ============================================================
// 禁手キャッシュ
// ============================================================

const checkForbiddenCached = (
  ctx: QSearchInternalContext,
  pos: Position,
  player: Player,
  hash: bigint
): boolean => {
  if (player !== 'Black' || !ctx.ruleEnabled) return false;

  const qs = ctx.controller.stats.qsearch;
  qs.forbiddenChecks++;

  if (!QSEARCH_FEATURES.ENABLE_QSEARCH_FORBIDDEN_CACHE) {
    return checkForbiddenMove(ctx.state.board, pos, player).isForbidden;
  }

  const index = pos.row * BOARD_SIZE + pos.col;

  const key =
    (hash ^
      moveSalt(index) ^
      PLAYER_SALT_BLACK ^
      QSEARCH_CONFIG.QSEARCH_VERSION) &
    MASK64;

  const cached = ctx.controller.forbiddenCache.get(key);

  if (cached !== undefined) {
    qs.forbiddenCacheHits++;
    return cached;
  }

  qs.forbiddenCacheMisses++;

  const result = checkForbiddenMove(ctx.state.board, pos, player).isForbidden;

  // eviction
  const limit = QSEARCH_CONFIG.QSEARCH_FORBIDDEN_CACHE_LIMIT;

  if (limit > 0 && ctx.controller.forbiddenCache.size >= limit) {
    const deleteCount = Math.max(
      1,
      Math.floor(
        ctx.controller.forbiddenCache.size *
          QSEARCH_CONFIG.QSEARCH_CACHE_EVICTION_RATIO
      )
    );

    let deleted = 0;

    for (const cacheKey of ctx.controller.forbiddenCache.keys()) {
      ctx.controller.forbiddenCache.delete(cacheKey);
      deleted++;
      if (deleted >= deleteCount) break;
    }

    qs.forbiddenCacheEvictions += deleted;
  }

  ctx.controller.forbiddenCache.set(key, result);

  qs.forbiddenCacheSize = ctx.controller.forbiddenCache.size;

  if (qs.forbiddenCacheSize > qs.forbiddenCacheMaxSize) {
    qs.forbiddenCacheMaxSize = qs.forbiddenCacheSize;
  }

  return result;
};

// ============================================================
// 合法性判定
// ============================================================

/**
 * qsearch 内部の合法性判定。
 *
 * root の静的 forbiddenMoves は使わない。
 * Black の場合は動的に禁手判定する。
 */
const isLegalQSearch = (
  ctx: QSearchInternalContext,
  pos: Position,
  player: Player,
  hash: bigint
): boolean => {
  const { row, col } = pos;

  if (ctx.state.board[row][col] !== null) return false;

  if (player === 'Black' && ctx.ruleEnabled) {
    if (checkForbiddenCached(ctx, pos, player, hash)) return false;
  }

  return true;
};

// ============================================================
// 即時勝ちマス検出
// ============================================================

/**
 * 即時勝ちマスを列挙する。
 * 石の近くのみ走査する。
 */
const findImmediateWinSquares = (
  ctx: QSearchInternalContext,
  player: Player
): Position[] => {
  const board = ctx.state.board;
  const result: Position[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      const pos: Position = { row: r, col: c };

      if (wouldWin(board, pos, player)) {
        result.push(pos);
      }
    }
  }

  return result;
};

/**
 * 着手 lastMove によって新たに生じた即時勝ちマスを列挙する。
 * lastMove を中心とした 4 方向・距離 4 以内だけを確認する。
 */
const collectWinSquaresAfterMove = (
  ctx: QSearchInternalContext,
  lastMove: Position,
  player: Player
): Position[] => {
  const board = ctx.state.board;
  const result: Position[] = [];
  const seen = new Set<number>();

  for (const [dr, dc] of DIRECTIONS) {
    for (let offset = -4; offset <= 4; offset++) {
      if (offset === 0) continue;

      const r = lastMove.row + dr * offset;
      const c = lastMove.col + dc * offset;

      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;

      const key = r * BOARD_SIZE + c;
      if (seen.has(key)) continue;

      seen.add(key);

      if (board[r][c] !== null) continue;

      const pos: Position = { row: r, col: c };

      if (wouldWin(board, pos, player)) {
        result.push(pos);
      }
    }
  }

  return result;
};

// ============================================================
// 四を作る手の生成
// ============================================================

const generateFourMoves = (
  ctx: QSearchInternalContext,
  player: Player,
  hash: bigint
): QSearchCandidate[] => {
  const board = ctx.state.board;
  const lineCache = ctx.state.lineCache;
  const candidates: QSearchCandidate[] = [];

  let order = 0;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      const pos: Position = { row: r, col: c };

      const counts = getHypotheticalPatternCounts(
        board,
        lineCache,
        r,
        c,
        player
      );

      const currentOrder = order;
      order++;

      if (counts.OPEN_FOUR === 0 && counts.CLOSED_FOUR === 0) {
        continue;
      }

      if (!isLegalQSearch(ctx, pos, player, hash)) {
        continue;
      }

      candidates.push({
        pos,
        openFour: counts.OPEN_FOUR > 0,
        closedFour: counts.CLOSED_FOUR,
        order: currentOrder,
      });
    }
  }

  // 活四優先、次に閉四数降順、同点は生成順。
  candidates.sort((a, b) => {
    if (a.openFour !== b.openFour) {
      return a.openFour ? -1 : 1;
    }

    if (a.closedFour !== b.closedFour) {
      return b.closedFour - a.closedFour;
    }

    return a.order - b.order;
  });

  return candidates;
};

// ============================================================
// qsearch 再帰本体
// ============================================================

const qsearch = (
  ctx: QSearchInternalContext,
  side: Player,
  ply: number,
  hash: bigint,
  localStartNodes: number
): QSearchNodeResult => {
  const controller = ctx.controller;
  const qs = controller.stats.qsearch;

  controller.nodes++;
  qs.nodes++;

  // 総予算チェック
  if (
    controller.nodes > controller.totalNodeLimit ||
    isQSearchTimeUp(controller)
  ) {
    controller.budgetExhausted = true;
    return { outcome: 'ABORTED', plyToWin: null };
  }

  // 1葉あたりノード上限チェック
  if (controller.nodes - localStartNodes > controller.nodeLimitPerLeaf) {
    return { outcome: 'ABORTED', plyToWin: null };
  }

  // maxPly 記録
  if (ply > qs.maxPlyReached) {
    qs.maxPlyReached = ply;
  }

  const opponent = opponentOf(side);

  // 1. 即時勝ち
  const immediateWinSquares = findImmediateWinSquares(ctx, side);

  if (immediateWinSquares.length > 0) {
    qs.immediateWins++;
    return { outcome: 'WIN', plyToWin: ply + 1 };
  }

  // 2. 相手の即時勝ち
  const oppWinSquares = findImmediateWinSquares(ctx, opponent);

  if (oppWinSquares.length >= 2) {
    // 受け不能
    if (QSEARCH_FEATURES.ENABLE_QSEARCH_LOSS_PROOF) {
      qs.illegalBlocks++;
      return { outcome: 'LOSS', plyToWin: null };
    }

    return { outcome: 'UNKNOWN', plyToWin: null };
  }

  if (oppWinSquares.length === 1) {
    const block = oppWinSquares[0];

    if (!isLegalQSearch(ctx, block, side, hash)) {
      // ブロック不能
      if (QSEARCH_FEATURES.ENABLE_QSEARCH_LOSS_PROOF) {
        qs.illegalBlocks++;
        return { outcome: 'LOSS', plyToWin: null };
      }

      return { outcome: 'UNKNOWN', plyToWin: null };
    }

    // 強制ブロック
    const blockApplied = applySearchMove(ctx.state, hash, block, side);

    try {
      const child = qsearch(
        ctx,
        opponent,
        ply + 1,
        blockApplied.nextHash,
        localStartNodes
      );

      if (child.outcome === 'WIN') {
        // 相手が勝つ → 自分は負け
        return { outcome: 'LOSS', plyToWin: null };
      }

      if (child.outcome === 'LOSS') {
        // 相手が負ける → 自分は勝ち
        return { outcome: 'WIN', plyToWin: child.plyToWin };
      }

      if (child.outcome === 'ABORTED') {
        return { outcome: 'ABORTED', plyToWin: null };
      }

      return { outcome: 'UNKNOWN', plyToWin: null };
    } finally {
      undoSearchMove(ctx.state, blockApplied.undo);
    }
  }

  // 3. ply limit
  // 即時勝ち / 受け不能チェックは上記で完了済み。
  if (ply >= controller.maxPly) {
    return { outcome: 'UNKNOWN', plyToWin: null };
  }

  // 4. 自分の四を作る手を生成して探索
  const candidates = generateFourMoves(ctx, side, hash);

  for (const candidate of candidates) {
    const applied = applySearchMove(ctx.state, hash, candidate.pos, side);

    try {
      // 相手の反撃即時勝ち確認
      const oppImmediate = findImmediateWinSquares(ctx, opponent);

      if (oppImmediate.length > 0) {
        qs.defenderCounterWins++;
        continue;
      }

      // 自分の即時勝ちマスを確認
      const winSquares = collectWinSquaresAfterMove(
        ctx,
        candidate.pos,
        side
      );

      if (winSquares.length >= 2) {
        // 受け不可な四（活四終端）
        qs.terminalOpenFours++;
        return { outcome: 'WIN', plyToWin: ply + 2 };
      }

      if (winSquares.length === 1) {
        const blockPos = winSquares[0];

        // 相手がブロックできないなら勝ち
        if (!isLegalQSearch(ctx, blockPos, opponent, applied.nextHash)) {
          qs.illegalBlocks++;
          return { outcome: 'WIN', plyToWin: ply + 2 };
        }

        // 相手の強制ブロック
        const blockApplied = applySearchMove(
          ctx.state,
          applied.nextHash,
          blockPos,
          opponent
        );

        try {
          const child = qsearch(
            ctx,
            side,
            ply + 2,
            blockApplied.nextHash,
            localStartNodes
          );

          if (child.outcome === 'WIN') {
            return { outcome: 'WIN', plyToWin: child.plyToWin };
          }

          if (child.outcome === 'ABORTED') {
            return { outcome: 'ABORTED', plyToWin: null };
          }

          // child LOSS / UNKNOWN → この手は不採用、次を試す。
        } finally {
          undoSearchMove(ctx.state, blockApplied.undo);
        }
      }

      // winSquares.length === 0 は四として成立していないため失敗。
    } finally {
      undoSearchMove(ctx.state, applied.undo);
    }
  }

  return { outcome: 'UNKNOWN', plyToWin: null };
};

// ============================================================
// 結果キャッシュ
// ============================================================

const makeResultCacheKey = (
  hash: bigint,
  side: Player,
  ruleEnabled: boolean
): bigint => {
  const sideSalt = side === 'Black' ? SIDE_SALT_BLACK : SIDE_SALT_WHITE;
  const ruleSalt = ruleEnabled ? RULE_SALT : 0n;

  return (
    (hash ^ sideSalt ^ ruleSalt ^ QSEARCH_CONFIG.QSEARCH_VERSION) & MASK64
  );
};

const evictResultCache = (controller: QSearchController): void => {
  const qs = controller.stats.qsearch;
  const limit = QSEARCH_CONFIG.QSEARCH_RESULT_CACHE_LIMIT;

  if (limit <= 0) return;
  if (controller.resultCache.size < limit) return;

  const deleteCount = Math.max(
    1,
    Math.floor(
      controller.resultCache.size * QSEARCH_CONFIG.QSEARCH_CACHE_EVICTION_RATIO
    )
  );

  let deleted = 0;

  for (const key of controller.resultCache.keys()) {
    controller.resultCache.delete(key);
    deleted++;
    if (deleted >= deleteCount) break;
  }

  qs.cacheEvictions += deleted;
};

// ============================================================
// 公開 API: 葉ノード qsearch
// ============================================================

export const runQuiescenceAtLeaf = (params: {
  board: BoardState;
  lineCache: LineCacheState | null;
  forbiddenMoves: boolean[][];
  side: Player;
  hash: bigint;
  controller: QSearchController;
  stats: SearchStats;
}): QSearchLeafResult => {
  const {
    board,
    lineCache,
    forbiddenMoves,
    side,
    hash,
    controller,
    stats,
  } = params;

  const qs = stats.qsearch;
  const start = performance.now();

  // 無効 / エラー済みチェック
  if (!controller.enabled || controller.errorOccurred) {
    return { score: null, outcome: 'DISABLED' };
  }

  // 予算切れチェック
  if (controller.budgetExhausted || isQSearchTimeUp(controller)) {
    qs.budgetExhausted++;
    qs.fallback++;
    return { score: null, outcome: 'ABORTED' };
  }

  qs.calls++;

  // 結果キャッシュ参照
  if (QSEARCH_FEATURES.ENABLE_QSEARCH_CACHE) {
    const cacheKey = makeResultCacheKey(hash, side, controller.ruleEnabled);
    const cached = controller.resultCache.get(cacheKey);

    if (cached !== undefined) {
      qs.cacheHits++;

      if (cached.outcome === 'WIN') qs.win++;
      else if (cached.outcome === 'LOSS') qs.loss++;
      else if (cached.outcome === 'UNKNOWN') qs.unknown++;

      if (cached.score === null) qs.fallback++;

      qs.timeMs += performance.now() - start;
      return cached;
    }

    qs.cacheMisses++;
  }

  // qsearch 実行
  try {
    // state audit 用
    const stonesBefore = DIAGNOSTICS_DEBUG_FLAGS.ENABLE_QSEARCH_STATE_AUDIT
      ? countStones(board)
      : 0;

    const state: SearchStateContainers = {
      board,
      lineCache,
      candidateSet: null,
      forbiddenMoves,
      stats: controller.ephemeralStats,
    };

    const ctx: QSearchInternalContext = {
      state,
      aiPlayer: controller.aiPlayer,
      side,
      opponent: opponentOf(side),
      ruleEnabled: controller.ruleEnabled,
      controller,
    };

    const localStartNodes = controller.nodes;
    const result = qsearch(ctx, side, 0, hash, localStartNodes);

    // state audit
    if (DIAGNOSTICS_DEBUG_FLAGS.ENABLE_QSEARCH_STATE_AUDIT) {
      const stonesAfter = countStones(board);

      if (stonesBefore !== stonesAfter) {
        qs.auditFails++;

        console.warn(
          `[QSearch] state audit failed: before=${stonesBefore}, after=${stonesAfter}`
        );

        controller.errorOccurred = true;
        controller.enabled = false;
      }
    }

    // スコア変換
    let score: number | null = null;
    let outcome: QSearchOutcome;

    if (result.outcome === 'WIN') {
      score = side === controller.aiPlayer ? AI_SCORES.WIN : -AI_SCORES.WIN;
      outcome = 'WIN';
      qs.win++;
    } else if (result.outcome === 'LOSS') {
      score = side === controller.aiPlayer ? -AI_SCORES.WIN : AI_SCORES.WIN;
      outcome = 'LOSS';
      qs.loss++;
    } else if (result.outcome === 'ABORTED') {
      outcome = 'ABORTED';
      qs.abort++;
    } else {
      outcome = 'UNKNOWN';
      qs.unknown++;
    }

    if (score === null) {
      qs.fallback++;
    }

    // 結果キャッシュ保存（ABORTED は保存しない）
    if (
      QSEARCH_FEATURES.ENABLE_QSEARCH_CACHE &&
      result.outcome !== 'ABORTED'
    ) {
      const cacheKey = makeResultCacheKey(hash, side, controller.ruleEnabled);

      evictResultCache(controller);

      controller.resultCache.set(cacheKey, { score, outcome });

      qs.cacheSize = controller.resultCache.size;

      if (qs.cacheSize > qs.cacheMaxSize) {
        qs.cacheMaxSize = qs.cacheSize;
      }
    }

    qs.timeMs += performance.now() - start;

    if (DIAGNOSTICS_DEBUG_FLAGS.ENABLE_QSEARCH_VERBOSE_LOG) {
      console.log(
        `[QSearch] ${outcome} side=${side} hash=${hash} ` +
          `nodes=${controller.nodes - localStartNodes} ply=${qs.maxPlyReached}`
      );
    }

    return { score, outcome };
  } catch (err) {
    qs.error++;
    qs.fallback++;
    qs.timeMs += performance.now() - start;

    controller.errorOccurred = true;
    controller.enabled = false;

    if (DIAGNOSTICS_DEBUG_FLAGS.ENABLE_QSEARCH_VERBOSE_LOG) {
      console.error('[QSearch] exception:', err);
    }

    return { score: null, outcome: 'ERROR' };
  }
};