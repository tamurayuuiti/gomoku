// src/workers/aiWorker.ts
// AI探索専用 Web Worker
//
// 責務:
//   - メインスレッドから盤面データを受け取る
//   - calculateNextMove（探索ロジック本体）を実行する
//   - 着手位置のみをメインスレッドへ返す
//
// 【設計方針】
// - 探索アルゴリズム・評価関数（search.ts 以下）には一切手を加えない。
//   このファイルは「calculateNextMove を Worker スレッドで呼び出すだけ」の薄いアダプタ。
// - React・DOM API は使用しない（Worker スレッドでは利用不可のため）。

import { calculateNextMove } from '../utils/ai/search';
import type { AiWorkerRequest, AiWorkerResponse } from './aiWorker.types';

self.onmessage = (event: MessageEvent<AiWorkerRequest>) => {
  const { board, forbiddenMoves, currentPlayer, options } = event.data;

  try {
    const nextMove = calculateNextMove(board, forbiddenMoves, currentPlayer, options);
    const response: AiWorkerResponse = { nextMove };
    self.postMessage(response);
  } catch (err) {
    // Worker 内の例外はここで必ず捕捉し、メインスレッドへエラーとして通知する。
    // 例外を投げっぱなしにすると UI 側が isAiThinking を解除できずフリーズし得るため。
    const message = err instanceof Error ? err.message : String(err);
    console.error('[aiWorker] search failed:', err);
    const response: AiWorkerResponse = { nextMove: null, error: message };
    self.postMessage(response);
  }
};