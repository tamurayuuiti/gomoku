// src/utils/ai/vcfSolver.ts
// 第7.1弾：Root VCF
//
// 責務:
//   - root での連続四限定 VCF 探索
//   - 勝ちが証明された場合のみ root 着手を返す
//   - 時間予算 / node limit / max ply による安全制御
//   - Black 禁手考慮（五連は禁手より優先）
//   - VCF 統計の更新
//
// 非責務:
//   - Internal VCF
//   - 通常探索
//   - 評価関数
//   - TT 操作
//   - UI / Worker 通信
//
// 設計方針:
//   - VCF の失敗は「負け」や「最善」を意味しない
//   - VCF の中断は「不明」を意味し、通常探索へ委譲する
//   - 勝ち断定は保守的に行う
//   - board / lineCache は apply / undo で必ず復元する
//
// 第7.2弾:
//   - verbose 診断ログを強化
//   - skip / fail / abort / win の理由を診断可能化
//   - 勝ち証明の終端理由（immediate / open-four-terminal / illegal-block / forced）を保持

import type { BoardState, Player, Position } from '../../types/game';
import type { SearchOptions, SearchStats } from '../../types/ai';
import { BOARD_SIZE, checkForbiddenMove } from '../gameLogic';
import {
  AI_FEATURES,
  DIRECTIONS,
  PHASE7_FEATURES,
  PHASE7_CONFIG,
} from './constants';
import { createLineCache } from './lineCache';
import { calculateInitialHash } from './zobrist';
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

export type RootVcfOutcome =
  | 'DISABLED'
  | 'SKIPPED'
  | 'WIN'
  | 'FAIL'
  | 'ABORTED'
  | 'ERROR';

export interface RootVcfRequest {
  board: BoardState;
  forbiddenMoves: boolean[][];
  mover: Player;
  ruleEnabled: boolean;
  maxDepth: number;
  timeLimitMs: number | null;
  stones: number;
  options?: SearchOptions;
}

export interface RootVcfResult {
  outcome: RootVcfOutcome;
  move: Position | null;
  plyToWin: number | null;
  nodes: number;
  maxPlyReached: number;
  timeMs: number;
  budgetMs: number;
  nodeLimit: number;
  reason: string | null;
}

// ============================================================
// 内部型
// ============================================================

interface VcfContext {
  state: SearchStateContainers;
  mover: Player;
  opponent: Player;
  ruleEnabled: boolean;
  rootForbiddenMoves: boolean[][];
  budgetMs: number;
  nodeLimit: number;
  maxPly: number;
  startTime: number;
  nodes: number;
  maxPlyReached: number;
  forbiddenCache: Map<bigint, boolean>;
  stats: SearchStats;
}

interface VcfCandidate {
  pos: Position;
  openFour: boolean;
  closedFour: number;
  order: number;
}

/**
 * VCF 勝ち証明の終端理由。
 *
 * 第7.2弾では診断専用。探索挙動やスコアには影響しない。
 */
type VcfWinKind =
  | 'immediate'
  | 'open-four-terminal'
  | 'illegal-block'
  | 'forced'
  | null;

interface VcfNodeResult {
  outcome: 'WIN' | 'FAIL' | 'ABORTED';
  plyToWin: number | null;
  move: Position | null;
  winKind: VcfWinKind;
}

// ============================================================
// 定数・ヘルパー
// ============================================================

const MASK64 = (1n << 64n) - 1n;
const MOVE_SALT_SEED = 0x9e3779b97f4a7c15n;
const PLAYER_SALT_BLACK = 0xbf58476d1ce4e5b9n;

const moveSalt = (index: number): bigint =>
  (BigInt(index + 1) * MOVE_SALT_SEED) & MASK64;

const countStones = (board: BoardState): number => {
  let count = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null) count++;
    }
  }
  return count;
};

