// src/utils/ai/minimax.ts
// ミニマックス探索エンジン
// - search.ts から呼び出される独立した探索モジュール
// - αβ枝刈り・move ordering・将来的なキャッシュ導入を前提とした構造

import type { BoardState, Position, Player } from '../../types/game';
import { BOARD_SIZE, checkWin } from '../gameLogic';
import { AI_CONFIG, AI_SCORES } from './constants';
import { evaluatePosition } from './evaluator';

// ============================================================
// 内部ユーティリティ
// ============================================================

/** 相手プレイヤーを返す */
const opponentOf = (player: Player): Player =>
  player === 'Black' ? 'White' : 'Black';

/**
 * 指定セルの周辺（SEARCH_RANGE 以内）に石があるか判定
 * 候補手生成の絞り込みに使用する
 */
const hasStoneNearby = (board: BoardState, row: number, col: number): boolean => {
  const range = AI_CONFIG.SEARCH_RANGE;
  for (
    let r = Math.max(0, row - range);
    r <= Math.min(BOARD_SIZE - 1, row + range);
    r++
  ) {
    for (
      let c = Math.max(0, col - range);
      c <= Math.min(BOARD_SIZE - 1, col + range);
      c++
    ) {
      if (board[r][c] !== null) return true;
    }
  }
  return false;
};

/**
 * 候補手を生成し、evaluatePosition スコア降順でソートして返す
 *
 * 【Move Ordering の意図】
 * 評価の高い手を先に試すことで、αβ枝刈り導入後の
 * カットオフ発生率が高まり、探索ノード数が大幅に削減される。
 * 現時点でも候補を絞り込む効果がある。
 *
 * 【MAX_CANDIDATES による打ち切り】
 * 上位 N 手のみ探索対象とすることで、探索空間を制御する。
 * 将来の反復深化・動的候補調整への差し替え口として機能する。
 */
const generateOrderedCandidates = (
  board: BoardState,
  player: Player,
  forbiddenMoves: boolean[][]
): Position[] => {
  const candidates: Position[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (
        board[r][c] === null &&
        !forbiddenMoves[r][c] &&
        hasStoneNearby(board, r, c)
      ) {
        candidates.push({ row: r, col: c });
      }
    }
  }

  if (candidates.length === 0) return candidates;

  // move ordering: evaluatePosition スコア降順
  candidates.sort(
    (a, b) =>
      evaluatePosition(board, b.row, b.col, player) -
      evaluatePosition(board, a.row, a.col, player)
  );

  // 上位 MAX_CANDIDATES 手に絞り込む
  return candidates.slice(0, AI_CONFIG.MAX_CANDIDATES);
};

/**
 * 葉ノード盤面評価（depth === 0 到達時）
 *
 * evaluatePosition は「ある位置への着手価値」を返す関数なので、
 * 盤面全体のスコアを「AIの最善着手スコア − 相手の最善着手スコア」で近似する。
 *
 * 将来的に全盤面を走査する専用評価関数（evaluate(board): number）が
 * 用意された場合は、この関数をそちらに差し替えるだけでよい。
 */
const evaluateLeaf = (
  board: BoardState,
  aiPlayer: Player,
  forbiddenMoves: boolean[][]
): number => {
  const opp = opponentOf(aiPlayer);
  let aiMax = -Infinity;
  let oppMax = -Infinity;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (
        board[r][c] === null &&
        !forbiddenMoves[r][c] &&
        hasStoneNearby(board, r, c)
      ) {
        const aiScore = evaluatePosition(board, r, c, aiPlayer);
        const oppScore = evaluatePosition(board, r, c, opp);
        if (aiScore > aiMax) aiMax = aiScore;
        if (oppScore > oppMax) oppMax = oppScore;
      }
    }
  }

  // 候補手がない（盤面が満杯等）場合は引き分け扱い
  const aiVal = aiMax === -Infinity ? 0 : aiMax;
  const oppVal = oppMax === -Infinity ? 0 : oppMax;
  return aiVal - oppVal;
};

// ============================================================
// ミニマックス探索本体
// ============================================================

/**
 * ミニマックス探索（αβ枝刈り対応済み構造）
 *
 * @param board          現在の盤面（探索中は in-place で変更・復元する）
 * @param depth          残り探索深さ（0 で葉ノード評価）
 * @param isMaximizing   true = AI手番（スコア最大化）/ false = 相手手番（最小化）
 * @param currentPlayer  現在の手番プレイヤー
 * @param aiPlayer       最大化側プレイヤー（スコアの基準）
 * @param forbiddenMoves 禁じ手マップ（探索中も全ノードで適用）
 * @param alpha          最大化側の現時点下限保証値（αβ枝刈り用）
 * @param beta           最小化側の現時点上限保証値（αβ枝刈り用）
 * @returns              このノードのスコア（aiPlayer 視点）
 */
