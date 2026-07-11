// src/workers/aiWorker.ts
// AI探索専用 Web Worker
//
// 探索アルゴリズム・評価関数（search.ts 以下）には一切手を加えず、
// calculateNextMove を Worker スレッドで呼び出すだけの薄いアダプタとする。
// React・DOM API は Worker スレッドで使用できないため利用しない。

import { calculateNextMove } from '../utils/ai/search';
import type { AiWorkerRequest, AiWorkerResponse } from './aiWorker.types';

self.onmessage = (event: MessageEvent<AiWorkerRequest>) => {
  const { board, forbiddenMoves, currentPlayer, options } = event.data;

  try {
    const nextMove = calculateNextMove(board, forbiddenMoves, currentPlayer, options);
    const response: AiWorkerResponse = { nextMove };
    self.postMessage(response);
  } catch (err) {
    // 例外を投げっぱなしにすると UI 側が isAiThinking を解除できずフリーズし得るため、
    // ここで必ず捕捉してメインスレッドへエラーとして通知する。
    const message = err instanceof Error ? err.message : String(err);
    console.error('[aiWorker] search failed:', err);
    const response: AiWorkerResponse = { nextMove: null, error: message };
    self.postMessage(response);
  }
};