const resolveRootBudgetMs = (
  options: SearchOptions | undefined,
  timeLimitMs: number | null
): number => {
  if (options?.vcfTimeBudgetMs !== undefined) {
    return Number.isFinite(options.vcfTimeBudgetMs)
      ? options.vcfTimeBudgetMs
      : 0;
  }

  if (timeLimitMs === null) {
    return PHASE7_CONFIG.ROOT_VCF_FIXED_TIME_BUDGET_MS;
  }

  if (!Number.isFinite(timeLimitMs)) {
    return 0;
  }

  const raw = timeLimitMs * PHASE7_CONFIG.ROOT_VCF_TIME_BUDGET_RATIO;
  return Math.max(
    PHASE7_CONFIG.ROOT_VCF_TIME_BUDGET_MIN_MS,
    Math.min(PHASE7_CONFIG.ROOT_VCF_TIME_BUDGET_MAX_MS, raw)
  );
};

const resolveRootNodeLimit = (
  options: SearchOptions | undefined
): number => {
  if (options?.vcfNodeLimit !== undefined) {
    return Number.isFinite(options.vcfNodeLimit)
      ? options.vcfNodeLimit
      : 0;
  }
  return PHASE7_CONFIG.ROOT_VCF_NODE_LIMIT;
};

// ============================================================
// VCF 内部処理
// ============================================================

const isVcfTimeUp = (ctx: VcfContext): boolean =>
  performance.now() - ctx.startTime >= ctx.budgetMs;

const checkForbiddenCached = (
  ctx: VcfContext,
  pos: Position,
  player: Player,
  hash: bigint
): boolean => {
  if (player !== 'Black' || !ctx.ruleEnabled) return false;

  const vcf = ctx.stats.vcf;
  vcf.rootForbiddenChecks++;

  if (!PHASE7_FEATURES.VCF_USE_FORBIDDEN_CACHE) {
    return checkForbiddenMove(ctx.state.board, pos, player).isForbidden;
  }

  const index = pos.row * BOARD_SIZE + pos.col;
  const key =
    (hash ^
      moveSalt(index) ^
      PLAYER_SALT_BLACK ^
      PHASE7_CONFIG.VCF_VERSION) &
    MASK64;

  const cached = ctx.forbiddenCache.get(key);
  if (cached !== undefined) {
    vcf.rootForbiddenCacheHits++;
    return cached;
  }

  vcf.rootForbiddenCacheMisses++;
  const result = checkForbiddenMove(ctx.state.board, pos, player).isForbidden;

  const limit = PHASE7_CONFIG.VCF_FORBIDDEN_CACHE_LIMIT;
  if (limit > 0) {
    if (ctx.forbiddenCache.size >= limit) {
      const deleteCount = Math.max(
        1,
        Math.floor(ctx.forbiddenCache.size * PHASE7_CONFIG.VCF_FORBIDDEN_CACHE_EVICTION_RATIO)
      );
      let deleted = 0;
      for (const cacheKey of ctx.forbiddenCache.keys()) {
        ctx.forbiddenCache.delete(cacheKey);
        deleted++;
        if (deleted >= deleteCount) break;
      }
    }
    ctx.forbiddenCache.set(key, result);
  }

  return result;
};

const isLegalVcf = (
  ctx: VcfContext,
  pos: Position,
  player: Player,
  isRootMove: boolean,
  hash: bigint
): boolean => {
  const { row, col } = pos;
  if (ctx.state.board[row][col] !== null) return false;

  // root の初手のみ UI 静的 forbiddenMoves を尊重する。
  // 再帰中は局面が変化しているため root 静的マスクは使わない。
  if (isRootMove && ctx.rootForbiddenMoves[row][col]) return false;

  if (player === 'Black' && ctx.ruleEnabled) {
    if (checkForbiddenCached(ctx, pos, player, hash)) return false;
  }

  return true;
};

/**
 * 即時勝ち手を探す。
 *
 * 即時勝ち手は五連完成手であり、Black でも禁手より優先される。
 * したがって wouldWin を先に確認し、root 静的マスクのみ追加で見る。
 */
const findImmediateWinMove = (
  ctx: VcfContext,
  player: Player,
  isRootMove: boolean
): Position | null => {
  const board = ctx.state.board;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null) continue;
      if (!hasStoneNearby(board, r, c)) continue;
      if (isRootMove && ctx.rootForbiddenMoves[r][c]) continue;

      const pos: Position = { row: r, col: c };
      if (wouldWin(board, pos, player)) {
        return pos;
      }
    }
  }

  return null;
};

