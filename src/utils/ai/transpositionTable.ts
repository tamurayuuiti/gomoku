// src/utils/ai/transpositionTable.ts
// Transposition Table（置換表）の管理モジュール。
//
// 責務:
//   - TT エントリの検索（lookup）・保存（store）
//   - 置換戦略（Depth Preferred）
//   - ベストムーブの提供（Move Ordering 用）
//   - 探索診断用の統計情報提供
//
// 注意:
//   - 思考単位（calculateNextMove 呼び出し単位）で新規インスタンスを生成する想定。
//   - 反復深化の各深さで同じインスタンスを共有し、浅い探索結果を深い探索で活用する。
//   - 内部構造は固定サイズ Typed Array による直接マッピング方式ハッシュテーブル。
//     bigint キーを上位/下位 32bit に分割して格納し、
//     hash の下位ビットをテーブルインデックスとして O(1) アクセスを実現する。

import type { Position } from '../../types/game';
import type { TTFlag } from '../../types/ai';
import { BOARD_SIZE } from '../gameLogic';
import { TT_TABLE_SIZE } from './constants';

// ============================================================
// 内部定数
// ============================================================

/** テーブルインデックス算出用のビットマスク（TABLE_SIZE が 2 の累乗であることを利用） */
const TT_INDEX_MASK = TT_TABLE_SIZE - 1;

/** インデックス計算用の bigint マスク（生成コスト回避のため事前計算） */
const TT_INDEX_MASK_BIGINT = BigInt(TT_INDEX_MASK);

/** TTFlag の数値エンコード */
const FLAG_EXACT = 0;
const FLAG_LOWERBOUND = 1;
const FLAG_UPPERBOUND = 2;

/** bestMove が null であることを表すセンチネル値 */
const NO_BEST_MOVE = -1;

// ============================================================
// 内部ヘルパー
// ============================================================

/** bigint の上位 32bit を数値として取り出す */
const toHigh = (hash: bigint): number =>
  Number((hash >> 32n) & 0xFFFFFFFFn);

/** bigint の下位 32bit を数値として取り出す */
const toLow = (hash: bigint): number =>
  Number(hash & 0xFFFFFFFFn);

/** TTFlag を数値コードへ変換する */
const flagToCode = (flag: TTFlag): number =>
  flag === 'EXACT'
    ? FLAG_EXACT
    : flag === 'LOWERBOUND'
      ? FLAG_LOWERBOUND
      : FLAG_UPPERBOUND;

/** Position を Int32 平坦インデックスへエンコードする */
const encodeBestMove = (move: Position | null): number =>
  move === null ? NO_BEST_MOVE : move.row * BOARD_SIZE + move.col;

/** Int32 平坦インデックスから Position へデコードする */
const decodeBestMove = (encoded: number): Position | null =>
  encoded === NO_BEST_MOVE
    ? null
    : { row: Math.floor(encoded / BOARD_SIZE), col: encoded % BOARD_SIZE };

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
  /** 異なるキーによる上書きが発生した回数 */
  evictions: number;
}

/**
 * TT 拡張統計。
 * 既存 TTStats は後方互換のため維持する。
 */
export interface TTExtendedStats extends TTStats {
  /** EXACT 保存数 */
  storesExact: number;
  /** LOWERBOUND 保存数 */
  storesLower: number;
  /** UPPERBOUND 保存数 */
  storesUpper: number;
  /** 既存エントリが深かったため保存を見送った回数 */
  storesRejectedShallow: number;
  /** getBestMove が非 null の bestMove を返した回数 */
  bestMoveProvided: number;
  /** 最大サイズ */
  maxSize: number;
}

// ============================================================
// Transposition Table 本体
// ============================================================

/**
 * 置換表クラス。
 *
 * 固定サイズ Typed Array ハッシュテーブルを内部に持ち、
 * 検索・保存・サイズ管理のロジックをカプセル化する。
 *
 * ハッシュテーブル方式:
 *   - 直接マッピング（index = hash の下位ビット）
 *   - 同一キーの更新時は Depth Preferred 戦略で置換の可否を判定
 *   - 異なるキーの場合は無条件で上書き（旧 Map 実装の「新規エントリ保存」に相当）
 *   - 線形探査は行わず、1 スロット 1 エントリで O(1) アクセスを保証
 */
export class TranspositionTable {
  // --- 固定サイズ Typed Array ---
  /** hash 上位 32bit（衝突検知用） */
  private keyHigh: Uint32Array;
  /** hash 下位 32bit（衝突検知用） */
  private keyLow: Uint32Array;
  /** スロット占有フラグ（0 = 空, 1 = 使用中） */
  private occupied: Uint8Array;
  /** 探索深度 */
  private depths: Int16Array;
  /** 評価スコア */
  private scores: Float64Array;
  /** TTFlag（数値エンコード） */
  private flags: Uint8Array;
  /** bestMove（row * BOARD_SIZE + col, -1 = null） */
  private bestMoves: Int32Array;

  /** 現在の使用エントリ数 */
  private entryCount = 0;

  // --- 統計カウンタ ---
  private lookupCount = 0;
  private hitCount = 0;
  private storeCount = 0;
  private evictionCount = 0;

  // --- 拡張カウンタ ---
  private storeExactCount = 0;
  private storeLowerCount = 0;
  private storeUpperCount = 0;
  private storeRejectedShallowCount = 0;
  private bestMoveProvidedCount = 0;
  private maxSize = 0;

