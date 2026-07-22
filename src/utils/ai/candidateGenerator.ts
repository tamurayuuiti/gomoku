// src/utils/ai/candidateGenerator.ts
// 候補手生成・move ordering・killer heuristic・history heuristic を担うモジュール
//
// KillerTable / HistoryTable / ScoredPosition の型定義は minimax.ts と共有するため
// types/ai.ts に集約されている。このファイルはそれらの型を使った生成・操作ロジックを担う。
//
// @future countermove heuristic（直前手をキーとするテーブル）

import type { BoardState, Position, Player } from '../../types/game';
import type { KillerEntry, KillerTable, HistoryTable, ScoredPosition } from '../../types/ai';
import { BOARD_SIZE } from '../gameLogic';
import { AI_CONFIG, AI_SCORES } from './constants';
import { evaluatePosition, hasStoneNearby } from './evaluator';

// ============================================================
// Killer table 生成・操作
// ============================================================

/** killer table が対応する最大探索深さ */
export const MAX_KILLER_DEPTH = 8 as const;

export const createKillerTable = (): KillerTable =>
  Array.from({ length: MAX_KILLER_DEPTH }, (): KillerEntry => [null, null]);

// ============================================================
// History table 生成・操作
// ============================================================

export const createHistoryTable = (): HistoryTable => ({
  Black: Array.from({ length: BOARD_SIZE }, () => new Array<number>(BOARD_SIZE).fill(0)),
  White: Array.from({ length: BOARD_SIZE }, () => new Array<number>(BOARD_SIZE).fill(0)),
});

// ============================================================
// CRITICAL 閾値
// ============================================================

/**
 * CRITICAL tier と REST tier を区切るスコア閾値。
 * DOUBLE_THREE 以上（DOUBLE_THREE / FOUR_THREE / DOUBLE_FOUR / OPEN_FOUR / DEFEND_WIN / WIN）
 * は常に先頭に来るため killer 管理は不要とみなす。
 */
export const CRITICAL_SCORE_THRESHOLD = AI_SCORES.DOUBLE_THREE; // 50_000

// ============================================================
// Killer move management
// ============================================================

/**
 * β カットオフを引き起こした手を killer table に記録する。
 * slot[0] が最新・slot[1] が次点。CRITICAL 手は呼び出し元で除外済み。
 */
export const storeKiller = (
  killerTable: KillerTable,
  depth: number,
  pos: Position
): void => {
  if (depth >= MAX_KILLER_DEPTH) return;

  const slot = killerTable[depth];
  if (slot[0]?.row === pos.row && slot[0]?.col === pos.col) return;

  slot[1] = slot[0];
  slot[0] = { row: pos.row, col: pos.col };
};

/** 指定座標が depth の killer move に登録されているか確認する */
export const isKiller = (
  killerTable: KillerTable,
  depth: number,
  row: number,
  col: number
): boolean => {
  if (depth >= MAX_KILLER_DEPTH) return false;

  const [k0, k1] = killerTable[depth];
  return (
    (k0?.row === row && k0?.col === col) ||
    (k1?.row === row && k1?.col === col)
  );
};

// ============================================================
// History heuristic management
// ============================================================

/**
 * カットオフを引き起こした手を history table に加点記録する。
 * 深いノードでのカットオフほど広い部分木の枝刈りに貢献したとみなし、depth^2 で重く評価する。
 * player 単位でテーブルを分けるため、自分の手番の中でのみ履歴が比較される。
 */
export const storeHistory = (
  historyTable: HistoryTable,
  player: Player,
  depth: number,
  pos: Position
): void => {
  historyTable[player][pos.row][pos.col] += depth * depth;
};

/** 指定座標の history スコアを取得する（未記録なら 0） */
export const getHistoryScore = (
  historyTable: HistoryTable,
  player: Player,
  row: number,
  col: number
): number => historyTable[player][row][col];

