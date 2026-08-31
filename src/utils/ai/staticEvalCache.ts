// src/utils/ai/staticEvalCache.ts
// Static Eval Cache（葉評価キャッシュ）を管理するモジュール。
//
// 責務:
//   - 葉ノードの静的評価値を Zobrist hash ベースでキャッシュする。
//   - 思考単位で生成・破棄されることを前提とする。
//   - TT とは異なり、alpha/beta flag や depth は保持しない。
//
// 注意:
//   - key = Zobrist hash ^ playerSalt ^ forbiddenSalt ^ candidateSetSalt ^ staticEvalVersion
//   - forbiddenMoves は思考中に固定のため、思考単位キャッシュであれば十分。
//   - 内部構造は固定サイズ Typed Array による直接マッピング方式ハッシュテーブル。
//     異なるキーの衝突時は無条件で上書きする（depth による優先度がないため）。

import type { Player } from '@/types/game';
import { BOARD_SIZE } from '@/utils/gameLogic';
import { SEARCH_TUNING_CONFIG, SEC_TABLE_SIZE } from './constants';

// ============================================================
// 公開型
// ============================================================

export interface StaticEvalCacheStats {
  lookups: number;
  hits: number;
  misses: number;
  stores: number;
  evictions: number;
  size: number;
  maxSize: number;
}

export interface StaticEvalCache {
  stats: StaticEvalCacheStats;
  lookup(hash: bigint): number | undefined;
  store(hash: bigint, score: number): void;
}

export interface StaticEvalCacheSaltSource {
  aiPlayer: Player;
  forbiddenMoves: boolean[][];
  candidateSetEnabled: boolean;
}

// ============================================================
// 定数・ヘルパー
// ============================================================

const MASK64 = (1n << 64n) - 1n;
const PLAYER_SALT_BLACK = 0x9e3779b97f4a7c15n;
const PLAYER_SALT_WHITE = 0xbf58476d1ce4e5b9n;
const CANDIDATE_SET_SALT = 0x94d049bb133111ebn;

/** テーブルインデックス算出用のビットマスク */
const SEC_INDEX_MASK = SEC_TABLE_SIZE - 1;

/** インデックス計算用の bigint マスク（生成コスト回避のため事前計算） */
const SEC_INDEX_MASK_BIGINT = BigInt(SEC_INDEX_MASK);

/** bigint の上位 32bit を数値として取り出す */
const toHigh = (hash: bigint): number =>
  Number((hash >> 32n) & 0xFFFFFFFFn);

/** bigint の下位 32bit を数値として取り出す */
const toLow = (hash: bigint): number =>
  Number(hash & 0xFFFFFFFFn);

/**
 * forbiddenMoves 状態を簡易的に salt 化する。
 *
 * 思考単位キャッシュのため、厳密な動的禁手整合は不要だが、
 * 禁手あり / なし・禁手マス配置の違いを key に反映できるようにする。
 */
const computeForbiddenSalt = (forbiddenMoves: boolean[][]): bigint => {
  let h = 0xcbf29ce484222325n;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (!forbiddenMoves[r][c]) continue;
      h ^= BigInt(r * BOARD_SIZE + c + 1);
      h = (h * 0x100000001b3n) & MASK64;
    }
  }
  return h;
};

// ============================================================
// Static Eval Cache 生成
// ============================================================

/**
 * Static Eval Cache を生成する。
 * 1回の calculateNextMove（思考）ごとに新規生成する想定。
 *
 * 内部に固定サイズ Typed Array ハッシュテーブルを確保する。
 * テーブルサイズは SEC_TABLE_SIZE で確定している。
 */
export const createStaticEvalCache = (
  source: StaticEvalCacheSaltSource
): StaticEvalCache => {
  // --- 固定サイズ Typed Array ---
  const keyHigh = new Uint32Array(SEC_TABLE_SIZE);
  const keyLow = new Uint32Array(SEC_TABLE_SIZE);
  const occupied = new Uint8Array(SEC_TABLE_SIZE);
  const values = new Float64Array(SEC_TABLE_SIZE);

  /** 現在の使用エントリ数 */
  let entryCount = 0;

  const stats: StaticEvalCacheStats = {
    lookups: 0,
    hits: 0,
    misses: 0,
    stores: 0,
    evictions: 0,
    size: 0,
    maxSize: 0,
  };

  // --- キー salt の計算 ---
  const playerSalt =
    source.aiPlayer === 'Black' ? PLAYER_SALT_BLACK : PLAYER_SALT_WHITE;
  const forbiddenSalt = computeForbiddenSalt(source.forbiddenMoves);
  const candidateSetSalt = source.candidateSetEnabled
    ? CANDIDATE_SET_SALT
    : 0n;
  const keySalt =
    (playerSalt ^
      forbiddenSalt ^
      candidateSetSalt ^
      SEARCH_TUNING_CONFIG.STATIC_EVAL_VERSION) &
    MASK64;

  /** Zobrist hash に salt を合成してキャッシュキーを生成する */
  const makeKey = (hash: bigint): bigint => (hash ^ keySalt) & MASK64;

  return {
    stats,

    lookup(hash: bigint): number | undefined {
      stats.lookups++;

      const key = makeKey(hash);
      const index = Number(key & SEC_INDEX_MASK_BIGINT);

      // 空スロット
      if (occupied[index] === 0) {
        stats.misses++;
        return undefined;
      }

      // キー不一致（ハッシュ衝突）
      if (
        keyHigh[index] !== toHigh(key) ||
        keyLow[index] !== toLow(key)
      ) {
        stats.misses++;
        return undefined;
      }

      stats.hits++;
      return values[index];
    },

    store(hash: bigint, score: number): void {
      const key = makeKey(hash);
      const index = Number(key & SEC_INDEX_MASK_BIGINT);
      const high = toHigh(key);
      const low = toLow(key);

      // --- 空スロット: 新規格納 ---
      if (occupied[index] === 0) {
        keyHigh[index] = high;
        keyLow[index] = low;
        occupied[index] = 1;
        values[index] = score;
        entryCount++;
        stats.stores++;
        stats.size = entryCount;
        if (entryCount > stats.maxSize) {
          stats.maxSize = entryCount;
        }
        return;
      }

      // --- 同一キー: スコア上書き（stores は加算しない） ---
      if (keyHigh[index] === high && keyLow[index] === low) {
        values[index] = score;
        return;
      }

      // --- 異なるキー: 無条件上書き ---
      stats.evictions++;
      keyHigh[index] = high;
      keyLow[index] = low;
      values[index] = score;
      // entryCount は不変（スロット数は変わらない）
      stats.size = entryCount;
    },
  };
};