  constructor() {
    this.keyHigh = new Uint32Array(TT_TABLE_SIZE);
    this.keyLow = new Uint32Array(TT_TABLE_SIZE);
    this.occupied = new Uint8Array(TT_TABLE_SIZE);
    this.depths = new Int16Array(TT_TABLE_SIZE);
    this.scores = new Float64Array(TT_TABLE_SIZE);
    this.flags = new Uint8Array(TT_TABLE_SIZE);
    this.bestMoves = new Int32Array(TT_TABLE_SIZE);
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

    const index = Number(hash & TT_INDEX_MASK_BIGINT);

    // 空スロット
    if (this.occupied[index] === 0) return null;

    // キー不一致（ハッシュ衝突）
    if (
      this.keyHigh[index] !== toHigh(hash) ||
      this.keyLow[index] !== toLow(hash)
    ) {
      return null;
    }

    // 浅い探索結果は利用しない
    if (this.depths[index] < depth) return null;

    const flag = this.flags[index];
    const score = this.scores[index];

    if (flag === FLAG_EXACT) {
      this.hitCount++;
      return score;
    }
    if (flag === FLAG_LOWERBOUND && score >= beta) {
      this.hitCount++;
      return score;
    }
    if (flag === FLAG_UPPERBOUND && score <= alpha) {
      this.hitCount++;
      return score;
    }
    return null;
  }

  /**
   * 指定ハッシュのエントリからベストムーブを取得する。
   * Move Ordering（TT Move の先頭挿入）に使用する。
   */
  getBestMove(hash: bigint): Position | null {
    const index = Number(hash & TT_INDEX_MASK_BIGINT);

    if (this.occupied[index] === 0) return null;

    if (
      this.keyHigh[index] !== toHigh(hash) ||
      this.keyLow[index] !== toLow(hash)
    ) {
      return null;
    }

    const encoded = this.bestMoves[index];
    if (encoded !== NO_BEST_MOVE) {
      this.bestMoveProvidedCount++;
    }
    return decodeBestMove(encoded);
  }

  /**
   * 探索結果を置換表に保存する。
   *
   * 置換戦略:
   *   - 空スロット → 新規保存
   *   - 同一キー:
   *     - 既存より深い探索結果 → 上書き
   *     - 同じ深さ → 上書き（新しい情報を優先）
   *     - 既存より浅い → 保存しない（Depth Preferred）
   *   - 異なるキー → 無条件で上書き
   *     （旧 Map 実装では異なる hash は独立エントリとして必ず保存されていた。
   *       直接マッピング方式では同一インデックスに 1 エントリしか保持できないため、
   *       異なるキーの既存エントリは新しい情報で置き換える）
   */
  store(
    hash: bigint,
    depth: number,
    score: number,
    flag: TTFlag,
    bestMove: Position | null
  ): void {
    const index = Number(hash & TT_INDEX_MASK_BIGINT);
    const high = toHigh(hash);
    const low = toLow(hash);

    // --- 空スロット: 新規格納 ---
    if (this.occupied[index] === 0) {
      this.keyHigh[index] = high;
      this.keyLow[index] = low;
      this.occupied[index] = 1;
      this.depths[index] = depth;
      this.scores[index] = score;
      this.flags[index] = flagToCode(flag);
      this.bestMoves[index] = encodeBestMove(bestMove);
      this.entryCount++;
      this.storeCount++;
      if (flag === 'EXACT') {
        this.storeExactCount++;
      } else if (flag === 'LOWERBOUND') {
        this.storeLowerCount++;
      } else {
        this.storeUpperCount++;
      }
      if (this.entryCount > this.maxSize) {
        this.maxSize = this.entryCount;
      }
      return;
    }

    // --- 同一キー: Depth Preferred 判定 ---
    if (this.keyHigh[index] === high && this.keyLow[index] === low) {
      if (this.depths[index] > depth) {
        this.storeRejectedShallowCount++;
        return;
      }
      // 上書き（同一キーの更新）
      this.depths[index] = depth;
      this.scores[index] = score;
      this.flags[index] = flagToCode(flag);
      this.bestMoves[index] = encodeBestMove(bestMove);
      this.storeCount++;
      if (flag === 'EXACT') {
        this.storeExactCount++;
      } else if (flag === 'LOWERBOUND') {
        this.storeLowerCount++;
      } else {
        this.storeUpperCount++;
      }
      return;
    }

    // --- 異なるキー: 無条件で上書き ---
    this.evictionCount++;
    this.keyHigh[index] = high;
    this.keyLow[index] = low;
    this.depths[index] = depth;
    this.scores[index] = score;
    this.flags[index] = flagToCode(flag);
    this.bestMoves[index] = encodeBestMove(bestMove);
    this.storeCount++;
    if (flag === 'EXACT') {
      this.storeExactCount++;
    } else if (flag === 'LOWERBOUND') {
      this.storeLowerCount++;
    } else {
      this.storeUpperCount++;
    }
  }

  /** 置換表を空にする */
  clear(): void {
    this.occupied.fill(0);
    this.entryCount = 0;
  }

  /** 現在のエントリ数を返す（デバッグ用） */
  get size(): number {
    return this.entryCount;
  }

  /**
   * 現在の統計情報を返す。
   * search.ts 等から探索終了時にログ出力するために使用する。
   */
  get stats(): TTExtendedStats {
    return {
      lookups: this.lookupCount,
      hits: this.hitCount,
      stores: this.storeCount,
      size: this.entryCount,
      evictions: this.evictionCount,
      storesExact: this.storeExactCount,
      storesLower: this.storeLowerCount,
      storesUpper: this.storeUpperCount,
      storesRejectedShallow: this.storeRejectedShallowCount,
      bestMoveProvided: this.bestMoveProvidedCount,
      maxSize: this.maxSize,
    };
  }
}