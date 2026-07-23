// src/types/ai.ts
// AI探索（utils/ai配下）で複数ファイルにまたがって共有される型定義をまとめるファイル。
//
// 配置方針:
//   - ゲームの盤面・進行状態とは責務が異なる「探索アルゴリズム内部の型」をここに集約する。
//   - 単一ファイル内でしか使われない型（例: minimax.ts の SearchContext）は定義元に残す。
//   - 型の生成ファクトリ関数（createKillerTable 等）や定数・スコア値はロジックであり
//     型ではないため、従来通り定義元のファイルに残す。

import type { Position, Player } from './game';

// --- パターン評価（evaluator.ts / boardEvaluator.ts で共有） ---

export type PatternType =
  | 'WIN'
  | 'OPEN_FOUR'
  | 'CLOSED_FOUR'
  | 'OPEN_THREE'
  | 'CLOSED_THREE'
  | 'OPEN_TWO'
  | 'CLOSED_TWO'
  | 'SINGLE';

export type PatternCount = Record<PatternType, number>;

// --- 探索オプション（search.ts / aiWorker.types.ts で共有） ---

export interface SearchOptions {
  /** 探索深さの上書き（未指定時は AI_CONFIG.MINIMAX_DEPTH） */
  depth?: number;

  /**
   * 探索時間上限 [ms]。指定すると search.ts 側で depth=1,2,3... と反復深化を行い、
   * 制限時間内に完了した最後の深さの結果を採用する。未指定時は depth 固定の従来動作。
   */
  timeLimitMs?: number;

  /**
   * 直前手（Countermove Heuristic のルート強化用）。
   *
   * - 未指定でも探索中は着手ごとに lastMove が自動伝播する。
   * - UI 側から実際の直前手を渡すと、ルートノードでの countermove 精度が向上する。
   * - Worker 通信との後方互換のため任意項目とする。
   */
  lastMove?: Position | null;
}

// --- 候補手（candidateGenerator.ts / minimax.ts で共有） ---

/**
 * evaluatePosition の結果を保持したまま候補手を表す型。
 * minimax.ts で同一候補への再計算を避けるために使う。
 */
export interface ScoredPosition {
  pos: Position;
  score: number;
}

/**
 * 候補手の戦術的性質・ordering 属性を表すフラグ。
 *
 * LMR / PVS / 候補手絞り込みで使用する。
 * score の意味そのものは変更せず、探索制御用の補助情報として扱う。
 */
export interface CandidateFlags {
  /** Transposition Table に登録されていた最善手 */
  isTTMove: boolean;

  /** killer heuristic に登録されていた手 */
  isKiller: boolean;

  /** countermove heuristic に登録されていた手 */
  isCountermove: boolean;

  /**
   * 戦術的に最重要の手。
   * WIN / DEFEND_WIN / OPEN_FOUR / DOUBLE_FOUR / FOUR_THREE / DOUBLE_THREE 相当。
   */
  isCritical: boolean;

  /**
   * 戦術手として LMR 除外対象にする手。
   * isCritical に加え、CLOSED_FOUR 以上の明確な脅威を含む。
   */
  isTactical: boolean;

  /** 静かな手（LMR 適用候補） */
  isQuiet: boolean;

  /** LMR を適用してよいか */
  reductionAllowed: boolean;
}

/**
 * 候補手生成の結果を表す型。
 * ScoredPosition に探索制御用フラグを付与する。
 */
export interface OrderedCandidate extends ScoredPosition {
  flags: CandidateFlags;
}

// --- Killer heuristic（candidateGenerator.ts / minimax.ts で共有） ---

/** 深さ 1 レベルの killer スロット（最新 / 次点） */
export type KillerEntry = [Position | null, Position | null];

/** killer table 本体。インデックスが深さに対応し、SearchContext（minimax.ts）から参照・渡される。 */
export type KillerTable = KillerEntry[];

// --- History heuristic（candidateGenerator.ts / minimax.ts で共有） ---

