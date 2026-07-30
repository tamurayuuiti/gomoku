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
//   - eviction 統計は削除エントリ数として記録する。

import type { Player } from '../../types/game';
import { BOARD_SIZE } from '../gameLogic';
import { SEARCH_TUNING_CONFIG } from './constants';

// ============================================================
// 公開型
// ============================================================

export interface StaticEvalCacheOptions {
  limit: number;
  evictionRatio: number;
}

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
 */
export const createStaticEvalCache = (
  options: StaticEvalCacheOptions,
  source: StaticEvalCacheSaltSource
): StaticEvalCache => {
  const table = new Map<bigint, number>();

  const stats: StaticEvalCacheStats = {
    lookups: 0,
    hits: 0,
    misses: 0,
    stores: 0,
    evictions: 0,
    size: 0,
    maxSize: 0,
  };

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

  const makeKey = (hash: bigint): bigint => (hash ^ keySalt) & MASK64;

  const evictIfNeeded = (): void => {
    if (options.limit <= 0) return;
    if (table.size < options.limit) return;

    const deleteCount = Math.max(
      1,
      Math.floor(table.size * options.evictionRatio)
    );

    let deleted = 0;

    // Map は挿入順を保持するため、先頭から古いエントリを削除できる。
    for (const key of table.keys()) {
      table.delete(key);
      deleted++;
      if (deleted >= deleteCount) break;
    }

    // evictions は削除されたエントリ数として記録する。
    stats.evictions += deleted;
    stats.size = table.size;
  };

  return {
    stats,

    lookup(hash: bigint): number | undefined {
      stats.lookups++;

      const key = makeKey(hash);
      const value = table.get(key);

      if (value !== undefined) {
        stats.hits++;
        return value;
      }

      stats.misses++;
      return undefined;
    },

    store(hash: bigint, score: number): void {
      if (options.limit <= 0) return;

      const key = makeKey(hash);

      // 既存エントリの更新は insertion order を刷新する。
      if (table.has(key)) {
        table.delete(key);
        table.set(key, score);
        stats.size = table.size;
        return;
      }

      evictIfNeeded();

      table.set(key, score);

      stats.stores++;
      stats.size = table.size;

      if (stats.size > stats.maxSize) {
        stats.maxSize = stats.size;
      }
    },
  };
};