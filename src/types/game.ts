// src/types/game.ts

export type Player = 'Black' | 'White';
export type Cell = Player | null;
export type BoardState = Cell[][];
export type GameStatus = 'Playing' | 'BlackWins' | 'WhiteWins' | 'Draw';

export interface Position {
  row: number;
  col: number;
}

export type GameMode = 'PvP' | 'PvE';

// --- 新規追加 ---
export type ForbiddenReason = 'Three-Three' | 'Four-Four' | 'Long-Line' | null;

export interface ForbiddenResult {
  isForbidden: boolean;
  reason: ForbiddenReason;
}