/**
 * history heuristic 用のスコアテーブル。historyTable[player][row][col] に
 * 「その手が過去にカットオフを引き起こした深さ」に基づく加点を累積する。
 *
 * KillerTable が「直近 2 手・深さごと」の局所的な記録なのに対し、
 * HistoryTable は探索木全体を通じて手番（player）単位で累積する
 * グローバルな統計であり、SearchContext に 1 つだけ保持する。
 */
export type HistoryTable = Record<Player, number[][]>;

// --- Countermove heuristic（candidateGenerator.ts / minimax.ts で共有） ---

/**
 * countermove heuristic 用テーブル。
 *
 * table[player][lastMoveIndex] = player 側が lastMove に対してカットオフを起こした応手。
 * lastMoveIndex = row * BOARD_SIZE + col で平坦化する。
 *
 * 例:
 *   相手が (r,c) に打った → 自分が (r2,c2) で β カットオフを起こした
 *   table[自分の手番][index(r,c)] = { row: r2, col: c2 }
 */
export type CountermoveTable = Record<Player, (Position | null)[]>;

// --- Transposition Table（transpositionTable.ts / minimax.ts で共有） ---

/**
 * TTエントリの種別。
 * - EXACT: 正確なスコア（α < score < β の範囲で探索完了）
 * - LOWERBOUND: 下限値（score >= β でカットオフ発生。真のスコアはこれ以上）
 * - UPPERBOUND: 上限値（score <= α で終了。真のスコアはこれ以下）
 */
export type TTFlag = 'EXACT' | 'LOWERBOUND' | 'UPPERBOUND';

/**
 * Transposition Table に保存するエントリ。
 * hash は Map のキーと同一値を保持し、衝突時の二重チェックに使う。
 */
export interface TTEntry {
  /** 盤面ハッシュ（衝突検知用） */
  hash: bigint;

  /** このエントリを生成した探索の残り深さ */
  depth: number;

  /** 探索スコア（aiPlayer 視点） */
  score: number;

  /** スコアの信頼性種別 */
  flag: TTFlag;

  /** この局面での最善手（Move Ordering に使用） */
  bestMove: Position | null;
}

// --- LineCache（lineCache.ts / evaluator.ts / boardEvaluator.ts / minimax.ts で共有） ---

/**
 * 1方向分のラインキャッシュ。
 * [row][col] に 9 文字ライン文字列を保持する。
 */
export type LineCacheDirectionCache = string[][];

/**
 * ある手番視点の全方向ラインキャッシュ。
 * DIRECTIONS の順に 4 要素持つ。
 */
export type LineCachePerspective = LineCacheDirectionCache[];

/**
 * 盤面全体のラインキャッシュ。
 * Black 視点・White 視点の両方を保持する。
 */
export interface LineCacheState {
  caches: Record<Player, LineCachePerspective>;
}

/**
 * LineCache 差分更新の undo 情報。
 * 着手前の空マス状態へ戻すため、着手位置と手番のみで十分。
 */
export interface LineCacheUndo {
  row: number;
  col: number;
  player: Player;
}

// --- CandidateSet（candidateGenerator.ts / minimax.ts / boardEvaluator.ts で共有） ---

/**
 * CandidateSet の差分更新で影響を受けたセルの旧状態。
 */
export interface CandidateSetChange {
  /** row * BOARD_SIZE + col */
  index: number;

  /** 更新前の近接石カウント */
  oldRefCount: number;

  /** 更新前に候補集合に含まれていたか */
  oldIsCandidate: boolean;
}

/**
 * CandidateSet の undo 情報。
 */
export interface CandidateSetUndo {
  affected: CandidateSetChange[];
}

/**
 * 候補集合の増分管理状態。
 *
 * - candidates: 候補マス（空マスかつ近傍に石あり、禁手ではない）の flat index 集合
 * - isCandidate: 候補かどうかの高速参照用マップ
 * - refCount: 各空マスについて、SEARCH_RANGE 内にある石の数
 */
export interface CandidateSetState {
  candidates: Set<number>;
  isCandidate: boolean[][];
  refCount: number[][];
}