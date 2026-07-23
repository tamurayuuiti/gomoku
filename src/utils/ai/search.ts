// src/utils/ai/search.ts
// AIの次の一手を計算するロジックを定義するファイル
//
// 初手処理（盤面空き → 中央）、反復深化（iterative deepening）ループの制御、
// Aspiration Window による探索ウィンドウ管理、findBestMove の呼び出しと結果の返却を担う。
// 探索ロジック本体（αβ・move ordering・評価関数・TT・LMR・PVS）は minimax.ts 以下に完全委譲し、
// このファイルは "薄いアダプタ" として常に軽量に保つ。

import type { BoardState, Position, Player } from '../../types/game';
import type { SearchOptions } from '../../types/ai';
import { BOARD_SIZE } from '../gameLogic';
import { AI_CONFIG, TT_CONFIG } from './constants';
import { findBestMove } from './minimax';
import { TranspositionTable } from './transpositionTable';

/**
 * AIの次の一手を計算して返す。
 *
 * 公開インターフェース: この関数のシグネチャは変更禁止。
 *
 * options が一切指定されなかった場合は AI_CONFIG.MINIMAX_DEPTH /
 * AI_CONFIG.DEFAULT_TIME_LIMIT_MS をデフォルト値として使用する。
 *
 * 【反復深化（iterative deepening）+ Aspiration Window】
 * options.timeLimitMs が指定された場合、depth=1,2,3... と深さを1ずつ増やしながら
 * findBestMove を繰り返し呼び出す。各深さの探索は制限時間内に完了した場合のみ結果を
 * 採用し、時間切れで途中終了した深さの結果（findBestMove が move=null を返す）は破棄する。
 *
 * Aspiration Window:
 *   現在は TT_CONFIG.ENABLE_ASPIRATION_WINDOW = false により一時的に無効化している。
 *   これにより、反復深化の各 depth は常に full window（alpha=-Infinity, beta=Infinity）
 *   で探索される。
 *
 *   再導入時は TT_CONFIG.ENABLE_ASPIRATION_WINDOW = true に設定し、
 *   以下の Aspiration Window 関連ロジックを有効化する。
 *   ただし、再導入時には fail-high / fail-low 時の再探索ウィンドウを
 *   安全な設計（原則 full window 再探索など）に見直すことを推奨する。
 *
 * 【lastMove】
 * options.lastMove が指定されている場合、Countermove Heuristic のため
 * findBestMove へ伝播する。
 *
 * options.lastMove だけで depth / timeLimitMs が未指定の場合は、
 * 従来通り AI_CONFIG.MINIMAX_DEPTH / AI_CONFIG.DEFAULT_TIME_LIMIT_MS を使う。
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

  /**
   * Aspiration Window 用の前回スコア。
   * 現在は Aspiration Window 無効化中だが、再導入時に使うため残す。
   */
  let prevScore: number | null = null;

  for (let d = 1; d <= maxDepth; d++) {
    // depth=1 は時間制限なしで探索し、極端に短い timeLimitMs でも AI が無反応にならない保証とする
    const effectiveDeadline = d === 1 ? Infinity : deadline;

    // ------------------------------------------------------------
    // Aspiration Window（現在は一時的に無効）
    // ------------------------------------------------------------
    // 再導入時は TT_CONFIG.ENABLE_ASPIRATION_WINDOW を true にする。
    // その場合、depth >= 2 で prevScore を中心にウィンドウを設定する。
    //
    // 注意:
    //   現在の fail-high / fail-low 再探索ロジックは診断用に保持しているが、
    //   再導入時にはウィンドウ設計を再検討すること。
    //   特に、fail-high / fail-low 時は原則として full window 再探索にする方が安全。
    let alpha = -Infinity;
    let beta = Infinity;

    if (TT_CONFIG.ENABLE_ASPIRATION_WINDOW && d >= 2 && prevScore !== null) {
      const window = TT_CONFIG.ASPIRATION_WINDOW;
      alpha = prevScore - window;
      beta = prevScore + window;
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
    // 現在は一時的に無効（TT_CONFIG.ENABLE_ASPIRATION_WINDOW = false）
    // ------------------------------------------------------------
    if (
      TT_CONFIG.ENABLE_ASPIRATION_WINDOW &&
      result.move !== null &&
      d >= 2 &&
      prevScore !== null
    ) {
      const baseScore = prevScore;
      const window = TT_CONFIG.ASPIRATION_WINDOW;

      // Fail High: スコアがウィンドウ上限を超えた → 真のスコアはもっと高い
      if (result.score >= baseScore + window) {
        console.log(
          `[Search] depth=${d} Fail High (score=${result.score}), re-searching with full window`
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
      // Fail Low: スコアがウィンドウ下限を下回った → 真のスコアはもっと低い
      else if (result.score <= baseScore - window) {
        console.log(
          `[Search] depth=${d} Fail Low (score=${result.score}), re-searching with full window`
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

    // 次の深さに進む余地がなければここで打ち切る（deadline 超過分の探索呼び出しを避ける）
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