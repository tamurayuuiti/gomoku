// src/utils/ai/zobrist.ts
// ゾブリストハッシュ（Zobrist Hashing）による盤面状態の一意な識別子管理
//
// 盤面の各セル × 各プレイヤーに乱数を割り当て、石の配置のXOR和で盤面を表現する。
// 1手ごとにハッシュを再計算せず、着手・除去時に差分更新（Incremental Update）することで
// 探索中のハッシュ計算コストを O(1) に抑える。
//
// 用途:
//   - Transposition Table（置換表）のキー
//   - 同一局面の検出（繰り返し防止・キャッシュヒット）
//
// @future 盤面サイズ変更時の動的テーブル再生成、64bit衝突確率の低減（128bit化等）

import type { BoardState, Player } from '../../types/game';
import { BOARD_SIZE } from '../gameLogic';

// ============================================================
// 擬似乱数生成器（シード固定で再現性を担保）
// ============================================================

/**
 * Mulberry32: 高速な32bit擬似乱数生成器。
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

/** 64bit相当のbigint乱数を生成するヘルパー */
const randomBigInt = (rand: () => number): bigint => {
  const high = BigInt(Math.floor(rand() * 0xffffffff)) << 32n;
  const low = BigInt(Math.floor(rand() * 0xffffffff));
  return high | low;
};

// ============================================================
// ゾブリストテーブル
// ============================================================

/** プレイヤーをインデックスに変換（Black=0, White=1） */
const playerIndex = (player: Player): number => (player === 'Black' ? 0 : 1);

/**
 * ゾブリストテーブル本体。
 * table[row][col][playerIndex] に各セル・各プレイヤー対応の乱数を保持する。
 * モジュールロード時に1回だけ初期化される。
 */
const zobristTable: bigint[][][] = (() => {
  const rand = mulberry32(0x5eed1234); // 固定シード
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
 * 思考開始時に1回だけ呼び、以降は updateHash で差分更新する。
 *
 * @param board 盤面状態
 * @returns 盤面全体のハッシュ値
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
 * XORの性質（A ^ B ^ B = A）により、着手時も除去時も同じ演算で元に戻せる。
 *
 * @param hash   現在のハッシュ値
 * @param row    対象行
 * @param col    対象列
 * @param player 着手/除去する石の色
 * @returns 更新後のハッシュ値
 */
export const updateHash = (
  hash: bigint,
  row: number,
  col: number,
  player: Player
): bigint => hash ^ zobristTable[row][col][playerIndex(player)];