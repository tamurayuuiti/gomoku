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

import type { BoardState, Position, Player } from '../../types/game';
import type { SearchOptions } from '../../types/ai';
import { BOARD_SIZE } from '../gameLogic';
import { AI_CONFIG, AI_SCORES, TT_CONFIG, AI_FEATURES } from './constants';
import { findBestMove } from './minimax';
import { TranspositionTable } from './transpositionTable';

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
  if (!AI_FEATURES.ENABLE_SAFE_ASPIRATION) return false;
  if (depth < 2) return false;
  if (prevScore === null) return false;

  // WIN / LOSS 付近ではウィンドウを狭めるリスクを避ける
  return Math.abs(prevScore) < AI_SCORES.WIN / 2;
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
  const isBoardEmpty = board.flat().every((cell) => cell === null);

  // 初手は中央
  if (isBoardEmpty) {
    const center = Math.floor(BOARD_SIZE / 2);
    return { row: center, col: center };
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

  const maxDepth = explicitDepth
    ? (options!.depth as number)
    : AI_CONFIG.MINIMAX_DEPTH;

  const timeLimitMs = explicitTime
    ? (options!.timeLimitMs as number)
    : (!explicitDepth && (options === undefined || onlyLastMove)
        ? AI_CONFIG.DEFAULT_TIME_LIMIT_MS
        : undefined);

  const lastMove = options?.lastMove ?? null;

  // --- timeLimitMs 未指定: 従来通りの固定深さ探索 ---
  if (timeLimitMs === undefined) {
    const tt = new TranspositionTable();

    const result = findBestMove(
      board,
      forbiddenMoves,
      currentTurn,
      maxDepth,
      Infinity,
      tt,
      -Infinity,
      Infinity,
      lastMove
    );

    if (result.move) {
      console.log(
        `AI selected: (${result.move.row}, ${result.move.col}) via minimax depth=${maxDepth} ` +
        `score=${result.score}, tt=${JSON.stringify(tt.stats)} (turn: ${currentTurn})`
      );
    }

    return result.move;
  }

  // --- timeLimitMs 指定: 反復深化（iterative deepening） ---
  const deadline = performance.now() + timeLimitMs;
  const tt = new TranspositionTable();

  let best: Position | null = null;
  let completedDepth = 0;
  let prevScore: number | null = null;

  for (let d = 1; d <= maxDepth; d++) {
    // depth=1 は時間制限なしで探索し、極端に短い timeLimitMs でも AI が無反応にならない保証とする
    const effectiveDeadline = d === 1 ? Infinity : deadline;

    let alpha = -Infinity;
    let beta = Infinity;

    const useAspiration = shouldUseAspiration(d, prevScore);

    if (useAspiration) {
      const window = TT_CONFIG.ASPIRATION_WINDOW;
      alpha = (prevScore as number) - window;
      beta = (prevScore as number) + window;
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
      lastMove
    );

    // ------------------------------------------------------------
    // Aspiration Window fail-high / fail-low 再探索
    // 安全側: どちらかに触れたら原則 full window で再探索する。
    // ------------------------------------------------------------
    if (useAspiration && result.move !== null) {
      if (result.score >= beta || result.score <= alpha) {
        console.log(
          `[Search] depth=${d} aspiration fail (score=${result.score}, window=[${alpha}, ${beta}]), ` +
          `re-searching with full window`
        );

        result = findBestMove(
          board,
          forbiddenMoves,
          currentTurn,
          d,
          effectiveDeadline,
          tt,
          -Infinity,
          Infinity,
          lastMove
        );
      }
    }

    // null = この深さは時間切れで未完了。直前の完全な結果を採用して打ち切る。
    if (!result.move) break;

    best = result.move;
    prevScore = result.score;
    completedDepth = d;

    // 次の深さに進む余地がなければここで打ち切る
    if (performance.now() >= deadline) break;
  }

  if (best) {
    console.log(
      `AI selected: (${best.row}, ${best.col}) via iterative deepening ` +
      `completedDepth=${completedDepth}/${maxDepth}, score=${prevScore}, ` +
      `tt=${JSON.stringify(tt.stats)} (turn: ${currentTurn})`
    );
  }

  return best;
};