// src/types/game.ts
// ゲームの状態を表す型定義ファイル

// ゲームモードの定義
export type GameMode = 'PvP' | 'PvE';

// プレイヤーの型定義（黒番が先手）
export type Player = 'Black' | 'White';

// マスの状態（空の場合はnull）
export type CellState = Player | null;

// 盤面全体の状態
export type BoardState = CellState[][];

// 座標の型定義
export interface Position {
  row: number;
  col: number;
}

// ゲームの勝敗ステータス
export type GameStatus = 'Playing' | 'BlackWins' | 'WhiteWins' | 'Draw';