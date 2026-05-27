// src/utils/ai/boardEvaluator.ts
// 葉ノード盤面評価を担うモジュール
//
// 責務:
//   - evaluateBoard（全盤面の多重脅威スコア算出）
//
// evaluatePosition（位置評価）は evaluator.ts に残し、
// 盤面全体を集約してスカラー値を返す層をここに配置する。
//
// 【差し替え口】
// ライン走査型評価関数（O(n) 走査）が用意された場合は、
// この boardEvaluator.ts だけを差し替えればよい。
// minimax.ts・candidateGenerator.ts は影響を受けない。

import type { BoardState, Player } from '../../types/game';
import { BOARD_SIZE } from '../gameLogic';
import { EVAL_CONFIG } from './constants';
import { evaluatePosition, hasStoneNearby, opponentOf } from './evaluator';


// ============================================================
// 全盤評価（葉ノード向け）
// ============================================================

/**
 * 盤面全体を aiPlayer 視点で評価し、スカラースコアを返す。
 *
 * 【評価方式】
 * 旧実装: `aiMax - oppMax`（各プレイヤーの "1 手だけ" の最善差分）
 * 現実装: 上位 K 手の重み付き和差分
 *
 *   score = Σ_i(aiTopK[i] × decay^i) - Σ_i(oppTopK[i] × decay^i)
 *
 * decay < 1 で 2・3 番手の寄与を逓減させることで:
 *   - 「1 箇所だけ強い」盤面より「複数箇所に脅威がある」盤面を高評価
 *   - 多重脅威のある局面（例: 四三・双三）を正確に反映
 *
 * 【将来の差し替え口】
 * 全ライン走査型の専用評価関数（例: ラインスキャン O(n)）が
 * 用意された場合は、この関数の内部実装を差し替えるだけでよい。
 * minimax.ts / candidateGenerator.ts には影響しない。
 *
 * @param board          評価対象の盤面
 * @param aiPlayer       AI のプレイヤー（スコアの基準視点）
 * @param forbiddenMoves 禁じ手マップ（候補マスのフィルタリングに使用）
 * @returns              aiPlayer 視点のスカラースコア
 */
export const evaluateBoard = (
  board: BoardState,
  aiPlayer: Player,
  forbiddenMoves: boolean[][]
): number => {
  const opp = opponentOf(aiPlayer);
  const topK = EVAL_CONFIG.TOP_K;
  const decay = EVAL_CONFIG.TOP_K_DECAY;

  /**
   * 上位 K 要素のみを保持するソート済み降順配列へ挿入。
   * K が小さい（≤ 3）ため線形挿入 O(K) で十分。
   *
   * 【将来の拡張】
   * K を増やしたい場合は min-heap へ差し替えると O(log K) になる。
   */
  const insertTopK = (arr: number[], val: number, k: number): void => {
    let i = arr.length;
    while (i > 0 && arr[i - 1] < val) i--;
    arr.splice(i, 0, val);
    if (arr.length > k) arr.length = k;
  };

  const aiTopK: number[] = [];
  const oppTopK: number[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      insertTopK(aiTopK, evaluatePosition(board, r, c, aiPlayer), topK);
      insertTopK(oppTopK, evaluatePosition(board, r, c, opp), topK);
    }
  }

  if (aiTopK.length === 0 && oppTopK.length === 0) return 0;

  let aiTotal = 0;
  let oppTotal = 0;
  for (let i = 0; i < aiTopK.length; i++) aiTotal += aiTopK[i] * Math.pow(decay, i);
  for (let i = 0; i < oppTopK.length; i++) oppTotal += oppTopK[i] * Math.pow(decay, i);

  return aiTotal - oppTotal;
};