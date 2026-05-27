// src/utils/ai/search.ts
// AIの次の一手を計算するロジックを定義するファイル
//
// 責務:
//   - 初手処理（盤面空き → 中央）
//   - findBestMove の呼び出しと結果の返却
//   - iterative deepening・時間制御のエントリポイント（将来）
//
// 探索ロジックは minimax.ts に完全委譲している。
// このファイルは "薄いアダプタ" として常に軽量に保つ。

import type { BoardState, Position, Player } from '../../types/game';
import { BOARD_SIZE } from '../gameLogic';
import { AI_CONFIG } from './constants';
import type { SearchOptions } from './constants';
import { findBestMove } from './minimax';


/**
 * AIの次の一手を計算して返す。
 *
 * 公開インターフェース: この関数のシグネチャは変更禁止。
 *
 * 【将来の拡張: iterative deepening】
 * ```typescript
 * const options: SearchOptions = { depth, timeLimitMs: 1000 };
 * let best: Position | null = null;
 * for (let d = 1; d <= depth; d++) {
 *   const candidate = findBestMove(board, forbiddenMoves, currentTurn, d, options);
 *   if (candidate) best = candidate;
 *   if (isTimeUp(options)) break; // timeLimitMs 超過で中断
 * }
 * return best;
 * ```
 * SearchOptions.timeLimitMs を SearchContext に渡すことで
 * 探索側がタイムアウトを検知できる構造になっている。
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

  const depth = options?.depth ?? AI_CONFIG.MINIMAX_DEPTH;
  const best = findBestMove(board, forbiddenMoves, currentTurn, depth);

  if (best) {
    console.log(
      `AI selected: (${best.row}, ${best.col}) via minimax depth=${depth} (turn: ${currentTurn})`
    );
  }

  return best;
};