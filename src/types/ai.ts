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