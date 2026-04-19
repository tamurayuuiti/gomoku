// src/utils/aiLogic.ts

import type { BoardState, Position, Player } from '../types/game';
import { BOARD_SIZE } from './gameLogic';

/**
 * AIが探索する際の「石からの距離」
 * 1だと隣接のみ、2だと一マス飛ばしまでを候補に含めます
 */
const SEARCH_RANGE = 2;

/**
 * 指定した座標の周辺に石があるかどうかを判定する
 */
const hasStoneNearby = (board: BoardState, row: number, col: number): boolean => {
  for (let r = Math.max(0, row - SEARCH_RANGE); r <= Math.min(BOARD_SIZE - 1, row + SEARCH_RANGE); r++) {
    for (let c = Math.max(0, col - SEARCH_RANGE); c <= Math.min(BOARD_SIZE - 1, col + SEARCH_RANGE); c++) {
      if (board[r][c] !== null) return true;
    }
  }
  return false;
};

/**
 * 特定の方向（dx, dy）に対して、石の連続数と空きマスの状態をスキャンしスコアを算出する
 */
const evaluateDirection = (
  board: BoardState,
  row: number,
  col: number,
  dx: number,
  dy: number,
  color: Player
): number => {
  let consecutive = 1; // 配置する石を1つ目としてカウント
  let block = 0;

  // 前方向への探索
  let r = row + dx;
  let c = col + dy;
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
    if (board[r][c] === color) {
      consecutive++;
    } else if (board[r][c] === null) {
      break; // 空きマスでストップ
    } else {
      block++; // 相手の石でブロックされた
      break;
    }
    r += dx;
    c += dy;
  }
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) block++; // 盤面外もブロック扱い

  // 後ろ方向への探索
  r = row - dx;
  c = col - dy;
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
    if (board[r][c] === color) {
      consecutive++;
    } else if (board[r][c] === null) {
      break;
    } else {
      block++;
      break;
    }
    r -= dx;
    c -= dy;
  }
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) block++;

  // パターンに応じたスコアリング
  if (consecutive >= 5) return 100000; // 五（5連）: 勝利確定

  if (consecutive === 4) {
    if (block === 0) return 10000; // 活四（両端空きの4連）: ほぼ勝利確定
    if (block === 1) return 1000;  // 死四（片端ブロックの4連）
  }

  if (consecutive === 3) {
    if (block === 0) return 1000;  // 活三（両端空きの3連）
    if (block === 1) return 100;   // 死三（片端ブロックの3連）
  }

  if (consecutive === 2) {
    if (block === 0) return 100;   // 活二（両端空きの2連）
    if (block === 1) return 10;    // 死二（片端ブロックの2連）
  }

  if (consecutive === 1) {
    if (block === 0) return 10;    // 孤立した石
  }

  return 0; // 両端ブロックされた無意味な石
};

/**
 * 指定された座標の「盤面全体の価値」を評価する
 * 攻撃（自分が揃える）と防御（相手の揃いを防ぐ）の両面からスコアを合算する
 */
export const evaluatePosition = (
  board: BoardState,
  row: number,
  col: number,
  playerColor: Player
): number => {
  const opponentColor: Player = playerColor === 'Black' ? 'White' : 'Black';
  let score = 0;

  // 縦、横、斜め（右下、左下）の4方向ベクトル
  const directions = [
    [1, 0], [0, 1], [1, 1], [1, -1]
  ];

  for (const [dx, dy] of directions) {
    // 自身の攻撃スコア（自分の石が揃うメリット）
    const attackScore = evaluateDirection(board, row, col, dx, dy, playerColor);
    // 相手の防御スコア（相手の石が揃うのを邪魔するメリット）
    const defenseScore = evaluateDirection(board, row, col, dx, dy, opponentColor);
    
    // 自身の攻撃をわずかに優先しつつ、相手の強力な手（5連や活四など）は確実に防ぐように重み付け
    score += (attackScore * 1.1) + defenseScore;
  }

  return score;
};

/**
 * 次の一手を計算する
 * @param board 現在の盤面
 * @param forbiddenMoves 禁じ手情報の二次元配列（trueが禁じ手）
 * @param currentTurn 現在の手番（追加）
 */
export const calculateNextMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  currentTurn: Player // 引数を追加
): Position | null => {
  const candidates: Position[] = [];
  const isBoardEmpty = board.flat().every((cell) => cell === null);

  // 1. 盤面が空なら中央付近を返す（初手の定石）
  if (isBoardEmpty) {
    const center = Math.floor(BOARD_SIZE / 2);
    return { row: center, col: center };
  }

  // --- 修正箇所：内部でのカウントによる推測を廃止し、引数を使用する ---
  const aiColor: Player = currentTurn;

  // 2. 候補手の抽出（石の周辺 かつ 空きマス かつ 禁じ手でない）
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (
        board[r][c] === null &&          // 空きマスである
        !forbiddenMoves[r][c] &&         // 禁じ手ではない
        hasStoneNearby(board, r, c)      // 周辺に石がある
      ) {
        candidates.push({ row: r, col: c });
      }
    }
  }

  // フォールバック（石の周辺に手がない場合のセーフティ）
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

  // 3. 評価関数を用いた最適な手の選定
  let maxScore = -Infinity;
  let bestCandidates: Position[] = [];

  for (const pos of candidates) {
    // 引数から得た aiColor を使用して評価
    const score = evaluatePosition(board, pos.row, pos.col, aiColor);
    
    if (score > maxScore) {
      maxScore = score;
      bestCandidates = [pos];
    } else if (score === maxScore) {
      bestCandidates.push(pos);
    }
  }

  const randomIndex = Math.floor(Math.random() * bestCandidates.length);
  return bestCandidates[randomIndex];
};