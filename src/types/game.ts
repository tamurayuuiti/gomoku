// src/types/game.ts
// ゲーム全体で使用する型定義をまとめるファイル

export type Player = 'Black' | 'White';
export type Cell = Player | null;
export type BoardState = Cell[][];
export type GameStatus = 'Playing' | 'BlackWins' | 'WhiteWins' | 'Draw';

export interface Position {
  row: number;
  col: number;
}

// AI関連の型定義
export interface AICandidate extends Position {
  score: number;
}

export type GameMode = 'PvP' | 'PvE';

export type ForbiddenReason = 'Three-Three' | 'Four-Four' | 'Long-Line' | null;

export interface ForbiddenResult {
  isForbidden: boolean;
  reason: ForbiddenReason;
}