// ============================================================
// 候補手生成（4 tier move ordering）
// ============================================================

/**
 * 候補手を 4 tier に分類して結合し、上位 MAX_CANDIDATES 手を返す。
 *
 * Tier -1 (TT MOVE): Transposition Table に登録された「過去の最善手」。
 *   同一局面の再探索時に最も枝刈り効果が高いため、最優先で試す。
 * Tier 0 (CRITICAL): evaluatePosition スコアが CRITICAL_SCORE_THRESHOLD 以上の手
 *   （WIN / DEFEND_WIN / OPEN_FOUR / 四三 / 双三）。αβ の境界を早期更新し枝刈り率を最大化する。
 * Tier 1 (KILLER): killer table に登録された「静かな手（CRITICAL 未満）」。
 *   兄弟ノードで β カットオフを引き起こした実績を持つ手を REST より先に試す。
 * Tier 2 (REST): 上記以外。evaluatePosition 降順を主キー、history heuristic を
 *   補助的な副キーとして安定ソートする（評価スコアの大小関係は history で逆転しない）。
 *
 * @future countermove heuristic を killer tier に追加
 *
 * @param board          現在の盤面
 * @param player         手番プレイヤー
 * @param forbiddenMoves 禁じ手マップ
 * @param killerTable    killer table（SearchContext から渡す）
 * @param historyTable   history table（SearchContext から渡す。REST tier の補助ソートに使用）
 * @param depth          現在の探索深さ（killer 参照に使用）
 * @param ttBestMove     Transposition Table から取得したこの局面の最善手（未登録なら null）
 * @returns              ordered な ScoredPosition 配列（上限 MAX_CANDIDATES）。
 *                        score を保持したまま返すため呼び出し元での再計算が不要。
 */
export const generateOrderedCandidates = (
  board: BoardState,
  player: Player,
  forbiddenMoves: boolean[][],
  killerTable: KillerTable,
  historyTable: HistoryTable,
  depth: number,
  ttBestMove: Position | null = null
): ScoredPosition[] => {
  const scored: ScoredPosition[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      scored.push({
        pos: { row: r, col: c },
        score: evaluatePosition(board, r, c, player),
      });
    }
  }

  if (scored.length === 0) return [];

  // score 降順（WIN > DEFEND_WIN > ... の自然な tier 順を維持）
  scored.sort((a, b) => b.score - a.score);

  const ttTier: ScoredPosition[] = [];
  const criticalTier: ScoredPosition[] = [];
  const killerTier: ScoredPosition[] = [];
  const restTier: ScoredPosition[] = [];

  // TT Move を最優先で抽出（重複排除のため、他の tier からは除外する）
  const ttMoveKey = ttBestMove ? `${ttBestMove.row},${ttBestMove.col}` : null;

  for (const entry of scored) {
    const { pos, score } = entry;
    const posKey = `${pos.row},${pos.col}`;

    // TT Move は Tier -1 へ（重複排除）
    if (ttMoveKey !== null && posKey === ttMoveKey) {
      ttTier.push(entry);
      continue;
    }

    if (score >= CRITICAL_SCORE_THRESHOLD) {
      criticalTier.push(entry);
    } else if (isKiller(killerTable, depth, pos.row, pos.col)) {
      killerTier.push(entry);
    } else {
      restTier.push(entry);
    }
  }

  restTier.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    const historyA = getHistoryScore(historyTable, player, a.pos.row, a.pos.col);
    const historyB = getHistoryScore(historyTable, player, b.pos.row, b.pos.col);
    return historyB - historyA;
  });

  // CRITICAL が既に MAX_CANDIDATES を超える局面（多重勝利等）では
  // CRITICAL のみ返すことで探索が迅速に収束する
  const ordered = [...ttTier, ...criticalTier, ...killerTier, ...restTier];
  return ordered.slice(0, AI_CONFIG.MAX_CANDIDATES);
};