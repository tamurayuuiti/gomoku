// src/utils/ai/zobrist.ts
// Zobrist Hashing による盤面ハッシュ管理。
//
// 責務:
//   - 初期盤面ハッシュ計算
//   - 着手・除去時の差分更新
//
// 注意:
//   - 探索中のハッシュ計算コストを O(1) に抑える。
//   - シード固定で再現性を担保する。
//   - Transposition Table のキーとして使う。

import type { BoardState, Player } from '@/types/game';
import { BOARD_SIZE } from '@/utils/gameLogic';

// ============================================================
// 擬似乱数生成器
// ============================================================

/**
 * Mulberry32: 高速な 32bit 擬似乱数生成器。
 * シード固定により、実行環境・タイミングに依らず同一の乱数列を生成する。
 */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed;

  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;

    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** 64bit 相当の bigint 乱数を生成するヘルパー */
const randomBigInt = (rand: () => number): bigint => {
  const high = BigInt(Math.floor(rand() * 0xffffffff)) << 32n;
  const low = BigInt(Math.floor(rand() * 0xffffffff));

  return high | low;
};

// ============================================================
// ゾブリストテーブル
// ============================================================

/** プレイヤーをインデックスへ変換する（Black=0, White=1） */
const playerIndex = (player: Player): number =>
  player === 'Black' ? 0 : 1;

/**
 * ゾブリストテーブル本体。
 *
 * table[row][col][playerIndex] に各セル・各プレイヤー対応の乱数を保持する。
 * モジュールロード時に 1 回だけ初期化される。
 */
const zobristTable: bigint[][][] = (() => {
  const rand = mulberry32(0x5eed1234);
  const table: bigint[][][] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    table[r] = [];

    for (let c = 0; c < BOARD_SIZE; c++) {
      table[r][c] = [randomBigInt(rand), randomBigInt(rand)];
    }
  }

  return table;
})();

// ============================================================
// ハッシュ計算・差分更新
// ============================================================

/**
 * 初期盤面（または任意の盤面）のハッシュ値を計算する。
 *
 * 思考開始時に 1 回だけ呼び、以降は updateHash で差分更新する。
 */
export const calculateInitialHash = (board: BoardState): bigint => {
  let hash = 0n;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];

      if (cell !== null) {
        hash ^= zobristTable[r][c][playerIndex(cell)];
      }
    }
  }

  return hash;
};

/**
 * 石の着手・除去に伴うハッシュの差分更新。
 *
 * XOR の性質（A ^ B ^ B = A）により、着手時も除去時も同じ演算で元に戻せる。
 */
export const updateHash = (
  hash: bigint,
  row: number,
  col: number,
  player: Player
): bigint => hash ^ zobristTable[row][col][playerIndex(player)];