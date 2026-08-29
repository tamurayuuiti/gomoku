// src/types/game.ts
// ゲーム全体（盤面・進行・ルール）で共有される型定義をまとめるファイル。
//
// 方針:
//   - 複数ファイルから参照される型のみをここに置く。
//   - 単一ファイル内でのみ使う型は定義元に残す。
//   - AI 探索専用の型は責務が異なるため types/ai.ts に置く。

// ============================================================
// 盤面・進行状態
// ============================================================

export type Player = 'Black' | 'White';
export type Cell = Player | null;
export type BoardState = Cell[][];
export type GameStatus = 'Playing' | 'BlackWins' | 'WhiteWins' | 'Draw';

export interface Position {
  row: number;
  col: number;
}

// ============================================================
// ゲームモード
// ============================================================

export type GameMode = 'PvP' | 'PvE';

// ============================================================
// AI レベル
// ============================================================

/**
 * AI の強さレベル。
 * 数値が大きいほど探索深度・思考時間が増加する。
 */
export type AiLevel = 1 | 2 | 3 | 4;

// ============================================================
// 禁じ手ルール
// ============================================================

export type ForbiddenReason = 'Three-Three' | 'Four-Four' | 'Long-Line' | null;

export interface ForbiddenResult {
  isForbidden: boolean;
  reason: ForbiddenReason;
}

// ============================================================
// 設定変更
// ============================================================

/**
 * 対局中に変更しようとして、確認待ちになっている設定変更の内容。
 */
export type PendingSettingChange =
  | { kind: 'forbiddenRule' }
  | { kind: 'playerColor'; color: Player }
  | { kind: 'gameMode'; mode: GameMode }
  | { kind: 'aiLevel'; level: AiLevel };