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

import type { BoardState, Position, Player } from '../../types/game';
import type {
  KillerTable,
  HistoryTable,
  TTFlag,
  CountermoveTable,
  OrderedCandidate,
  LineCacheState,
  CandidateSetState,
  CandidateSetUndo,
} from '../../types/ai';
import { checkWin } from '../gameLogic';
import {
  AI_CONFIG,
  AI_SCORES,
  AI_FEATURES,
  LMR_CONFIG,
  PVS_CONFIG,
} from './constants';
import { opponentOf } from './evaluator';
import { evaluateBoard, evaluateBoardWithCache } from './boardEvaluator';
import {
  CRITICAL_SCORE_THRESHOLD,
  createKillerTable,
  createHistoryTable,
  createCountermoveTable,
  createCandidateSet,
  applyCandidateSet,
  undoCandidateSet,
  storeKiller,
  storeHistory,
  storeCountermove,
  generateOrderedCandidates,
} from './candidateGenerator';
import { TranspositionTable } from './transpositionTable';
import { calculateInitialHash, updateHash } from './zobrist';
import {
  createLineCache,
  updateLineCache,
  undoLineCache,
} from './lineCache';

// ============================================================
// SearchContext
// ============================================================

/**
 * 探索コンテキスト。探索木全体を通じて共有される状態をまとめる。
 */
interface SearchContext {
  aiPlayer: Player;
  forbiddenMoves: boolean[][];
  killerTable: KillerTable;

  /** history heuristic 用テーブル。generateOrderedCandidates の REST tier 内ソートの補助に使う */
  historyTable: HistoryTable;

  /** countermove heuristic 用テーブル。直前手に対する応手を記録する */
  countermoveTable: CountermoveTable;

  /** 第3弾: 差分ラインキャッシュ。無効時は null */
  lineCache: LineCacheState | null;

  /** 第3弾: 候補集合の増分管理。無効時は null */
  candidateSet: CandidateSetState | null;

  /** 探索打ち切り時刻（performance.now() 基準の絶対時刻 [ms]）。Infinity なら時間制御なし */
  deadline: number;

  /** Transposition Table（置換表）。反復深化の全深さで共有する */
  tt: TranspositionTable;

  /**
   * 時間切れなどで探索が中断されたかどうか。
   * true の場合、不完全な結果を TT に保存してはならない。
   */
  aborted: boolean;
}

const createSearchContext = (
  board: BoardState,
  aiPlayer: Player,
  forbiddenMoves: boolean[][],
  deadline: number = Infinity,
  tt: TranspositionTable
): SearchContext => ({
  aiPlayer,
  forbiddenMoves,
  killerTable: createKillerTable(),
  historyTable: createHistoryTable(),
  countermoveTable: createCountermoveTable(),
  lineCache: AI_FEATURES.ENABLE_LINE_CACHE ? createLineCache(board) : null,
  candidateSet: AI_FEATURES.ENABLE_INCREMENTAL_CANDIDATES
    ? createCandidateSet(board, forbiddenMoves)
    : null,
  deadline,
  tt,
  aborted: false,
});

/**
 * 時間切れ判定。
 * 一度でも時間切れを検知したら ctx.aborted = true を設定し、
 * 以降の探索結果が TT に保存されないようにする。
 */
const isTimeUp = (ctx: SearchContext): boolean => {
  if (ctx.aborted) return true;

  if (ctx.deadline !== Infinity && performance.now() >= ctx.deadline) {
    ctx.aborted = true;
    return true;
  }

  return false;
};

// ============================================================
// 着手 / 復元ヘルパー（第3弾）
// ============================================================

/**
 * board / LineCache / CandidateSet を一括で着手状態へ進める。
 * Zobrist hash は呼び出し側で updateHash する。
 */
const applyMove = (
  ctx: SearchContext,
  board: BoardState,
  row: number,
  col: number,
  player: Player
): CandidateSetUndo | null => {
  board[row][col] = player;

  if (ctx.lineCache) {
    updateLineCache(ctx.lineCache, row, col, player);
  }

  if (ctx.candidateSet) {
    return applyCandidateSet(ctx.candidateSet, board, ctx.forbiddenMoves, row, col);
  }

  return null;
};

/**
 * applyMove の逆操作。
 * board を空に戻してから LineCache / CandidateSet を復元する。
 */
const undoMove = (
  ctx: SearchContext,
  board: BoardState,
  row: number,
  col: number,
  player: Player,
  candidateUndo: CandidateSetUndo | null
): void => {
  board[row][col] = null;

  if (ctx.lineCache) {
    undoLineCache(ctx.lineCache, { row, col, player });
  }

  if (ctx.candidateSet && candidateUndo) {
    undoCandidateSet(ctx.candidateSet, candidateUndo);
  }
};

/**
 * 葉ノード評価。LineCache があれば cache 版を使う。
 */
