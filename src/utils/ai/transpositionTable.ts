// src/utils/ai/transpositionTable.ts
// Transposition Table（置換表）の管理モジュール
//
// 探索中に評価済みの局面（ハッシュ値で識別）をキャッシュし、
// 異なる手順で同じ盤面に到達した場合の再探索を排除する。
//
// 責務:
//   - TTエントリの検索（lookup）・保存（store）
//   - 置換戦略（Depth Preferred + サイズ制限）
//   - ベストムーブの提供（Move Ordering 用）
//   - 探索診断用の統計情報提供
//
// 第3弾:
//   - 上限到達時の全クリアではなく oldest eviction を導入
//   - 既存エントリ更新時は insertion order を刷新し、最近の深い情報を残しやすくする

import type { Position } from '../../types/game';
import type { TTEntry, TTFlag } from '../../types/ai';
import { TT_CONFIG, AI_FEATURES } from './constants';

// ============================================================
// TT 統計情報
// ============================================================

/**
 * Transposition Table の診断用統計情報。
 * 探索性能の切り分け・計測に使用する。
 */
export interface TTStats {
  /** lookup を試行した回数 */
  lookups: number;

  /** lookup が実際にスコア返却に成功した回数 */
  hits: number;

  /** 実際にエントリを保存した回数 */
  stores: number;

  /** 現在のテーブルサイズ */
  size: number;

  /** 退避（eviction / clear）が発生した回数 */
  evictions: number;
}

// ============================================================
// Transposition Table 本体
// ============================================================

/**
 * 置換表クラス。Map<bigint, TTEntry> をラップし、
 * 検索・保存・サイズ管理のロジックをカプセル化する。
 *
 * 思考単位（calculateNextMove 呼び出し単位）で新規インスタンスを生成する想定。
 * 反復深化の各深さで同じインスタンスを共有することで、
 * 浅い探索の結果を深い探索で活用できる。
 */
export class TranspositionTable {
  private table: Map<bigint, TTEntry>;

  // --- 統計カウンタ ---
  private lookupCount = 0;
  private hitCount = 0;
  private storeCount = 0;
  private evictionCount = 0;

  constructor() {
    this.table = new Map<bigint, TTEntry>();
  }

  /**
   * 指定ハッシュのエントリを検索し、αβ探索に利用できるスコアを返す。
   */
  lookup(
    hash: bigint,
    depth: number,
    alpha: number,
    beta: number
  ): number | null {
    this.lookupCount++;

    const entry = this.table.get(hash);
    if (!entry) return null;

    // 衝突チェック（Mapキーとエントリ内値の二重確認）
    if (entry.hash !== hash) return null;

    // 浅い探索結果は利用しない
    if (entry.depth < depth) return null;

    if (entry.flag === 'EXACT') {
      this.hitCount++;
      return entry.score;
    }

    if (entry.flag === 'LOWERBOUND' && entry.score >= beta) {
      this.hitCount++;
      return entry.score;
    }

    if (entry.flag === 'UPPERBOUND' && entry.score <= alpha) {
      this.hitCount++;
      return entry.score;
    }

    return null;
  }

  /**
   * 指定ハッシュのエントリからベストムーブを取得する。
   * Move Ordering（TT Move の先頭挿入）に使用する。
   */
  getBestMove(hash: bigint): Position | null {
    const entry = this.table.get(hash);
    if (!entry || entry.hash !== hash) return null;

    return entry.bestMove;
  }

  /**
   * 探索結果を置換表に保存する。
   *
   * 置換戦略（Depth Preferred）:
   *   - 既存エントリがない → 新規保存
   *   - 既存より深い探索結果 → 上書き
   *   - 同じ深さ → 上書き（新しい情報を優先）
   *   - 既存より浅い → 保存しない
   *
   * サイズ制限:
   *   - 新規ハッシュ保存時に上限を超えたら oldest eviction。
   *   - feature flag OFF の場合は全クリア。
   */
  store(
    hash: bigint,
    depth: number,
    score: number,
    flag: TTFlag,
    bestMove: Position | null
  ): void {
    const existing = this.table.get(hash);

    // Depth Preferred: 既存より浅い結果は保存しない
    if (existing && existing.depth > depth) {
      return;
    }

    // 新規エントリの場合のみサイズ制限をチェックする。
    // 既存エントリの更新はサイズを増やさない。
    if (!existing && this.table.size >= TT_CONFIG.MAX_ENTRIES) {
      if (AI_FEATURES.ENABLE_TT_OLDEST_EVICTION) {
        const deleteCount = Math.max(
          1,
          Math.floor(this.table.size * TT_CONFIG.EVICTION_RATIO)
        );

        let deleted = 0;

        // Map は挿入順を保持するため、先頭から古いエントリを削除できる。
        for (const key of this.table.keys()) {
          this.table.delete(key);
          deleted++;

          if (deleted >= deleteCount) break;
        }
      } else {
        this.table.clear();
      }

      this.evictionCount++;
    }

    // 既存エントリを上書きする場合は、一度削除して insertion order を刷新する。
    if (existing) {
      this.table.delete(hash);
    }

    this.table.set(hash, {
      hash,
      depth,
      score,
      flag,
      bestMove,
    });

    this.storeCount++;
  }

  /** 置換表を空にする */
  clear(): void {
    this.table.clear();
  }

  /** 現在のエントリ数を返す（デバッグ用） */
  get size(): number {
    return this.table.size;
  }

  /**
   * 現在の統計情報を返す。
   * search.ts 等から探索終了時にログ出力するために使用する。
   */
  get stats(): TTStats {
    return {
      lookups: this.lookupCount,
      hits: this.hitCount,
      stores: this.storeCount,
      size: this.table.size,
      evictions: this.evictionCount,
    };
  }
}