// src/utils/ai/search.ts
// AIの次の一手を計算するロジックを定義するファイル
//
// 初手処理（盤面空き → 中央）、反復深化（iterative deepening）ループの制御、
// findBestMove の呼び出しと結果の返却を担う。
// 探索ロジック本体（αβ・move ordering・評価関数）は minimax.ts 以下に完全委譲し、
// このファイルは "薄いアダプタ" として常に軽量に保つ。

import type { BoardState, Position, Player } from '../../types/game';
import type { SearchOptions } from '../../types/ai';
import { BOARD_SIZE } from '../gameLogic';
import { AI_CONFIG } from './constants';
import { findBestMove } from './minimax';


/**
 * AIの次の一手を計算して返す。
 *
 * 公開インターフェース: この関数のシグネチャは変更禁止。
 *
 * options が一切指定されなかった場合は AI_CONFIG.MINIMAX_DEPTH /
 * AI_CONFIG.DEFAULT_TIME_LIMIT_MS をデフォルト値として使用する。
 *
 * 【反復深化（iterative deepening）】
 * options.timeLimitMs が指定された場合、depth=1,2,3... と深さを1ずつ増やしながら
 * findBestMove を繰り返し呼び出す。各深さの探索は制限時間内に完了した場合のみ結果を
 * 採用し、時間切れで途中終了した深さの結果（findBestMove が null を返す）は破棄する。
 * 最終的に「時間内に完全に探索できた最後の深さ」の結果を返す。
 *
 * options.timeLimitMs が未指定の場合は options.depth（未指定時は AI_CONFIG.MINIMAX_DEPTH）
 * による固定深さ探索を行う。
 */
export const calculateNextMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  currentTurn: Player,
  options?: SearchOptions
): Position | null => {
  const isBoardEmpty = board.flat().every((cell) => cell === null);

  // 初手は中央
  if (isBoardEmpty) {
    const center = Math.floor(BOARD_SIZE / 2);
    return { row: center, col: center };
  }

  // 呼び出し側が depth のみ・timeLimitMs のみを個別指定した場合はそちらを優先する
  const resolvedOptions: SearchOptions =
    options ?? {
      depth: AI_CONFIG.MINIMAX_DEPTH,
      timeLimitMs: AI_CONFIG.DEFAULT_TIME_LIMIT_MS,
    };

  const maxDepth = resolvedOptions.depth ?? AI_CONFIG.MINIMAX_DEPTH;

  // --- timeLimitMs 未指定: 従来通りの固定深さ探索 ---
  if (resolvedOptions.timeLimitMs === undefined) {
    const best = findBestMove(board, forbiddenMoves, currentTurn, maxDepth);

    if (best) {
      console.log(
        `AI selected: (${best.row}, ${best.col}) via minimax depth=${maxDepth} (turn: ${currentTurn})`
      );
    }

    return best;
  }

  // --- timeLimitMs 指定: 反復深化（iterative deepening） ---
  const deadline = performance.now() + resolvedOptions.timeLimitMs;

  let best: Position | null = null;
  let completedDepth = 0;

  for (let d = 1; d <= maxDepth; d++) {
    // depth=1 は時間制限なしで探索し、極端に短い timeLimitMs でも AI が無反応にならない保証とする
    const candidate =
      d === 1
        ? findBestMove(board, forbiddenMoves, currentTurn, d)
        : findBestMove(board, forbiddenMoves, currentTurn, d, deadline);

    // null = この深さは時間切れで未完了。直前の完全な結果を採用して打ち切る。
    if (!candidate) break;

    best = candidate;
    completedDepth = d;

    // 次の深さに進む余地がなければここで打ち切る（deadline 超過分の探索呼び出しを避ける）
    if (performance.now() >= deadline) break;
  }

  if (best) {
    console.log(
      `AI selected: (${best.row}, ${best.col}) via iterative deepening ` +
        `completedDepth=${completedDepth}/${maxDepth} (turn: ${currentTurn})`
    );
  }

  return best;
};