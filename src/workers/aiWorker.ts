// src/workers/aiWorker.ts
// AI 探索専用 Web Worker。
//
// 責務:
//   - calculateNextMove を Worker スレッドで呼び出す薄いアダプタ
//   - 対局終了制御メッセージの受信と統計確定
//
// 注意:
//   - React / DOM API は Worker で使用しない。
//   - 探索ロジック自体には関与しない。

import { calculateNextMove } from '@/utils/ai/search';
import { finalizeGameSession } from '@/utils/ai/searchStats';
import type {
  AiWorkerIncomingMessage,
  AiWorkerRequest,
  AiWorkerResponse,
} from './aiWorker.types';

self.onmessage = (event: MessageEvent<AiWorkerIncomingMessage>) => {
  const data = event.data;

  // ------------------------------------------------------------
  // 制御メッセージ
  // ------------------------------------------------------------
  if (data && 'control' in data) {
    if (data.control === 'finalizeGameSession') {
      finalizeGameSession(data.aiResult ?? 'Unknown');
    }
    return;
  }

  // ------------------------------------------------------------
  // 通常探索リクエスト
  // ------------------------------------------------------------
  const request = data as AiWorkerRequest;
  const { board, forbiddenMoves, currentPlayer, options } = request;

  try {
    const nextMove = calculateNextMove(
      board,
      forbiddenMoves,
      currentPlayer,
      options
    );

    const response: AiWorkerResponse = { nextMove };
    self.postMessage(response);
  } catch (err) {
    // 例外を投げっぱなしにすると UI 側が isAiThinking を解除できず
    // フリーズし得るため、必ず捕捉してメインスレッドへ通知する。
    const message = err instanceof Error ? err.message : String(err);

    console.error('[aiWorker] search failed:', err);

    const response: AiWorkerResponse = { nextMove: null, error: message };
    self.postMessage(response);
  }
};