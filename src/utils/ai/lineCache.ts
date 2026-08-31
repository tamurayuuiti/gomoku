// src/utils/ai/lineCache.ts
// 差分ラインキャッシュ（LineCache）を管理するモジュール。
//
// 責務:
//   - 初期盤面からのラインキャッシュ生成
//   - 着手時の差分更新
//   - 除去時の復元
//
// 注意:
//   - 評価ロジックは持たず、ラインコード（3 進整数）の保持・更新だけを担う。
//   - ラインコードの意味は evaluator.ts の getLineCode と同一。
//       各桁の値: 1 = 視点プレイヤーの石, 0 = 空マス, 2 = 相手石または盤外
//   - ラインコードは 9 桁の 3 進整数（0〜19682）で、
//       POSITION_WEIGHT[i] = 3^i の重みでエンコードされる。

import type { BoardState, Player, Cell } from '@/types/game';
import type { LineCacheState, LineCacheUndo } from '@/types/ai';
import { BOARD_SIZE, DIRECTIONS } from '@/utils/gameLogic';
import { POSITION_WEIGHT } from './evaluator';

// ============================================================
// 共有ヘルパー
// ============================================================

/**
 * セルの Player|null を getLineCode と同じ数値コードへ変換する。
 * 1 = 視点プレイヤーの石, 0 = 空マス, 2 = 相手石または盤外
 */
export const cellCode = (cell: Cell, color: Player): number =>
  cell === color ? 1 : cell === null ? 0 : 2;

// ============================================================
// 初期構築
// ============================================================

/**
 * 指定手番視点の全方向ラインキャッシュを初期構築する。
 *
 * 各セルに 9 桁の 3 進整数ラインコードを格納する。
 */
const buildPerspective = (
  board: BoardState,
  color: Player
): number[][][] => {
  return DIRECTIONS.map(([dx, dy]) => {
    const cache: number[][] = Array.from({ length: BOARD_SIZE }, () =>
      new Array<number>(BOARD_SIZE).fill(0)
    );
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        let code = 0;
        for (let i = -4; i <= 4; i++) {
          const pos = i + 4;
          const rr = r + i * dx;
          const cc = c + i * dy;
          if (rr < 0 || rr >= BOARD_SIZE || cc < 0 || cc >= BOARD_SIZE) {
            code += 2 * POSITION_WEIGHT[pos];
          } else {
            code += cellCode(board[rr][cc], color) * POSITION_WEIGHT[pos];
          }
        }
        cache[r][c] = code;
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

// ============================================================
// 差分更新
// ============================================================

/**
 * 着手に伴い LineCache を差分更新する。
 *
 * あるマス (row, col) に player の石を置いたとき、
 * そのマスを含むラインウィンドウの該当桁だけを更新する。
 *
 * 各方向について中心候補は最大 9 個。
 * 15x15 盤面では 1手あたり最大 4 * 9 * 2 = 72 セルの整数加算で済む。
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

      // 着手プレイヤー視点: 該当桁が 0（空）→ 1（自石）に変化
      cache.caches[player][d][centerRow][centerCol] += POSITION_WEIGHT[charIndex];

      // 相手視点: 該当桁が 0（空）→ 2（相手石）に変化
      cache.caches[opponent][d][centerRow][centerCol] += 2 * POSITION_WEIGHT[charIndex];
    }
  }

  return { row, col, player };
};

/**
 * 着手前の空マス状態へ LineCache を復元する。
 *
 * updateLineCache と逆操作を行い、着手位置の桁を 0 に戻す。
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

      // 着手プレイヤー視点: 該当桁が 1（自石）→ 0（空）に戻す
      cache.caches[undo.player][d][centerRow][centerCol] -= POSITION_WEIGHT[charIndex];

      // 相手視点: 該当桁が 2（相手石）→ 0（空）に戻す
      cache.caches[opponent][d][centerRow][centerCol] -= 2 * POSITION_WEIGHT[charIndex];
    }
  }
};