/**
 * 着手 lastMove によって新たに生じた即時勝ちマスを列挙する。
 *
 * 新しい四は必ず lastMove を含むため、
 * lastMove を中心とした 4 方向・距離 4 以内だけを確認すれば十分。
 */
const collectWinSquaresAfterMove = (
  ctx: VcfContext,
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

const generateAttackerCandidates = (
  ctx: VcfContext,
  isRootMove: boolean,
  hash: bigint
): VcfCandidate[] => {
  const board = ctx.state.board;
  const lineCache = ctx.state.lineCache;
  const candidates: VcfCandidate[] = [];
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
        ctx.mover
      );

      const currentOrder = order;
      order++;

      if (counts.OPEN_FOUR === 0 && counts.CLOSED_FOUR === 0) {
        continue;
      }

      if (!isLegalVcf(ctx, pos, ctx.mover, isRootMove, hash)) {
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

const searchAttacker = (
  ctx: VcfContext,
  ply: number,
  hash: bigint
): VcfNodeResult => {
  ctx.nodes++;
  ctx.stats.vcf.rootNodes++;

  if (ctx.nodes > ctx.nodeLimit) {
    return { outcome: 'ABORTED', plyToWin: null, move: null, winKind: null };
  }

  if (isVcfTimeUp(ctx)) {
    return { outcome: 'ABORTED', plyToWin: null, move: null, winKind: null };
  }

  if (ply > ctx.maxPly) {
    return { outcome: 'FAIL', plyToWin: null, move: null, winKind: null };
  }

  if (ply > ctx.maxPlyReached) {
    ctx.maxPlyReached = ply;
    ctx.stats.vcf.rootMaxPlyReached = ply;
  }

  const isRoot = ply === 0;

  // 1. 即時勝ち
  const immediateWin = findImmediateWinMove(ctx, ctx.mover, isRoot);
  if (immediateWin) {
    ctx.stats.vcf.rootImmediateWins++;
    return {
      outcome: 'WIN',
      plyToWin: ply + 1,
      move: isRoot ? immediateWin : null,
      winKind: 'immediate',
    };
  }

  // 即時勝ちがなく、これ以上深く読めないなら失敗
  if (ply >= ctx.maxPly) {
    return { outcome: 'FAIL', plyToWin: null, move: null, winKind: null };
  }

  // 2. 四を作る攻撃手を生成
  const candidates = generateAttackerCandidates(ctx, isRoot, hash);

  for (const candidate of candidates) {
    const applied = applySearchMove(
      ctx.state,
      hash,
      candidate.pos,
      ctx.mover
    );

    try {
      // 3. 防御側の即時勝ち確認
      //
      // 攻撃側が四を作っても、防御側がその時点で即時勝ちを持っていれば
      // 防御側が先に勝つため、この攻撃枝は失敗。
      if (PHASE7_FEATURES.VCF_CHECK_DEFENDER_COUNTER_WIN) {
        const defenderImmediateWin = findImmediateWinMove(
          ctx,
          ctx.opponent,
          false
        );
        if (defenderImmediateWin) {
          ctx.stats.vcf.rootDefenderCounterWins++;
          continue;
        }
      }

      // 4. 攻撃側の即時勝ちマスを確認
      const winSquares = collectWinSquaresAfterMove(
        ctx,
        candidate.pos,
        ctx.mover
      );

      // 即時勝ちマスが 2 箇所以上 → 受け不可
      if (winSquares.length >= 2) {
        if (!PHASE7_FEATURES.VCF_ALLOW_OPEN_FOUR_TERMINAL) {
          continue;
        }
        ctx.stats.vcf.rootTerminalOpenFours++;
        return {
          outcome: 'WIN',
          plyToWin: ply + 2,
          move: isRoot ? candidate.pos : null,
          winKind: 'open-four-terminal',
        };
      }

      // 即時勝ちマスが 1 箇所 → 防御側はそのマスを防ぐ必要がある
      if (winSquares.length === 1) {
        const block = winSquares[0];

        // 防御側がブロックできない（Black 禁手など）なら勝ち
        if (!isLegalVcf(ctx, block, ctx.opponent, false, applied.nextHash)) {
          ctx.stats.vcf.rootIllegalBlockMoves++;
          return {
            outcome: 'WIN',
            plyToWin: ply + 2,
            move: isRoot ? candidate.pos : null,
            winKind: 'illegal-block',
          };
        }

        // 防御側の強制ブロック
        const blockApplied = applySearchMove(
          ctx.state,
          applied.nextHash,
          block,
          ctx.opponent
        );

        try {
          const child = searchAttacker(ctx, ply + 2, blockApplied.nextHash);

          if (child.outcome === 'WIN') {
            return {
              outcome: 'WIN',
              plyToWin: child.plyToWin,
              move: isRoot ? candidate.pos : null,
              winKind: child.winKind ?? 'forced',
            };
          }

          if (child.outcome === 'ABORTED') {
            return {
              outcome: 'ABORTED',
              plyToWin: null,
              move: null,
              winKind: null,
            };
          }

          // child FAIL → 他の攻撃手を試す
        } finally {
          undoSearchMove(ctx.state, blockApplied.undo);
        }
      }

      // winSquares.length === 0 は四として成立していないため失敗
    } finally {
      undoSearchMove(ctx.state, applied.undo);
    }
  }

  return { outcome: 'FAIL', plyToWin: null, move: null, winKind: null };
};

// ============================================================
// 公開 API
// ============================================================

export const runRootVcf = (
  req: RootVcfRequest,
  stats: SearchStats
): RootVcfResult => {
  const vcf = stats.vcf;
  const start = performance.now();

  vcf.rootCalls++;

  const makeResult = (
    outcome: RootVcfOutcome,
    move: Position | null,
    plyToWin: number | null,
    nodes: number,
    maxPlyReached: number,
    budgetMs: number,
    nodeLimit: number,
    reason: string | null
  ): RootVcfResult => {
    const timeMs = performance.now() - start;
    vcf.rootTimeMs = timeMs;
    vcf.rootBudgetMs = budgetMs;

    if (PHASE7_FEATURES.ENABLE_VCF_VERBOSE_LOG) {
      const moveText = move ? `(${move.row},${move.col})` : 'none';
      const plyText = plyToWin === null ? '-' : String(plyToWin);
      const reasonText = reason === null ? '-' : reason;

      console.log(
        `[VCF] root ${outcome} ` +
          `move=${moveText} ` +
          `ply=${plyText} ` +
          `nodes=${nodes} ` +
          `plyReached=${maxPlyReached} ` +
          `time=${timeMs.toFixed(1)}ms ` +
          `budget=${Math.round(budgetMs)}ms ` +
          `nodeLimit=${nodeLimit} ` +
          `reason=${reasonText}`
      );
    }

    return {
      outcome,
      move,
      plyToWin,
      nodes,
      maxPlyReached,
      timeMs,
      budgetMs,
      nodeLimit,
      reason,
    };
  };

  // ------------------------------------------------------------
  // 有効性チェック
  // ------------------------------------------------------------

  if (
    !PHASE7_FEATURES.ENABLE_VCF ||
    !PHASE7_FEATURES.ENABLE_ROOT_VCF
  ) {
    vcf.rootDisabled++;
    return makeResult('DISABLED', null, null, 0, 0, 0, 0, 'flag');
  }

  if (req.options?.vcfEnabled === false) {
    vcf.rootSkippedByOption++;
    return makeResult('SKIPPED', null, null, 0, 0, 0, 0, 'option');
  }

  if (req.stones < PHASE7_CONFIG.ROOT_VCF_MIN_STONES) {
    vcf.rootSkippedEarlyGame++;
    return makeResult('SKIPPED', null, null, 0, 0, 0, 0, 'early-game');
  }

  if (req.maxDepth < PHASE7_CONFIG.ROOT_VCF_MIN_MAX_DEPTH) {
    vcf.rootSkippedLowDepth++;
    return makeResult('SKIPPED', null, null, 0, 0, 0, 0, 'low-depth');
  }

  if (
    req.timeLimitMs !== null &&
    req.timeLimitMs < PHASE7_CONFIG.ROOT_VCF_MIN_TIME_LIMIT_MS
  ) {
    vcf.rootSkippedLowTime++;
    return makeResult('SKIPPED', null, null, 0, 0, 0, 0, 'low-time');
  }

  const budgetMs = resolveRootBudgetMs(req.options, req.timeLimitMs);
  const nodeLimit = resolveRootNodeLimit(req.options);

  if (budgetMs <= 0 || nodeLimit <= 0) {
    vcf.rootSkippedByOption++;
    return makeResult('SKIPPED', null, null, 0, 0, budgetMs, nodeLimit, 'budget');
  }

  vcf.rootBudgetMs = budgetMs;

  // ------------------------------------------------------------
  // VCF 探索本体
  // ------------------------------------------------------------

  try {
    const lineCache =
      AI_FEATURES.ENABLE_LINE_CACHE && PHASE7_FEATURES.VCF_USE_LINE_CACHE
        ? createLineCache(req.board)
        : null;

    // apply / undo 用の一時統計。
    // VCF 固有統計は req 側の stats に記録し、phase6 統計を汚さない。
    const ephemeralStats = createSearchStats(
      req.mover,
      'fixed',
      0,
      null,
      null
    );

    const state: SearchStateContainers = {
      board: req.board,
      lineCache,
      candidateSet: null,
      forbiddenMoves: req.forbiddenMoves,
      stats: ephemeralStats,
    };

    const initialHash = calculateInitialHash(req.board);

    const ctx: VcfContext = {
      state,
      mover: req.mover,
      opponent: opponentOf(req.mover),
      ruleEnabled: req.ruleEnabled,
      rootForbiddenMoves: req.forbiddenMoves,
      budgetMs,
      nodeLimit,
      maxPly: PHASE7_CONFIG.ROOT_VCF_MAX_PLY,
      startTime: start,
      nodes: 0,
      maxPlyReached: 0,
      forbiddenCache: new Map<bigint, boolean>(),
      stats,
    };

    const result = searchAttacker(ctx, 0, initialHash);

    if (PHASE7_FEATURES.ENABLE_VCF_STATE_AUDIT) {
      const afterStones = countStones(req.board);
      if (afterStones !== req.stones) {
        console.warn(
          `[VCF] state audit failed: before=${req.stones}, after=${afterStones}`
        );
      }
    }

    if (result.outcome === 'WIN') {
      if (!result.move) {
        vcf.rootFail++;
        return makeResult(
          'FAIL',
          null,
          null,
          ctx.nodes,
          ctx.maxPlyReached,
          budgetMs,
          nodeLimit,
          'no-root-move'
        );
      }

      vcf.rootFound++;

      return makeResult(
        'WIN',
        result.move,
        result.plyToWin,
        ctx.nodes,
        ctx.maxPlyReached,
        budgetMs,
        nodeLimit,
        result.winKind ?? 'forced'
      );
    }

    if (result.outcome === 'ABORTED') {
      vcf.rootAborted++;
      return makeResult(
        'ABORTED',
        null,
        null,
        ctx.nodes,
        ctx.maxPlyReached,
        budgetMs,
        nodeLimit,
        'budget-or-node-limit'
      );
    }

    vcf.rootFail++;
    return makeResult(
      'FAIL',
      null,
      null,
      ctx.nodes,
      ctx.maxPlyReached,
      budgetMs,
      nodeLimit,
      'no-vcf'
    );
  } catch (err) {
    vcf.rootError++;

    const message = err instanceof Error ? err.message : String(err);

    if (PHASE7_FEATURES.ENABLE_VCF_VERBOSE_LOG) {
      console.error('[VCF] root exception:', err);
    }

    return makeResult(
      'ERROR',
      null,
      null,
      stats.vcf.rootNodes,
      stats.vcf.rootMaxPlyReached,
      budgetMs,
      nodeLimit,
      message
    );
  }
};