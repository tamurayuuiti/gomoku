// src/utils/ai/searchState.ts
// 第6.2弾：戦術 solver 用 状態管理共通化
//
// 責務:
//   - board / LineCache / CandidateSet / Zobrist hash の着手・復元を一元化する。
//   - minimax の既存挙動を変更しない形で apply / undo を委譲可能にする。
//   - 将来の VCF / Quiescence / Threat solver から再利用できるようにする。
//
// 非責務:
//   - 探索スコア計算
//   - 候補手生成
//   - 禁手判定
//   - TT 操作
//
// 注意:
//   hash は XOR で元に戻せるが、呼び出し側で扱いやすいよう
//   applySearchMove は nextHash を返し、undo 情報に hashBefore を保持する。
//
// v2.0.0 診断整理:
//   - ENABLE_STATE_AUDIT は diagnosticsFlags.ts の DIAGNOSTICS_DEBUG_FLAGS へ移動。

import type { BoardState, Player, Position } from '../../types/game';
import type {
  CandidateSetState,
  CandidateSetUndo,
  LineCacheState,
  SearchStats,
} from '../../types/ai';
import { updateHash } from './zobrist';
import { updateLineCache, undoLineCache } from './lineCache';
import { applyCandidateSet, undoCandidateSet } from './candidateGenerator';
import { recordCandidateSetSize } from './searchStats';
import { DIAGNOSTICS_DEBUG_FLAGS } from './diagnosticsFlags';

/**
 * apply / undo が必要な探索状態の最小集合。
 * SearchContext はこの上位互換として扱える。
 */
export interface SearchStateContainers {
  board: BoardState;
  lineCache: LineCacheState | null;
  candidateSet: CandidateSetState | null;
  forbiddenMoves: boolean[][];
  stats: SearchStats;
}

/**
 * applySearchMove の復元情報。
 */
export interface SearchMoveUndo {
  move: Position;
  player: Player;
  hashBefore: bigint;
  candidateUndo: CandidateSetUndo | null;
}

/**
 * board / LineCache / CandidateSet / hash を一括で着手状態へ進める。
 *
 * 呼び出し元は move が空マスであることを保証すること。
 */
export const applySearchMove = (
  state: SearchStateContainers,
  hash: bigint,
  move: Position,
  player: Player
): { undo: SearchMoveUndo; nextHash: bigint } => {
  const { row, col } = move;

  state.board[row][col] = player;

  if (state.lineCache) {
    updateLineCache(state.lineCache, row, col, player);
    state.stats.cache.lineCacheUpdates++;
  }

  let candidateUndo: CandidateSetUndo | null = null;
  if (state.candidateSet) {
    candidateUndo = applyCandidateSet(
      state.candidateSet,
      state.board,
      state.forbiddenMoves,
      row,
      col
    );
    state.stats.candidateSet.updates++;
    recordCandidateSetSize(state.stats, state.candidateSet.candidates.size);
  }

  const nextHash = updateHash(hash, row, col, player);

  return {
    undo: {
      move,
      player,
      hashBefore: hash,
      candidateUndo,
    },
    nextHash,
  };
};

/**
 * applySearchMove の逆操作。
 *
 * board を空に戻してから LineCache / CandidateSet を復元する。
 * hash の復元は呼び出し側で undo.hashBefore を使う。
 */
export const undoSearchMove = (
  state: SearchStateContainers,
  undo: SearchMoveUndo
): void => {
  const { row, col } = undo.move;

  state.board[row][col] = null;

  if (state.lineCache) {
    undoLineCache(state.lineCache, {
      row,
      col,
      player: undo.player,
    });
    state.stats.cache.lineCacheUndos++;
  }

  if (state.candidateSet && undo.candidateUndo) {
    undoCandidateSet(state.candidateSet, undo.candidateUndo);
    state.stats.candidateSet.undos++;
  }

  if (DIAGNOSTICS_DEBUG_FLAGS.ENABLE_STATE_AUDIT) {
    if (state.board[row][col] !== null) {
      console.warn(
        `[searchState] board undo failed at (${row}, ${col}) player=${undo.player}`
      );
    }
  }
};