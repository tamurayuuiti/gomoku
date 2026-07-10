// src/workers/aiWorker.types.ts
// AI探索用 Web Worker の通信メッセージ型定義
//
// 責務:
//   - useAiPlayer(メインスレッド) <-> aiWorker(Workerスレッド) 間の
//     postMessage / onmessage で使う Request / Response 型を定義する
//
// 通信データは calculateNextMove の入出力に必要な最小限に留める。

import type { BoardState, Position, Player } from '../types/game';
import type { SearchOptions } from '../utils/ai/constants';

/**
 * メインスレッド → Worker への探索リクエスト。
 * calculateNextMove の引数をそのまま渡せる形にしている。
 */
export interface AiWorkerRequest {
  board: BoardState;
  forbiddenMoves: boolean[][];
  currentPlayer: Player;
  /** 探索オプション（未指定時は AI_CONFIG.MINIMAX_DEPTH を使用） */
  options?: SearchOptions;
}

/**
 * Worker → メインスレッドへの探索結果レスポンス。
 *
 * - 正常終了時: nextMove に着手位置（候補なしの場合は null）
 * - 異常終了時: error にエラーメッセージを格納し、nextMove は null
 */
export interface AiWorkerResponse {
  nextMove: Position | null;
  error?: string;
}