// src/utils/gameLogic.ts
// ゲームのロジックを担当する純粋関数を定義するファイル。
//
// 責務:
//   - 盤面生成 / 石数集計
//   - 勝利判定
//   - 禁手判定
//   - 禁手マトリクス計算
//   - 引き分け判定

import type {
  BoardState,
  Player,
  Position,
  ForbiddenReason,
  ForbiddenResult,
  GameStatus,
} from '@/types/game';

// ============================================================
// 盤面基本
// ============================================================

export const BOARD_SIZE = 15;

export const createEmptyBoard = (): BoardState => {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(null)
  );
};

export const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

export const countStones = (board: BoardState): number => {
  let count = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null) count++;
    }
  }
  return count;
};

const countStonesInDirection = (
  board: BoardState,
  pos: Position,
  player: Player,
  dRow: number,
  dCol: number
): number => {
  let count = 0;
  let r = pos.row + dRow;
  let c = pos.col + dCol;
  while (
    r >= 0 &&
    r < BOARD_SIZE &&
    c >= 0 &&
    c < BOARD_SIZE &&
    board[r][c] === player
  ) {
    count++;
    r += dRow;
    c += dCol;
  }
  return count;
};

// ============================================================
// 禁手判定ヘルパー
// ============================================================

/** ラインパターンの長さ（-5 〜 +5 の 11 セル） */
const LINE_PATTERN_LENGTH = 11;

/**
 * 指定方向 (dRow, dCol) の pos を中心とする 11 セルのラインパターンを
 * lineBuffer へ書き込む。
 *
 * 五連 + 両端判定のため最大 5 マスずつスキャンする。
 * 中心セル（i=0）には仮想的な player の石を書き込む。
 * 盤外は undefined を書き込む。
 *
 * ラインバッファを使い回すことで、方向ごとの新規配列生成を回避する。
 */
const fillLinePattern = (
  lineBuffer: (Player | null | undefined)[],
  board: BoardState,
  pos: Position,
  player: Player,
  dRow: number,
  dCol: number
): void => {
  for (let i = -5; i <= 5; i++) {
    const idx = i + 5;
    const r = pos.row + dRow * i;
    const c = pos.col + dCol * i;
    if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
      if (i === 0) {
        lineBuffer[idx] = player;
      } else {
        lineBuffer[idx] = board[r][c];
      }
    } else {
      lineBuffer[idx] = undefined; // 盤外
    }
  }
};

/**
 * 「四」が形成されているか判定する。
 * 長連は除外する。
 *
 * ライン配列を直接変更し、判定後に元に戻す in-place 方式で動作する。
 * 配列コピーを伴わないため、短命オブジェクトの生成が発生しない。
 */
const countFoursInLine = (
  line: (Player | null | undefined)[],
  player: Player
): number => {
  let fours = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === null) {
      line[i] = player;
      if (hasExactFive(line, player)) {
        fours++;
      }
      line[i] = null;
    }
  }
  return fours > 0 ? 1 : 0;
};

/**
 * 「活三」が形成されているか判定する。
 *
 * ライン配列を直接変更し、判定後に元に戻す in-place 方式で動作する。
 * 配列コピーを伴わないため、短命オブジェクトの生成が発生しない。
 */
const countOpenThreesInLine = (
  line: (Player | null | undefined)[],
  player: Player
): number => {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === null) {
      line[i] = player;
      const found = isTatsuShi(line, player);
      line[i] = null;
      if (found) {
        return 1;
      }
    }
  }
  return 0;
};

/**
 * ちょうど五連があるか判定する。
 * 長連は除外する。
 */
const hasExactFive = (
  line: (Player | null | undefined)[],
  player: Player
): boolean => {
  for (let i = 0; i <= line.length - 5; i++) {
    if (
      line[i] === player &&
      line[i + 1] === player &&
      line[i + 2] === player &&
      line[i + 3] === player &&
      line[i + 4] === player &&
      line[i - 1] !== player &&
      line[i + 5] !== player
    ) {
      return true;
    }
  }
  return false;
};

/**
 * 達四（両端が開いた四）を形成する三のパターンを判定する。
 */
const isTatsuShi = (
  line: (Player | null | undefined)[],
  player: Player
): boolean => {
  for (let i = 0; i <= line.length - 6; i++) {
    if (
      line[i] === null &&
      line[i + 1] === player &&
      line[i + 2] === player &&
      line[i + 3] === player &&
      line[i + 4] === player &&
      line[i + 5] === null
    ) {
      return true;
    }
  }
  return false;
};

// ============================================================
// 公開 API
// ============================================================

export const checkWin = (
  board: BoardState,
  lastMove: Position,
  player: Player
): boolean => {
  for (const [dRow, dCol] of DIRECTIONS) {
    const count =
      1 +
      countStonesInDirection(board, lastMove, player, dRow, dCol) +
      countStonesInDirection(board, lastMove, player, -dRow, -dCol);
    // 黒はちょうど 5 連のみ勝利、白は 5 以上で勝利（連珠ルール）。
    if (player === 'Black') {
      if (count === 5) return true;
    } else {
      if (count >= 5) return true;
    }
  }
  return false;
};

