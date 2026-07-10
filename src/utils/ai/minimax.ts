// src/utils/ai/minimax.ts
// ミニマックス探索エンジン
//
// 責務:
//   - SearchContext による探索状態の一元管理
//   - αβ 枝刈り付きミニマックス再帰
//   - 公開 API: findBestMove
//
// 候補手生成・move ordering → candidateGenerator.ts
// 葉ノード盤面評価          → boardEvaluator.ts
//
// 【将来の拡張ポイント】
//   - transposition table: SearchContext に TTMap を追加
//   - aspiration window:   ルート alpha/beta を SearchContext で管理

import type { BoardState, Position, Player } from '../../types/game';
import { checkWin } from '../gameLogic';
import { AI_CONFIG, AI_SCORES } from './constants';
import { opponentOf } from './evaluator';
import { evaluateBoard } from './boardEvaluator';
import {
  type KillerTable,
  CRITICAL_SCORE_THRESHOLD,
  createKillerTable,
  storeKiller,
  generateOrderedCandidates,
} from './candidateGenerator';


// ============================================================
// SearchContext
// ============================================================

/**
 * 探索コンテキスト。
 * 探索木全体を通じて共有される状態をまとめる。
 *
 * 【将来の拡張フィールド例】
 *   transpositionTable : Map<bigint, TTEntry>   … 置換表
 *   zobristHash        : ZobristHasher           … 差分ハッシュ計算器
 *   nodeCount          : number                  … 評価ノード数カウンタ
 *   historyTable       : number[][][]            … history heuristic カウンタ
 */
interface SearchContext {
  aiPlayer: Player;
  forbiddenMoves: boolean[][];
  killerTable: KillerTable;
  /**
   * 探索打ち切り時刻（performance.now() 基準の絶対時刻 [ms]）。
   * Infinity の場合は時間制御なし（従来通り depth 固定探索）。
   */
  deadline: number;
}

const createSearchContext = (
  aiPlayer: Player,
  forbiddenMoves: boolean[][],
  deadline: number = Infinity
): SearchContext => ({
  aiPlayer,
  forbiddenMoves,
  killerTable: createKillerTable(),
  deadline,
});

/** 探索打ち切り時刻を超過しているか判定する */
const isTimeUp = (ctx: SearchContext): boolean =>
  ctx.deadline !== Infinity && performance.now() >= ctx.deadline;


// ============================================================
// ミニマックス探索本体
// ============================================================

/**
 * αβ 枝刈り付きミニマックス探索。
 *
 * この関数は「探索・αβ・再帰制御」に専念する。
 * 候補手生成は candidateGenerator、葉ノード評価は boardEvaluator に委譲する。
 *
 * @param board          現在の盤面（in-place 変更・復元）
 * @param depth          残り探索深さ（0 = 葉ノード）
 * @param isMaximizing   true = AI 手番 / false = 相手手番
 * @param currentPlayer  現在の手番プレイヤー
 * @param ctx            探索コンテキスト（killer table 等を共有）
 * @param alpha          最大化側の現時点下限保証値
 * @param beta           最小化側の現時点上限保証値
 * @returns              aiPlayer 視点のスコア
 */
const minimax = (
  board: BoardState,
  depth: number,
  isMaximizing: boolean,
  currentPlayer: Player,
  ctx: SearchContext,
  alpha: number,
  beta: number
): number => {
  // 葉ノード: 全盤評価（多重脅威対応の重み付き和）
  if (depth === 0) {
    return evaluateBoard(board, ctx.aiPlayer, ctx.forbiddenMoves);
  }

  const candidates = generateOrderedCandidates(
    board,
    currentPlayer,
    ctx.forbiddenMoves,
    ctx.killerTable,
    depth
  );

  // 候補なし（盤面満杯等）→ 葉ノード評価にフォールバック
  if (candidates.length === 0) {
    return evaluateBoard(board, ctx.aiPlayer, ctx.forbiddenMoves);
  }

  if (isMaximizing) {
    let maxScore = -Infinity;

    for (const { pos, score: moveScore } of candidates) {
      // 時間切れ: この時点までに評価した中での暫定値で探索を打ち切る
      if (isTimeUp(ctx)) break;

      const { row, col } = pos;
      board[row][col] = currentPlayer;

      // 即時勝利判定（AI の勝利）
      if (checkWin(board, { row, col }, ctx.aiPlayer)) {
        board[row][col] = null;
        return AI_SCORES.WIN;
      }

      const score = minimax(
        board,
        depth - 1,
        false,
        opponentOf(currentPlayer),
        ctx,
        alpha,
        beta
      );
      board[row][col] = null;

      if (score > maxScore) maxScore = score;
      if (score > alpha) alpha = score;

      // β カットオフ: CRITICAL 未満の手のみ killer に記録
      if (beta <= alpha) {
        if (moveScore < CRITICAL_SCORE_THRESHOLD) {
          storeKiller(ctx.killerTable, depth, { row, col });
        }
        break;
      }
    }

    return maxScore;
  } else {
    let minScore = Infinity;

    for (const { pos, score: moveScore } of candidates) {
      // 時間切れ: この時点までに評価した中での暫定値で探索を打ち切る
      if (isTimeUp(ctx)) break;

      const { row, col } = pos;
      board[row][col] = currentPlayer;

      // 即時勝利判定（相手の勝利 = AI にとっての最悪値）
      if (checkWin(board, { row, col }, currentPlayer)) {
        board[row][col] = null;
        return -AI_SCORES.WIN;
      }

      const score = minimax(
        board,
        depth - 1,
        true,
        opponentOf(currentPlayer),
        ctx,
        alpha,
        beta
      );
      board[row][col] = null;

      if (score < minScore) minScore = score;
      if (score < beta) beta = score;

      // α カットオフ: CRITICAL 未満の手のみ killer に記録
      if (beta <= alpha) {
        if (moveScore < CRITICAL_SCORE_THRESHOLD) {
          storeKiller(ctx.killerTable, depth, { row, col });
        }
        break;
      }
    }

    return minScore;
  }
};


