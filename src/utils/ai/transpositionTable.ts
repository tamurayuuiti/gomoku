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
// @future 世代管理（Age）によるサイズ制限の高度化、
//         クラスター化（バケット方式）による衝突耐性向上

import type { Position } from '../../types/game';
import type { TTEntry, TTFlag } from '../../types/ai';
import { TT_CONFIG } from './constants';

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

  constructor() {
    this.table = new Map<bigint, TTEntry>();
  }

  /**
   * 指定ハッシュのエントリを検索し、αβ探索に利用できるスコアを返す。
   *
   * 利用条件:
   *   - エントリが存在する
   *   - エントリの深度が現在の残り深度以上（浅い結果は信頼できないため）
   *
   * スコア返却ルール:
   *   - EXACT: そのまま返す
   *   - LOWERBOUND: score >= beta なら返す（βカットオフ相当）
   *   - UPPERBOUND: score <= alpha なら返す（α更新相当）
   *   - 条件を満たさない場合は null（探索継続）
   *
   * @param hash  現在の盤面ハッシュ
   * @param depth 現在の残り探索深さ
   * @param alpha 現在のα値
   * @param beta  現在のβ値
   * @returns 利用可能なスコア、または null
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
   *
   * @param hash 現在の盤面ハッシュ
   * @returns ベストムーブ、または null
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
   *   - エントリ数が TT_CONFIG.MAX_ENTRIES を超えたら全クリア。
   *     簡易的なメモリ管理。@future 世代管理（LRU/Age）へ改善予定。
   *
   * @param hash     盤面ハッシュ
   * @param depth    探索深さ
   * @param score    探索スコア
   * @param flag     エントリ種別（EXACT/LOWERBOUND/UPPERBOUND）
   * @param bestMove その局面での最善手（Move Ordering 用）
   */
  store(
    hash: bigint,
    depth: number,
    score: number,
    flag: TTFlag,
    bestMove: Position | null
  ): void {
    // サイズ制限チェック（簡易版: 上限超過で全クリア）
    if (this.table.size >= TT_CONFIG.MAX_ENTRIES) {
      this.table.clear();
    }

    const existing = this.table.get(hash);

    // Depth Preferred: 既存より浅い結果は保存しない
    if (existing && existing.depth > depth) {
      return;
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
    };
  }
}