export const checkForbiddenMove = (
  board: BoardState,
  pos: Position,
  player: Player
): ForbiddenResult => {
  if (player !== 'Black') {
    return { isForbidden: false, reason: null };
  }

  // 1. 長連チェック + 勝利判定（統合走査）
  // 同一方向・同一パターンの盤面走査を 1 パスに統合している。
  // count > 5 なら長連（禁じ手）、count === 5 なら五連完成（勝利優先）。
  let isWin = false;
  for (const [dRow, dCol] of DIRECTIONS) {
    const count =
      1 +
      countStonesInDirection(board, pos, player, dRow, dCol) +
      countStonesInDirection(board, pos, player, -dRow, -dCol);
    if (count > 5) {
      return {
        isForbidden: true,
        reason: 'Long-Line',
      };
    }
    if (count === 5) {
      isWin = true;
    }
  }

  // 五完成は勝利優先（禁じ手より勝利判定が優先される連珠ルール）。
  if (isWin) {
    return { isForbidden: false, reason: null };
  }

  // 2. 四四・三三判定
  // 1 本のラインバッファを 4 方向で使い回し、方向ごとの配列生成を回避する。
  const lineBuffer: (Player | null | undefined)[] =
    new Array(LINE_PATTERN_LENGTH);
  let totalFours = 0;
  let totalOpenThrees = 0;

  for (const [dRow, dCol] of DIRECTIONS) {
    fillLinePattern(lineBuffer, board, pos, player, dRow, dCol);

    totalFours += countFoursInLine(lineBuffer, player);
    // 四四は三三より優先されるため、2 に達した時点で即座に確定できる。
    if (totalFours >= 2) {
      return {
        isForbidden: true,
        reason: 'Four-Four',
      };
    }

    totalOpenThrees += countOpenThreesInLine(lineBuffer, player);
  }

  // 3. 三三
  // 四四優先を維持するため、全方向の走査完了後に判定する。
  if (totalOpenThrees >= 2) {
    return {
      isForbidden: true,
      reason: 'Three-Three',
    };
  }

  return {
    isForbidden: false,
    reason: null,
  };
};

/**
 * 禁手判定に必要な石の探索範囲。
 * 禁手パターン（三三・四四・長連）は既存石とのライン連続性で形成されるため、
 * この範囲内に石が存在しない孤立空マスには禁じ手が成立しない。
 */
const FORBIDDEN_STONE_RANGE = 5;

/**
 * 指定セルの FORBIDDEN_STONE_RANGE 以内に石が 1 つ以上あるか判定する。
 * computeForbiddenMatrix の判定対象セル絞り込みに使用する。
 */
const hasStoneInForbiddenRange = (
  board: BoardState,
  row: number,
  col: number
): boolean => {
  const rMin = Math.max(0, row - FORBIDDEN_STONE_RANGE);
  const rMax = Math.min(BOARD_SIZE - 1, row + FORBIDDEN_STONE_RANGE);
  const cMin = Math.max(0, col - FORBIDDEN_STONE_RANGE);
  const cMax = Math.min(BOARD_SIZE - 1, col + FORBIDDEN_STONE_RANGE);
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      if (board[r][c] !== null) return true;
    }
  }
  return false;
};

/**
 * 盤面全体の禁手マトリクスを計算する純粋関数。
 *
 * 呼び出し元:
 *   - useForbiddenMoves（表示専用。描画後に非同期計算）
 *   - useAiPlayer（Worker 送信直前に要求時点の最新盤面に対して同期計算）
 *
 * Playing かつ禁手ルール ON かつ Black 手番の場合のみ空マスを走査し、
 * それ以外は全面 false を即返す軽量パスとなる。
 */
export const computeForbiddenMatrix = (
  board: BoardState,
  currentPlayer: Player,
  gameStatus: GameStatus,
  useForbiddenRule: boolean
): boolean[][] => {
  const matrix: boolean[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(false)
  );

  // ルールが OFF、または現在の手番が白（禁じ手なし）の場合は計算不要。
  if (
    gameStatus !== 'Playing' ||
    !useForbiddenRule ||
    currentPlayer !== 'Black'
  ) {
    return matrix;
  }

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === null) {
        // 石の近傍にない孤立空マスは禁手成立が不可能なためスキップする。
        if (!hasStoneInForbiddenRange(board, r, c)) continue;

        const result = checkForbiddenMove(board, { row: r, col: c }, 'Black');
        if (result.isForbidden) {
          matrix[r][c] = true;
        }
      }
    }
  }
  return matrix;
};

export const checkDraw = (board: BoardState): boolean => {
  return board.every(row => row.every(cell => cell !== null));
};

export const getForbiddenReasonMessage = (
  reason: ForbiddenReason
): string => {
  switch (reason) {
    case 'Three-Three':
      return '三三は禁じ手です';
    case 'Four-Four':
      return '四四は禁じ手です';
    case 'Long-Line':
      return '長連は禁じ手です';
    default:
      return 'それは禁じ手です';
  }
};