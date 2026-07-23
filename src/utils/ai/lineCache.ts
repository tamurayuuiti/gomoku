// src/utils/ai/lineCache.ts
// 差分ラインキャッシュ（LineCache）を管理するモジュール。
//
// 責務:
//   - 初期盤面からのラインキャッシュ生成
//   - 着手時の差分更新
//   - 除去時の復元
//
// 評価ロジック（detectPattern / evaluatePosition / evaluateBoard）は持たず、
// 純粋に「9 文字ライン状態の保持・更新」だけを担う。
//
// ライン文字列の意味は evaluator.ts の getLineString と同一。
//   '1' = 視点プレイヤーの石
//   '0' = 空マス
//   '2' = 相手石または盤外

import type { BoardState, Player, Cell } from '../../types/game';
import type { LineCacheState, LineCacheUndo } from '../../types/ai';
import { BOARD_SIZE, DIRECTIONS } from '../gameLogic';

/**
 * セルの Player|null を getLineString と同じ文字コードへ変換する。
 */
const cellChar = (cell: Cell, color: Player): string =>
  cell === color ? '1' : cell === null ? '0' : '2';

/**
 * 指定手番視点の全方向ラインキャッシュを初期構築する。
 */
const buildPerspective = (
  board: BoardState,
  color: Player
): string[][][] => {
  return DIRECTIONS.map(([dx, dy]) => {
    const cache: string[][] = Array.from({ length: BOARD_SIZE }, () =>
      new Array<string>(BOARD_SIZE).fill('')
    );

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        let s = '';

        for (let i = -4; i <= 4; i++) {
          const rr = r + i * dx;
          const cc = c + i * dy;

          if (rr < 0 || rr >= BOARD_SIZE || cc < 0 || cc >= BOARD_SIZE) {
            s += '2';
          } else {
            s += cellChar(board[rr][cc], color);
          }
        }

        cache[r][c] = s;
      }
    }

    return cache;
  });
};

/**
 * LineCache を初期盤面から生成する。
 * Black 視点・White 視点の両方を持つ。
 */
export const createLineCache = (board: BoardState): LineCacheState => {
  return {
    caches: {
      Black: buildPerspective(board, 'Black'),
      White: buildPerspective(board, 'White'),
    },
  };
};

/**
 * 文字列の指定位置を 1 文字だけ置換する。
 */
const replaceChar = (s: string, index: number, ch: string): string =>
  s.slice(0, index) + ch + s.slice(index + 1);

/**
 * 着手に伴い LineCache を差分更新する。
 *
 * あるマス (row, col) に player の石を置いたとき、
 * そのマスを含む 9 文字ウィンドウの中心マスだけを更新する。
 *
 * 各方向について中心候補は最大 9 個。
 * 15x15 盤面では 1手あたり最大 4 * 9 * 2 = 72 文字列の更新で済む。
 */
export const updateLineCache = (
  cache: LineCacheState,
  row: number,
  col: number,
  player: Player
): LineCacheUndo => {
  const opponent: Player = player === 'Black' ? 'White' : 'Black';

  for (let d = 0; d < DIRECTIONS.length; d++) {
    const [dx, dy] = DIRECTIONS[d];

    for (let offset = -4; offset <= 4; offset++) {
      const centerRow = row - offset * dx;
      const centerCol = col - offset * dy;

      if (
        centerRow < 0 ||
        centerRow >= BOARD_SIZE ||
        centerCol < 0 ||
        centerCol >= BOARD_SIZE
      ) {
        continue;
      }

      const charIndex = offset + 4;

      cache.caches[player][d][centerRow][centerCol] = replaceChar(
        cache.caches[player][d][centerRow][centerCol],
        charIndex,
        '1'
      );

      cache.caches[opponent][d][centerRow][centerCol] = replaceChar(
        cache.caches[opponent][d][centerRow][centerCol],
        charIndex,
        '2'
      );
    }
  }

  return { row, col, player };
};

/**
 * 着手前の空マス状態へ LineCache を復元する。
 *
 * updateLineCache と逆操作を行い、着手位置を '0' に戻す。
 */
export const undoLineCache = (
  cache: LineCacheState,
  undo: LineCacheUndo
): void => {
  const opponent: Player = undo.player === 'Black' ? 'White' : 'Black';

  for (let d = 0; d < DIRECTIONS.length; d++) {
    const [dx, dy] = DIRECTIONS[d];

    for (let offset = -4; offset <= 4; offset++) {
      const centerRow = undo.row - offset * dx;
      const centerCol = undo.col - offset * dy;

      if (
        centerRow < 0 ||
        centerRow >= BOARD_SIZE ||
        centerCol < 0 ||
        centerCol >= BOARD_SIZE
      ) {
        continue;
      }

      const charIndex = offset + 4;

      cache.caches[undo.player][d][centerRow][centerCol] = replaceChar(
        cache.caches[undo.player][d][centerRow][centerCol],
        charIndex,
        '0'
      );

      cache.caches[opponent][d][centerRow][centerCol] = replaceChar(
        cache.caches[opponent][d][centerRow][centerCol],
        charIndex,
        '0'
      );
    }
  }
};