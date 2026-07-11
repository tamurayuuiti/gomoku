// src/utils/ai/candidateGenerator.ts
// 候補手生成・move ordering・killer heuristic・history heuristic を担うモジュール
//
// 責務:
//   - KillerTable の生成・操作（storeKiller / isKiller）
//   - HistoryTable の生成・操作（storeHistory / getHistoryScore）
//   - 3 tier move ordering（CRITICAL / KILLER / REST）＋ REST 内の history 補助ソート
//   - 候補手の上限絞り込み（MAX_CANDIDATES）
//
// KillerTable / HistoryTable / ScoredPosition の型定義は minimax.ts と共有するため
// types/ai.ts に集約されている。このファイルはそれらの型を使った生成・操作ロジックを担う。
//
// 【将来の拡張ポイント】
//   - countermove heuristic: 直前手をキーとするテーブルを追加
//   - TT ベストムーブ: generateOrderedCandidates の先頭に TT ヒット手を挿入

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

/** 空の KillerTable を生成するファクトリ */
export const createKillerTable = (): KillerTable =>
  Array.from({ length: MAX_KILLER_DEPTH }, (): KillerEntry => [null, null]);


// ============================================================
// History table 生成・操作
// ============================================================

/** 空の HistoryTable を生成するファクトリ（Black/White それぞれ BOARD_SIZE 四方を 0 初期化） */
export const createHistoryTable = (): HistoryTable => ({
  Black: Array.from({ length: BOARD_SIZE }, () => new Array<number>(BOARD_SIZE).fill(0)),
  White: Array.from({ length: BOARD_SIZE }, () => new Array<number>(BOARD_SIZE).fill(0)),
});


// ============================================================
// CRITICAL 閾値
// ============================================================

/**
 * CRITICAL tier と REST tier を区切るスコア閾値。
 * DOUBLE_THREE 以上（DOUBLE_THREE / FOUR_THREE / DOUBLE_FOUR /
 * OPEN_FOUR / DEFEND_WIN / WIN）を CRITICAL とみなす。
 * これらは常に先頭に来るため killer 管理は不要。
 *
 * 【将来の調整ポイント】
 * 閾値を引き上げると killer の対象が増え、
 * 引き下げると CRITICAL tier が広がる。
 * 現状は DOUBLE_THREE（50_000）が適切な境界。
 */
export const CRITICAL_SCORE_THRESHOLD = AI_SCORES.DOUBLE_THREE; // 50_000


// ============================================================
// Killer move management
// ============================================================

/**
 * β カットオフを引き起こした手を killer table に記録する。
 *
 * - 同じ手を重複登録しない
 * - slot[0] が最新で slot[1] が次点
 * - CRITICAL 手（WIN 相当）は呼び出し元で除外済み
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
 *
 * 加点方式: depth^2（一般的な history heuristic の重み付け）。
 * 深い（＝残り探索深さが大きい）ノードでのカットオフほど、
 * それだけ広い部分木の枝刈りに貢献したとみなして重く評価する。
 *
 * player 単位でテーブルを分けているため、自分の手番の中でだけ
 * 履歴が比較される（相手の手と混同しない）。
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
// 候補手生成（3 tier move ordering）
// ============================================================

/**
 * 候補手を 3 tier に分類して結合し、上位 MAX_CANDIDATES 手を返す。
 *
 * Tier 0 (CRITICAL):
 *   evaluatePosition スコア >= CRITICAL_SCORE_THRESHOLD の手。
 *   WIN / DEFEND_WIN / OPEN_FOUR / 四三 / 双三 が該当。
 *   αβ の α/β 境界を早期更新し、後続手の枝刈り率を最大化する。
 *
 * Tier 1 (KILLER):
 *   killer table に登録された「静かな手（CRITICAL 未満）」。
 *   兄弟ノードで β カットオフを引き起こした実績を持つ手。
 *   CRITICAL 未満でも探索上重要な手を REST より先に試せる。
 *
 * Tier 2 (REST):
 *   上記以外。evaluatePosition 降順を主キーとし、
 *   history heuristic のスコアを補助的な副キーとして安定ソートする
 *   （evaluatePosition の大小関係は history によって逆転しない）。
 *
 * 【将来の拡張ポイント】
 *   - countermove heuristic: 直前手への対応として有効だった手を killer tier に追加
 *   - TT ベストムーブ: 置換表ヒット時は先頭に挿入（Tier -1 相当）
 *
 * @param board          現在の盤面
 * @param player         手番プレイヤー
 * @param forbiddenMoves 禁じ手マップ
 * @param killerTable    killer table（SearchContext から渡す）
 * @param historyTable   history table（SearchContext から渡す。REST tier の補助ソートに使用）
 * @param depth          現在の探索深さ（killer 参照に使用）
 * @returns              ordered な ScoredPosition 配列（上限 MAX_CANDIDATES）
 *                        evaluatePosition の score を保持したまま返すため、
 *                        呼び出し元での再計算が不要になる。
 */
export const generateOrderedCandidates = (
  board: BoardState,
  player: Player,
  forbiddenMoves: boolean[][],
  killerTable: KillerTable,
  historyTable: HistoryTable,
  depth: number
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

  const criticalTier: ScoredPosition[] = [];
  const killerTier: ScoredPosition[] = [];
  const restTier: ScoredPosition[] = [];

  for (const entry of scored) {
    const { pos, score } = entry;
    if (score >= CRITICAL_SCORE_THRESHOLD) {
      criticalTier.push(entry);
    } else if (isKiller(killerTable, depth, pos.row, pos.col)) {
      killerTier.push(entry);
    } else {
      restTier.push(entry);
    }
  }

  // REST tier: evaluatePosition スコアの大小関係は変えず、
  // 同一スコアの手同士に限って history heuristic のスコアで降順に並べ替える。
  // （評価スコアが主キー・history は補助的な副キーという位置づけを厳密に保つ）
  restTier.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const historyA = getHistoryScore(historyTable, player, a.pos.row, a.pos.col);
    const historyB = getHistoryScore(historyTable, player, b.pos.row, b.pos.col);
    return historyB - historyA;
  });

  // CRITICAL が既に MAX_CANDIDATES を超える局面（多重勝利等）では
  // CRITICAL のみ返すことで探索が迅速に収束する
  const ordered = [...criticalTier, ...killerTier, ...restTier];
  return ordered.slice(0, AI_CONFIG.MAX_CANDIDATES);
};