const minimax = (
  board: BoardState,
  depth: number,
  isMaximizing: boolean,
  currentPlayer: Player,
  aiPlayer: Player,
  forbiddenMoves: boolean[][],
  alpha: number,
  beta: number
): number => {
  // 葉ノード：盤面評価を返す
  if (depth === 0) {
    return evaluateLeaf(board, aiPlayer, forbiddenMoves);
  }

  const candidates = generateOrderedCandidates(board, currentPlayer, forbiddenMoves);

  // 候補手なし（盤面が満杯等）→ 葉ノード評価にフォールバック
  if (candidates.length === 0) {
    return evaluateLeaf(board, aiPlayer, forbiddenMoves);
  }

  if (isMaximizing) {
    let maxScore = -Infinity;

    for (const { row, col } of candidates) {
      // 手を仮置き
      board[row][col] = currentPlayer;

      // 着手直後の即時勝利判定（AIの勝利）
      if (checkWin(board, { row, col }, aiPlayer)) {
        board[row][col] = null; // 必ず巻き戻す
        return AI_SCORES.WIN;
      }

      const score = minimax(
        board,
        depth - 1,
        false,
        opponentOf(currentPlayer),
        aiPlayer,
        forbiddenMoves,
        alpha,
        beta
      );
      // 手を巻き戻し
      board[row][col] = null;

      if (score > maxScore) maxScore = score;
      if (score > alpha) alpha = score;
      // β カットオフ
      if (beta <= alpha) break;
    }

    return maxScore;
  } else {
    let minScore = Infinity;

    for (const { row, col } of candidates) {
      // 手を仮置き
      board[row][col] = currentPlayer;

      // 着手直後の即時勝利判定（相手の勝利 = AIにとっての最悪値）
      if (checkWin(board, { row, col }, currentPlayer)) {
        board[row][col] = null; // 必ず巻き戻す
        return -AI_SCORES.WIN;
      }

      const score = minimax(
        board,
        depth - 1,
        true,
        opponentOf(currentPlayer),
        aiPlayer,
        forbiddenMoves,
        alpha,
        beta
      );
      // 手を巻き戻し
      board[row][col] = null;

      if (score < minScore) minScore = score;
      if (score < beta) beta = score;
      // α カットオフ
      if (beta <= alpha) break;
    }

    return minScore;
  }
};

// ============================================================
// 公開 API
// ============================================================

/**
 * ミニマックス探索で最善手を求めて返す
 *
 * search.ts から呼び出される唯一の公開関数。
 * ルートノードの探索を行い、最もスコアの高い Position を返す。
 *
 * @param board          現在の盤面
 * @param forbiddenMoves 禁じ手マップ
 * @param aiPlayer       AI のプレイヤー
 * @param depth          探索深さ（デフォルト: AI_CONFIG.MINIMAX_DEPTH）
 * @returns              最善手の Position、候補なしの場合は null
 */
export const findBestMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  aiPlayer: Player,
  depth: number = AI_CONFIG.MINIMAX_DEPTH
): Position | null => {
  const candidates = generateOrderedCandidates(board, aiPlayer, forbiddenMoves);
  if (candidates.length === 0) return null;

  let bestPos: Position = candidates[0]; // 候補がある限り必ず返す
  let bestScore = -Infinity;
  // ルートではβカットオフしない（全候補の中から実際の最善手を確定するため）
  let alpha = -Infinity;
  const beta = Infinity;

  console.log(`[Minimax] depth=${depth}, candidates=${candidates.length}, player=${aiPlayer}`);

  for (const { row, col } of candidates) {
    board[row][col] = aiPlayer;

    // ルートノードでの即時勝利判定（1手詰め検出）
    if (checkWin(board, { row, col }, aiPlayer)) {
      board[row][col] = null;
      console.log(`[Minimax] Immediate Win Found at (${row}, ${col})`);
      return { row, col };
    }

    const score = minimax(
      board,
      depth - 1,
      false,
      opponentOf(aiPlayer),
      aiPlayer,
      forbiddenMoves,
      alpha,
      beta
    );
    board[row][col] = null;

    if (score > bestScore) {
      bestScore = score;
      bestPos = { row, col };
    }
    // ルートのαを更新し、子ノードの枝刈り効率を高める
    if (score > alpha) alpha = score;
  }

  console.log(`[Minimax] best=(${bestPos.row}, ${bestPos.col}), score=${bestScore}`);
  return bestPos;
};