// ============================================================
// 公開 API
// ============================================================

/**
 * ミニマックス探索で最善手を求めて返す。
 *
 * search.ts から呼び出される唯一の公開関数。
 * search.ts 側の反復深化ループから depth=1,2,3... と繰り返し呼び出される想定。
 *
 * 【時間制御】
 * deadline（performance.now() 基準の絶対時刻）を指定すると、
 * 探索中に時間切れを検知した時点で安全に打ち切る。
 * その場合、ルート候補を最後まで評価しきれていなければ
 * 「この深さの探索は不完全」とみなし null を返す。
 * 呼び出し元（search.ts）は null を受け取った場合、
 * 直前の深さで得られた完全な結果を採用する。
 *
 * 【将来の拡張ポイント: aspiration window】
 * 前回 depth の bestScore を基に初期 [α, β] を絞り込み、
 * fail high/low 時に window を広げて再探索。
 * ルートループの alpha / beta を SearchContext 管理にすることで実装できる。
 *
 * @param board          現在の盤面
 * @param forbiddenMoves 禁じ手マップ（探索中は静的として扱う）
 * @param aiPlayer       AI のプレイヤー
 * @param depth          探索深さ（デフォルト: AI_CONFIG.MINIMAX_DEPTH）
 * @param deadline       探索打ち切り時刻（performance.now() 基準、未指定時は無制限）
 * @returns              最善手の Position。候補なし、または時間切れで
 *                        この深さの探索を完了できなかった場合は null
 */
export const findBestMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  aiPlayer: Player,
  depth: number = AI_CONFIG.MINIMAX_DEPTH,
  deadline: number = Infinity
): Position | null => {
  const ctx = createSearchContext(aiPlayer, forbiddenMoves, deadline);
  const candidates = generateOrderedCandidates(
    board,
    aiPlayer,
    forbiddenMoves,
    ctx.killerTable,
    depth
  );
  if (candidates.length === 0) return null;

  let bestPos: Position = candidates[0].pos;
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  console.log(
    `[Minimax] depth=${depth}, candidates=${candidates.length}, player=${aiPlayer}`
  );

  for (const { pos } of candidates) {
    // 時間切れ: ルート候補を全て評価しきれていないため、この深さの結果は不採用とする
    if (isTimeUp(ctx)) {
      console.log(`[Minimax] depth=${depth} timed out before completion`);
      return null;
    }

    const { row, col } = pos;
    board[row][col] = aiPlayer;

    // ルートノード即時勝利（1 手詰め検出）
    if (checkWin(board, { row, col }, aiPlayer)) {
      board[row][col] = null;
      console.log(`[Minimax] Immediate Win at (${row}, ${col})`);
      return { row, col };
    }

    const score = minimax(
      board,
      depth - 1,
      false,
      opponentOf(aiPlayer),
      ctx,
      alpha,
      beta
    );
    board[row][col] = null;

    if (score > bestScore) {
      bestScore = score;
      bestPos = { row, col };
    }
    // ルート α を更新して子ノードの枝刈り効率を高める
    if (score > alpha) alpha = score;
  }

  console.log(
    `[Minimax] best=(${bestPos.row}, ${bestPos.col}), score=${bestScore}`
  );
  return bestPos;
};