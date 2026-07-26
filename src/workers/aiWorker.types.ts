// src/workers/aiWorker.types.ts
// AI探索用 Web Worker の通信メッセージ型定義
//
// useAiPlayer(メインスレッド) <-> aiWorker(Workerスレッド) 間の
// postMessage / onmessage で使う Request / Response 型を定義する。
// 通信データは calculateNextMove の入出力に必要な最小限に留める。
//
// 追加:
//   - 対局終了時に Worker 側で全体統計を確定するための制御メッセージを追加。

import type { BoardState, Position, Player } from '../types/game';
import type { SearchOptions } from '../types/ai';

/** メインスレッド → Worker への探索リクエスト（calculateNextMove の引数をそのまま渡せる形） */
export interface AiWorkerRequest {
  board: BoardState;
  forbiddenMoves: boolean[][];
  currentPlayer: Player;

  /** 未指定時は AI_CONFIG.MINIMAX_DEPTH を使用 */
  options?: SearchOptions;
}

/**
 * Worker → メインスレッドへの探索結果レスポンス。
 * 正常終了時は nextMove に着手位置（候補なしなら null）、
 * 異常終了時は error にメッセージを格納し nextMove は null。
 */
export interface AiWorkerResponse {
  nextMove: Position | null;
  error?: string;
}

/**
 * AI から見た対局結果。
 * Worker 側の GameSessionStats と整合させる。
 */
export type AiGameResult = 'Win' | 'Loss' | 'Draw' | 'Unknown';

/**
 * 対局終了時にメインスレッドから Worker へ送る制御メッセージ。
 * 探索リクエストとは別系統。
 */
export interface AiWorkerControlMessage {
  control: 'finalizeGameSession';
  aiResult?: AiGameResult;
}

/** Worker が受け取るメッセージ全体 */
export type AiWorkerIncomingMessage =
  | AiWorkerRequest
  | AiWorkerControlMessage;