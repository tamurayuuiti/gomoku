// src/utils/gameLogic.ts
// ゲームのロジックを担当する純粋関数を定義するファイル

import type { BoardState, Player, Position, ForbiddenReason, ForbiddenResult } from '../types/game';

export const BOARD_SIZE = 15;

export const createEmptyBoard = (): BoardState => {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
};

// 指定方向への石の連続数をカウント
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

  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
    count++;
    r += dRow;
    c += dCol;
  }

  return count;
};

// --- 禁じ手判定用ヘルパーロジック ---

// 指定方向のラインパターンを取得
const getLinePattern = (
  board: BoardState,
  pos: Position,
  player: Player,
  dRow: number,
  dCol: number
): (Player | null | undefined)[] => {
  const line: (Player | null | undefined)[] = [];

  // 五連 + 両端判定のため最大5マスずつスキャン
  for (let i = -5; i <= 5; i++) {
    const r = pos.row + dRow * i;
    const c = pos.col + dCol * i;

    if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
      if (i === 0) {
        line.push(player);
      } else {
        line.push(board[r][c]);
      }
    } else {
      line.push(undefined); // 盤外
    }
  }

  return line;
};

// そのラインで「四」が形成されているか判定（長連は除外）
const countFoursInLine = (line: (Player | null | undefined)[], player: Player): number => {
  let fours = 0;

  for (let i = 0; i < line.length; i++) {
    if (line[i] === null) {
      const tempLine = [...line];
      tempLine[i] = player;

      if (hasExactFive(tempLine, player)) {
        fours++;
      }
    }
  }

  return fours > 0 ? 1 : 0;
};

// そのラインで「活三」が形成されているか判定
const countOpenThreesInLine = (line: (Player | null | undefined)[], player: Player): number => {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === null) {
      const tempLine = [...line];
      tempLine[i] = player;

      if (isTatsuShi(tempLine, player)) {
        return 1;
      }
    }
  }

  return 0;
};

// ちょうど五連があるか判定（長連は除外）
const hasExactFive = (line: (Player | null | undefined)[], player: Player): boolean => {
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

// 達四（両端が開いた四）を形成する三のパターンを判定
const isTatsuShi = (line: (Player | null | undefined)[], player: Player): boolean => {
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

// --- エクスポート関数 ---

export const checkWin = (
  board: BoardState,
  lastMove: Position,
  player: Player
): boolean => {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  for (const [dRow, dCol] of directions) {
    const count =
      1 +
      countStonesInDirection(board, lastMove, player, dRow, dCol) +
      countStonesInDirection(board, lastMove, player, -dRow, -dCol);

    // 黒はちょうど5連のみ勝利
    if (player === 'Black') {
      if (count === 5) return true;
    } else {
      // 白は5以上で勝利
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

  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  // 1. 長連チェック
  for (const [dRow, dCol] of directions) {
    const count =
      1 +
      countStonesInDirection(board, pos, player, dRow, dCol) +
      countStonesInDirection(board, pos, player, -dRow, -dCol);

    if (count > 5) {
      return {
        isForbidden: true,
        reason: 'Long-Line'
      };
    }
  }

  // 五完成は勝利優先
  if (checkWin(board, pos, player)) {
    return { isForbidden: false, reason: null };
  }

  let totalFours = 0;
  let totalOpenThrees = 0;

  for (const [dRow, dCol] of directions) {
    const line = getLinePattern(board, pos, player, dRow, dCol);

    totalFours += countFoursInLine(line, player);
    totalOpenThrees += countOpenThreesInLine(line, player);
  }

  // 2. 四四
  if (totalFours >= 2) {
    return {
      isForbidden: true,
      reason: 'Four-Four'
    };
  }

  // 3. 三三
  if (totalOpenThrees >= 2) {
    return {
      isForbidden: true,
      reason: 'Three-Three'
    };
  }

  return {
    isForbidden: false,
    reason: null
  };
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