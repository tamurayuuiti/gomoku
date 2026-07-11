// src/types/game.ts
// ゲーム全体（盤面・進行・ルール）で共有される型定義をまとめるファイル。
// 複数ファイルから参照される型のみをここに置く。単一ファイル内でしか
// 使われない型（コンポーネントのProps等）はこのファイルに集約しない。
// AI探索専用の型（候補手・探索テーブル等）は責務が異なるため types/ai.ts に置く。

// --- 盤面・進行状態 ---
export type Player = 'Black' | 'White';
export type Cell = Player | null;
export type BoardState = Cell[][];
export type GameStatus = 'Playing' | 'BlackWins' | 'WhiteWins' | 'Draw';

export interface Position {
  row: number;
  col: number;
}

// --- ゲームモード ---
export type GameMode = 'PvP' | 'PvE';

// --- 禁じ手ルール ---
export type ForbiddenReason = 'Three-Three' | 'Four-Four' | 'Long-Line' | null;

export interface ForbiddenResult {
  isForbidden: boolean;
  reason: ForbiddenReason;
}