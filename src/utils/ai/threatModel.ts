// src/utils/ai/threatModel.ts
// 第6.1弾：Threat Model 用ヘルパー
//
// 責務:
//   - 仮想着手に対する勝ち判定
//   - 仮想着手に対する禁手合法性判定
//   - 仮想着手時のパターン集計
//
// 評価関数（AI_SCORES / evaluatePosition / evaluateBoard）の意味は変更しない。
// このモジュールは forced move list の分類に必要な戦術情報だけを提供する。
import type { BoardState, Player, Position } from '../../types/game';
import type { LineCacheState, PatternCount } from '../../types/ai';
import { checkWin, checkForbiddenMove } from '../gameLogic';
import { DIRECTIONS } from './constants';
import {
  detectPatternFast,
  detectPatternWithCenter,
  getLineString,
} from './evaluator';

const createEmptyPatternCount = (): PatternCount => ({
  WIN: 0,
  OPEN_FOUR: 0,
  CLOSED_FOUR: 0,
  OPEN_THREE: 0,
  CLOSED_THREE: 0,
  OPEN_TWO: 0,
  CLOSED_TWO: 0,
  SINGLE: 0,
});

/**
 * board[pos] が空であることを前提に、player が pos へ着手したときの勝利を判定する。
 *
 * 一時的に board を書き換えて checkWin を呼び、直後に復元する。
 * Black の長連は checkWin 側で勝利扱いされないため、ここで別途弾かれる。
 */
export const wouldWin = (
  board: BoardState,
  pos: Position,
  player: Player
): boolean => {
  const { row, col } = pos;
  if (board[row][col] !== null) return false;

  board[row][col] = player;
  try {
    return checkWin(board, pos, player);
  } finally {
    board[row][col] = null;
  }
};

/**
 * player が pos へ着手すると仮定したとき、ルール上合法かを返す。
 *
 * White は常に合法。
 * Black は checkForbiddenMove に委ねる。
 * checkForbiddenMove 内部で五連は禁手より優先される。
 *
 * 注意:
 *   この関数は UI 側の forbiddenMoves マスクを参照しない。
 *   UI マスクとの整合は呼び出し側で扱う。
 */
export const isHypotheticalLegal = (
  board: BoardState,
  pos: Position,
  player: Player
): boolean => {
  if (board[pos.row][pos.col] !== null) return false;
  if (player !== 'Black') return true;
  return !checkForbiddenMove(board, pos, player).isForbidden;
};

/**
 * UI から渡された forbiddenMoves を含む合法性判定。
 *
 * 第6.1弾では動的禁手を導入しないため、
 * root の forbiddenMoves を尊重する。
 */
export const isUiLegalMove = (
  board: BoardState,
  pos: Position,
  forbiddenMoves: boolean[][]
): boolean => {
  const { row, col } = pos;
  return board[row][col] === null && !forbiddenMoves[row][col];
};

/**
 * mover 側の着手合法性を判定する。
 *
 * UI forbiddenMoves を優先し、Black の場合は checkForbiddenMove も参照する。
 * own win そのものは checkForbiddenMove 内で勝利優先されるため、
 * 正確な五連勝ち手は禁手扱いされない。
 */
export const isMoverLegal = (
  board: BoardState,
  pos: Position,
  player: Player,
  forbiddenMoves: boolean[][]
): boolean => {
  if (!isUiLegalMove(board, pos, forbiddenMoves)) return false;
  if (player !== 'Black') return true;
  return !checkForbiddenMove(board, pos, player).isForbidden;
};

/**
 * player が (row, col) へ着手したと仮定したときのパターン集計を返す。
 *
 * LineCache があれば中心文字差し替えキャッシュを使い、
 * なければ getLineString + detectPatternFast で従来通り計算する。
 *
 * 評価スコアは計算しない。パターン種別のカウントのみを返す。
 */
export const getHypotheticalPatternCounts = (
  board: BoardState,
  lineCache: LineCacheState | null,
  row: number,
  col: number,
  player: Player
): PatternCount => {
  const counts = createEmptyPatternCount();

  if (lineCache) {
    const caches = lineCache.caches[player];
    for (let d = 0; d < DIRECTIONS.length; d++) {
      const line = caches[d][row][col];
      const ptn = detectPatternWithCenter(line, '1');
      counts[ptn]++;
    }
    return counts;
  }

  for (const [dx, dy] of DIRECTIONS) {
    const line = getLineString(board, row, col, dx, dy, player, '1');
    const ptn = detectPatternFast(line);
    counts[ptn]++;
  }

  return counts;
};