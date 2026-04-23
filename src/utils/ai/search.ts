// src/utils/ai/search.ts
// AIの次の一手を計算するロジックを定義するファイル

import type { BoardState, Position, Player, AICandidate } from '../../types/game';
import { BOARD_SIZE } from '../gameLogic';
import { AI_CONFIG } from './constants';
import { evaluatePosition } from './evaluator';

// 周辺に石があるか判定
const hasStoneNearby = (board: BoardState, row: number, col: number): boolean => {
  const range = AI_CONFIG.SEARCH_RANGE;
  for (let r = Math.max(0, row - range); r <= Math.min(BOARD_SIZE - 1, row + range); r++) {
    for (let c = Math.max(0, col - range); c <= Math.min(BOARD_SIZE - 1, col + range); c++) {
      if (board[r][c] !== null) return true;
    }
  }
  return false;
};

// AIの次の一手を計算する関数
export const calculateNextMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  currentTurn: Player
): Position | null => {
  const candidates: Position[] = [];
  const isBoardEmpty = board.flat().every((cell) => cell === null);

  // 初手は中央
  if (isBoardEmpty) {
    const center = Math.floor(BOARD_SIZE / 2);
    return { row: center, col: center };
  }

  // 1. 候補手の抽出（空きマス かつ 禁じ手でない かつ 石の周辺）
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

  // フォールバック（周辺に石がない場合：全空きマスを対象）
  if (candidates.length === 0) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === null && !forbiddenMoves[r][c]) {
          candidates.push({ row: r, col: c });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // 2. すべての候補手を評価し、スコア順にソート
  const scoredCandidates: AICandidate[] = candidates
    .map((pos) => ({
      ...pos,
      score: evaluatePosition(board, pos.row, pos.col, currentTurn),
    }))
    .sort((a, b) => b.score - a.score);

  // --- コンソールログへのテーブル出力 (上位3手) ---
  if (scoredCandidates.length > 0) {
    console.log(`AI Candidate Moves (Turn: ${currentTurn})`);
    const tableData = scoredCandidates.slice(0, 3).map((c, i) => ({
      Rank: i + 1,
      'Row(Y)': c.row,
      'Col(X)': c.col,
      Score: c.score,
    }));
    console.table(tableData);
  }

  // 3. 最高スコアのものを取得（同率がある場合はランダムに選択）
  const maxScore = scoredCandidates[0].score;
  const bestCandidates = scoredCandidates.filter((c) => c.score === maxScore);
  const randomIndex = Math.floor(Math.random() * bestCandidates.length);

  const selected = bestCandidates[randomIndex];
  return { row: selected.row, col: selected.col };
};