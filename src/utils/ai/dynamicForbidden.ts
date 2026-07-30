// src/utils/ai/dynamicForbidden.ts
// 限定動的禁手と禁手キャッシュを担うモジュール。
//
// 責務:
//   - Black 手番時のみ root / shallow node で禁手を再判定する。
//   - 禁手判定結果を Zobrist hash + move index ベースでキャッシュする。
//   - 候補手として許可するかどうかだけを返す。
//
// 注意:
//   - 静的 forbiddenMoves を上書きして合法化する機能は持たない。
//   - 静的 forbiddenMoves が false の場合のみ、動的禁手で追加除外する。
//   - forbiddenRuleEnabled === false の場合は禁手判定を一切行わない。

import type { BoardState, Player, Position } from '../../types/game';
import type { SearchStats } from '../../types/ai';
import { BOARD_SIZE, checkForbiddenMove } from '../gameLogic';
import {
  THREAT_FORBIDDEN_CONFIG,
  THREAT_FORBIDDEN_FEATURES,
} from './constants';

// ============================================================
// 定数・ヘルパー
// ============================================================

const MASK64 = (1n << 64n) - 1n;
const MOVE_SALT_SEED = 0x9e3779b97f4a7c15n;

const moveSalt = (index: number): bigint =>
  (BigInt(index + 1) * MOVE_SALT_SEED) & MASK64;

// ============================================================
// 公開型
// ============================================================

export interface DynamicForbiddenOptions {
  /**
   * 禁手ルールが有効かどうか。
   *
   * - false: 動的禁手を無効化する。
   * - true: 動的禁手を有効化できる。
   * - undefined: THREAT_FORBIDDEN_CONFIG.REQUIRE_EXPLICIT_FORBIDDEN_RULE に従う。
   */
  forbiddenRuleEnabled?: boolean;
}

export interface DynamicForbiddenController {
  /** 解決済みの禁手ルール有効状態 */
  readonly ruleEnabled: boolean;

  /**
   * このノードで動的禁手フィルタを適用すべきか返す。
   * 統計上のスキップ理由もここで記録する。
   */
  shouldFilterNode(
    player: Player,
    isRoot: boolean,
    depth: number,
    stats?: SearchStats
  ): boolean;

  /**
   * 指定着手が動的禁手かどうかを返す。
   * 呼び出し元は player === 'Black' を保証すること。
   */
  check(
    board: BoardState,
    pos: Position,
    player: Player,
    currentHash: bigint,
    stats?: SearchStats
  ): boolean;
}

// ============================================================
// コントローラ生成
// ============================================================

/**
 * 1回の calculateNextMove 単位で生成する動的禁手コントローラ。
 *
 * キャッシュは思考単位で破棄される。
 * TT のように思考をまたいで再利用しない。
 */
export const createDynamicForbiddenController = (
  options: DynamicForbiddenOptions = {}
): DynamicForbiddenController => {
  const cache = new Map<bigint, boolean>();

  const ruleEnabled =
    options.forbiddenRuleEnabled === false
      ? false
      : !THREAT_FORBIDDEN_CONFIG.REQUIRE_EXPLICIT_FORBIDDEN_RULE ||
        options.forbiddenRuleEnabled === true;

  const isMasterEnabled = (): boolean =>
    THREAT_FORBIDDEN_FEATURES.ENABLE_DYNAMIC_FORBIDDEN && ruleEnabled;

  const updateCacheSizeStats = (stats?: SearchStats): void => {
    if (!stats) return;

    stats.forbidden.cacheSize = cache.size;

    if (cache.size > stats.forbidden.cacheMaxSize) {
      stats.forbidden.cacheMaxSize = cache.size;
    }
  };

  const evictIfNeeded = (stats?: SearchStats): void => {
    const limit = THREAT_FORBIDDEN_CONFIG.FORBIDDEN_CACHE_LIMIT;

    if (limit <= 0) return;
    if (cache.size < limit) return;

    const deleteCount = Math.max(
      1,
      Math.floor(
        cache.size * THREAT_FORBIDDEN_CONFIG.FORBIDDEN_CACHE_EVICTION_RATIO
      )
    );

    let deleted = 0;

    for (const key of cache.keys()) {
      cache.delete(key);
      deleted++;
      if (deleted >= deleteCount) break;
    }

    if (stats) {
      stats.forbidden.cacheEvictions += deleted;
    }

    updateCacheSizeStats(stats);
  };

  const makeKey = (pos: Position, currentHash: bigint): bigint => {
    const index = pos.row * BOARD_SIZE + pos.col;

    return (
      (currentHash ^
        moveSalt(index) ^
        THREAT_FORBIDDEN_CONFIG.FORBIDDEN_CACHE_VERSION) &
      MASK64
    );
  };

  return {
    ruleEnabled,

    shouldFilterNode(
      player: Player,
      isRoot: boolean,
      depth: number,
      stats?: SearchStats
    ): boolean {
      if (!isMasterEnabled()) {
        if (stats) {
          stats.forbidden.dynamicSkippedDisabled++;
        }
        return false;
      }

      if (player !== 'Black') {
        if (stats) {
          stats.forbidden.dynamicSkippedWhite++;
        }
        return false;
      }

      if (isRoot) {
        if (!THREAT_FORBIDDEN_FEATURES.ENABLE_DYNAMIC_FORBIDDEN_ROOT) {
          if (stats) {
            stats.forbidden.dynamicSkippedDisabled++;
          }
          return false;
        }

        return true;
      }

      if (!THREAT_FORBIDDEN_FEATURES.ENABLE_DYNAMIC_FORBIDDEN_INTERNAL) {
        if (stats) {
          stats.forbidden.dynamicSkippedDeep++;
        }
        return false;
      }

      if (
        depth > THREAT_FORBIDDEN_CONFIG.DYNAMIC_FORBIDDEN_INTERNAL_MAX_DEPTH
      ) {
        if (stats) {
          stats.forbidden.dynamicSkippedDeep++;
        }
        return false;
      }

      return true;
    },

    check(
      board: BoardState,
      pos: Position,
      player: Player,
      currentHash: bigint,
      stats?: SearchStats
    ): boolean {
      if (!ruleEnabled) return false;
      if (player !== 'Black') return false;

      if (stats) {
        stats.forbidden.dynamicChecks++;
      }

      if (!THREAT_FORBIDDEN_FEATURES.ENABLE_FORBIDDEN_CACHE) {
        const result = checkForbiddenMove(board, pos, player).isForbidden;

        if (result && stats) {
          stats.forbidden.dynamicForbiddenMoves++;
        }

        return result;
      }

      const key = makeKey(pos, currentHash);
      const cached = cache.get(key);

      if (cached !== undefined) {
        if (stats) {
          stats.forbidden.cacheHits++;
        }

        if (cached && stats) {
          stats.forbidden.dynamicForbiddenMoves++;
        }

        return cached;
      }

      if (stats) {
        stats.forbidden.cacheMisses++;
      }

      const result = checkForbiddenMove(board, pos, player).isForbidden;

      evictIfNeeded(stats);
      cache.set(key, result);
      updateCacheSizeStats(stats);

      if (result && stats) {
        stats.forbidden.dynamicForbiddenMoves++;
      }

      return result;
    },
  };
};