const evaluateLeaf = (
  board: BoardState,
  ctx: SearchContext
): number => {
  if (ctx.lineCache) {
    return evaluateBoardWithCache(
      board,
      ctx.lineCache,
      ctx.aiPlayer,
      ctx.forbiddenMoves,
      ctx.candidateSet
    );
  }

  return evaluateBoard(board, ctx.aiPlayer, ctx.forbiddenMoves);
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
 */
const getReduction = (
  depth: number,
  moveIndex: number,
  flags: OrderedCandidate['flags'],
  isRoot: boolean
): number => {
  if (!AI_FEATURES.ENABLE_LMR) return 0;
  if (isRoot && !LMR_CONFIG.ALLOW_ROOT) return 0;
  if (depth < LMR_CONFIG.MIN_DEPTH) return 0;
  if (moveIndex < LMR_CONFIG.MIN_MOVE_INDEX) return 0;
  if (!flags.reductionAllowed) return 0;

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
    return evaluateLeaf(board, ctx);
  }

  // --- Transposition Table Lookup ---
  const alphaOrig = alpha;
  const betaOrig = beta;

  const ttScore = ctx.tt.lookup(currentHash, depth, alpha, beta);
  if (ttScore !== null) {
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
    ctx.candidateSet
  );

  // 候補なし（盤面満杯等）→ 葉ノード評価にフォールバック
  if (candidates.length === 0) {
    return evaluateLeaf(board, ctx);
  }

  let bestMove: Position | null = null;

  if (isMaximizing) {
    let maxScore = -Infinity;
    let ttStoreDepth = depth;

    for (let moveIndex = 0; moveIndex < candidates.length; moveIndex++) {
      if (isTimeUp(ctx)) break;

      const { pos, score: moveScore, flags } = candidates[moveIndex];
      const { row, col } = pos;

      const candidateUndo = applyMove(ctx, board, row, col, currentPlayer);
      const nextHash = updateHash(currentHash, row, col, currentPlayer);
      const currentMove: Position = { row, col };

      // 即時勝利検出
      if (checkWin(board, currentMove, ctx.aiPlayer)) {
        undoMove(ctx, board, row, col, currentPlayer, candidateUndo);
        return AI_SCORES.WIN;
      }

      let reduction = getReduction(depth, moveIndex, flags, isRoot);

      // null-window 探索は alpha が有限でないと安全に使えない。
      const canNull = Number.isFinite(alpha);
      if (reduction > 0 && !canNull) {
        reduction = 0;
      }

      const usePvsNull =
        AI_FEATURES.ENABLE_PVS &&
        moveIndex > 0 &&
        canNull &&
        !(isRoot && !PVS_CONFIG.ENABLE_ROOT_PVS);

      let score: number;

      if (usePvsNull || reduction > 0) {
        const childDepth = Math.max(0, depth - 1 - reduction);
        const nullBeta = alpha + 1;

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
          undoMove(ctx, board, row, col, currentPlayer, candidateUndo);
          return score;
        }

        // fail-high: 通常深度・通常ウィンドウで再探索
        if (score > alpha) {
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
            undoMove(ctx, board, row, col, currentPlayer, candidateUndo);
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
          undoMove(ctx, board, row, col, currentPlayer, candidateUndo);
          return score;
        }
      }

      undoMove(ctx, board, row, col, currentPlayer, candidateUndo);

      if (score > maxScore) {
        maxScore = score;
        bestMove = currentMove;
      }

      if (score > alpha) alpha = score;

      // β カットオフ: CRITICAL 未満の手のみ killer / history / countermove に記録
      if (beta <= alpha) {
        if (moveScore < CRITICAL_SCORE_THRESHOLD) {
          storeKiller(ctx.killerTable, depth, currentMove);
          storeHistory(ctx.historyTable, currentPlayer, depth, currentMove);

          if (AI_FEATURES.ENABLE_COUNTERMOVE && lastMove) {
            storeCountermove(
              ctx.countermoveTable,
              currentPlayer,
              lastMove,
              currentMove
            );
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

      const candidateUndo = applyMove(ctx, board, row, col, currentPlayer);
      const nextHash = updateHash(currentHash, row, col, currentPlayer);
      const currentMove: Position = { row, col };

      // 即時勝利検出（相手視点）
      if (checkWin(board, currentMove, currentPlayer)) {
        undoMove(ctx, board, row, col, currentPlayer, candidateUndo);
        return -AI_SCORES.WIN;
      }

      let reduction = getReduction(depth, moveIndex, flags, isRoot);

      // null-window 探索は beta が有限でないと安全に使えない。
      const canNull = Number.isFinite(beta);
      if (reduction > 0 && !canNull) {
        reduction = 0;
      }

      const usePvsNull =
        AI_FEATURES.ENABLE_PVS &&
        moveIndex > 0 &&
        canNull &&
        !(isRoot && !PVS_CONFIG.ENABLE_ROOT_PVS);

      let score: number;

      if (usePvsNull || reduction > 0) {
        const childDepth = Math.max(0, depth - 1 - reduction);
        const nullAlpha = beta - 1;

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
          undoMove(ctx, board, row, col, currentPlayer, candidateUndo);
          return score;
        }

        // fail-low: 通常深度・通常ウィンドウで再探索
        if (score < beta) {
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
            undoMove(ctx, board, row, col, currentPlayer, candidateUndo);
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
          undoMove(ctx, board, row, col, currentPlayer, candidateUndo);
          return score;
        }
      }

      undoMove(ctx, board, row, col, currentPlayer, candidateUndo);

      if (score < minScore) {
        minScore = score;
        bestMove = currentMove;
      }

      if (score < beta) beta = score;

      // α カットオフ: CRITICAL 未満の手のみ killer / history / countermove に記録
      if (beta <= alpha) {
        if (moveScore < CRITICAL_SCORE_THRESHOLD) {
          storeKiller(ctx.killerTable, depth, currentMove);
          storeHistory(ctx.historyTable, currentPlayer, depth, currentMove);

          if (AI_FEATURES.ENABLE_COUNTERMOVE && lastMove) {
            storeCountermove(
              ctx.countermoveTable,
              currentPlayer,
              lastMove,
              currentMove
            );
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
  lastMove: Position | null = null
): FindBestMoveResult => {
  const ctx = createSearchContext(board, aiPlayer, forbiddenMoves, deadline, tt);

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
    ctx.candidateSet
  );

  if (candidates.length === 0) {
    return { move: null, score: -Infinity };
  }

  let bestPos: Position = candidates[0].pos;
  let bestScore = -Infinity;

  // original window を保持し、最終的な TT flag 判定に使う。
  const alphaOrig = initialAlpha;
  const betaOrig = initialBeta;

  let alpha = initialAlpha;
  const beta = initialBeta;

  console.log(
    `[Minimax] depth=${depth}, candidates=${candidates.length}, player=${aiPlayer}, ` +
    `window=[${alpha}, ${beta}], ttSize=${tt.size}`
  );

  for (let moveIndex = 0; moveIndex < candidates.length; moveIndex++) {
    // 時間切れ: ルート候補を全て評価しきれていないため、この深さの結果は不採用とする
    if (isTimeUp(ctx)) {
      console.log(`[Minimax] depth=${depth} timed out before completion`);
      return { move: null, score: -Infinity };
    }

    const { pos } = candidates[moveIndex];
    const { row, col } = pos;

    const candidateUndo = applyMove(ctx, board, row, col, aiPlayer);
    const nextHash = updateHash(initialHash, row, col, aiPlayer);
    const currentMove: Position = { row, col };

    // ルートノード即時勝利（1 手詰め検出）
    if (checkWin(board, currentMove, aiPlayer)) {
      undoMove(ctx, board, row, col, aiPlayer, candidateUndo);
      console.log(`[Minimax] Immediate Win at (${row}, ${col})`);
      return { move: currentMove, score: AI_SCORES.WIN };
    }

    let score: number;

    const useRootPvsNull =
      AI_FEATURES.ENABLE_PVS &&
      PVS_CONFIG.ENABLE_ROOT_PVS &&
      moveIndex > 0 &&
      Number.isFinite(alpha);

    if (useRootPvsNull) {
      const nullBeta = alpha + 1;

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
        undoMove(ctx, board, row, col, aiPlayer, candidateUndo);
        console.log(`[Minimax] depth=${depth} aborted during child search`);
        return { move: null, score: -Infinity };
      }

      // fail-high: full window で再探索
      if (score > alpha) {
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
          undoMove(ctx, board, row, col, aiPlayer, candidateUndo);
          console.log(`[Minimax] depth=${depth} aborted during child search`);
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
        undoMove(ctx, board, row, col, aiPlayer, candidateUndo);
        console.log(`[Minimax] depth=${depth} aborted during child search`);
        return { move: null, score: -Infinity };
      }
    }

    undoMove(ctx, board, row, col, aiPlayer, candidateUndo);

    if (score > bestScore) {
      bestScore = score;
      bestPos = currentMove;
    }

    // ルート α を更新して子ノードの枝刈り効率を高める
    if (score > alpha) alpha = score;

    // ルートで fail-high。
    if (alpha >= beta) {
      ctx.tt.store(initialHash, depth, bestScore, 'LOWERBOUND', bestPos);

      console.log(
        `[Minimax] depth=${depth} fail-high: alpha=${alpha}, beta=${beta}, ` +
        `best=(${bestPos.row}, ${bestPos.col}), score=${bestScore}`
      );

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

  console.log(
    `[Minimax] best=(${bestPos.row}, ${bestPos.col}), score=${bestScore}, flag=${flag}`
  );

  return { move: bestPos, score: bestScore };
};