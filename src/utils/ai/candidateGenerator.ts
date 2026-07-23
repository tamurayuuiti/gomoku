// src/utils/ai/candidateGenerator.ts
// 候補手生成・move ordering・killer heuristic・history heuristic・countermove heuristic を担うモジュール
//
// KillerTable / HistoryTable / CountermoveTable / ScoredPosition / OrderedCandidate の型定義は
// minimax.ts と共有するため types/ai.ts に集約されている。
// このファイルはそれらの型を使った生成・操作ロジックを担う。

import type { BoardState, Position, Player } from '../../types/game';
import type {
  KillerEntry,
  KillerTable,
  HistoryTable,
  OrderedCandidate,
  CountermoveTable,
} from '../../types/ai';
import { BOARD_SIZE } from '../gameLogic';
import { AI_CONFIG, AI_SCORES, AI_FEATURES, CANDIDATE_CONFIG } from './constants';
import { evaluatePosition, hasStoneNearby } from './evaluator';

// ============================================================
// Killer table 生成・操作
// ============================================================

/**
 * killer table が対応する最大探索深さ。
 *
 * 第2弾で MINIMAX_DEPTH を 12 に引き上げたため、
 * 余裕を持って 32 まで対応する。
 */
export const MAX_KILLER_DEPTH = 32 as const;

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
// Countermove table 生成・操作
// ============================================================

/**
 * countermove table を生成する。
 *
 * 盤面座標を row * BOARD_SIZE + col で平坦化し、
 * player ごとに 225 要素の配列を持つ。
 */
export const createCountermoveTable = (): CountermoveTable => ({
  Black: new Array<Position | null>(BOARD_SIZE * BOARD_SIZE).fill(null),
  White: new Array<Position | null>(BOARD_SIZE * BOARD_SIZE).fill(null),
});

/** Position を平坦インデックスへ変換する */
const toIndex = (pos: Position): number => pos.row * BOARD_SIZE + pos.col;

/**
 * β / α カットオフを引き起こした手を countermove table に記録する。
 *
 * @param table    countermove table
 * @param player   カットオフを起こした側の手番
 * @param lastMove 直前に相手が打った手
 * @param move     カットオフを起こした手
 */
export const storeCountermove = (
  table: CountermoveTable,
  player: Player,
  lastMove: Position,
  move: Position
): void => {
  table[player][toIndex(lastMove)] = { row: move.row, col: move.col };
};

/**
 * 指定 player が lastMove に対して過去にカットオフを起こした応手を取得する。
 */
export const getCountermove = (
  table: CountermoveTable,
  player: Player,
  lastMove: Position | null
): Position | null => {
  if (!lastMove) return null;
  return table[player][toIndex(lastMove)] ?? null;
};

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
// 候補手生成（戦術的最適化 + 5 tier move ordering）
// ============================================================

/**
 * 候補手を戦術的に分類し、LMR / PVS が機能しやすい形で ordered な候補手配列を返す。
 *
 * Tier 0 (TT MOVE):
 *   Transposition Table に登録された「過去の最善手」。
 *
 * Tier 1 (CRITICAL):
 *   WIN / DEFEND_WIN / OPEN_FOUR / DOUBLE_FOUR / FOUR_THREE / DOUBLE_THREE 相当。
 *   戦術的に最重要であり、絶対に切り捨てない。
 *
 * Tier 2 (COUNTERMOVE):
 *   直前手に対して過去カットオフを起こした応手。
 *
 * Tier 3 (KILLER):
 *   killer table に登録された静かな手。
 *
 * Tier 4 (QUIET):
 *   上記以外。score 降順 + history 補助でソートし、必要に応じてマージン剪定する。
 *
 * ENABLE_TACTICAL_CANDIDATES = false の場合は、
 * 従来に近い TT / CRITICAL / COUNTER / KILLER / REST の結合を
 * AI_CONFIG.MAX_CANDIDATES で切り出す。
 *
 * @param board             現在の盤面
 * @param player            手番プレイヤー
 * @param forbiddenMoves    禁じ手マップ
 * @param killerTable       killer table
 * @param historyTable      history table
 * @param countermoveTable  countermove table
 * @param depth             現在の残り探索深さ
 * @param lastMove          直前手（null 可）
 * @param ttBestMove        TT から取得した最善手（null 可）
 * @param isRoot            ルートノードかどうか
 */
export const generateOrderedCandidates = (
  board: BoardState,
  player: Player,
  forbiddenMoves: boolean[][],
  killerTable: KillerTable,
  historyTable: HistoryTable,
  countermoveTable: CountermoveTable,
  depth: number,
  lastMove: Position | null = null,
  ttBestMove: Position | null = null,
  isRoot: boolean = false
): OrderedCandidate[] => {
  const scored: OrderedCandidate[] = [];

  const ttKey = ttBestMove ? toIndex(ttBestMove) : -1;
  const counterPos = AI_FEATURES.ENABLE_COUNTERMOVE
    ? getCountermove(countermoveTable, player, lastMove)
    : null;
  const counterKey = counterPos ? toIndex(counterPos) : -1;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      const score = evaluatePosition(board, r, c, player);
      const posKey = r * BOARD_SIZE + c;

      const isTTMove = posKey === ttKey;
      const isKillerMove = isKiller(killerTable, depth, r, c);
      const isCountermove = AI_FEATURES.ENABLE_COUNTERMOVE && posKey === counterKey;

      const isCritical = score >= CRITICAL_SCORE_THRESHOLD;
      const isTactical = isCritical || score >= AI_SCORES.CLOSED_FOUR;
      const isQuiet = !isTactical;

      scored.push({
        pos: { row: r, col: c },
        score,
        flags: {
          isTTMove,
          isKiller: isKillerMove,
          isCountermove,
          isCritical,
          isTactical,
          isQuiet,
          reductionAllowed:
            isQuiet &&
            !isTTMove &&
            !isKillerMove &&
            !isCountermove,
        },
      });
    }
  }

  if (scored.length === 0) return [];

  // score 降順（WIN > DEFEND_WIN > ... の自然な tier 順を維持）
  scored.sort((a, b) => b.score - a.score);

  const ttTier: OrderedCandidate[] = [];
  const criticalTier: OrderedCandidate[] = [];
  const counterTier: OrderedCandidate[] = [];
  const killerTier: OrderedCandidate[] = [];
  let quietTier: OrderedCandidate[] = [];

  const used = new Set<number>();

  const addUnique = (tier: OrderedCandidate[], entry: OrderedCandidate): void => {
    const key = toIndex(entry.pos);
    if (used.has(key)) return;
    used.add(key);
    tier.push(entry);
  };

  for (const entry of scored) {
    if (entry.flags.isTTMove) {
      addUnique(ttTier, entry);
    } else if (entry.flags.isCritical) {
      addUnique(criticalTier, entry);
    } else if (entry.flags.isCountermove) {
      addUnique(counterTier, entry);
    } else if (entry.flags.isKiller) {
      addUnique(killerTier, entry);
    } else {
      addUnique(quietTier, entry);
    }
  }

  // Quiet tier は score 降順、同点は history 降順で安定ソートする。
  quietTier.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    const historyA = getHistoryScore(historyTable, player, a.pos.row, a.pos.col);
    const historyB = getHistoryScore(historyTable, player, b.pos.row, b.pos.col);

    return historyB - historyA;
  });

  // 戦術的候補手生成が有効な場合のみ Quiet のマージン剪定を行う。
  let finalQuietTier = quietTier;

  if (
    AI_FEATURES.ENABLE_TACTICAL_CANDIDATES &&
    CANDIDATE_CONFIG.ENABLE_MARGIN_PRUNING &&
    finalQuietTier.length > 1
  ) {
    const bestQuietScore = finalQuietTier[0].score;
    finalQuietTier = finalQuietTier.filter(
      (entry) => entry.score >= bestQuietScore - CANDIDATE_CONFIG.QUIET_SCORE_MARGIN
    );
  }

  // feature flag OFF: 従来の固定上限に近い挙動。
  if (!AI_FEATURES.ENABLE_TACTICAL_CANDIDATES) {
    const ordered = [
      ...ttTier,
      ...criticalTier,
      ...counterTier,
      ...killerTier,
      ...quietTier,
    ];
    return ordered.slice(0, AI_CONFIG.MAX_CANDIDATES);
  }

  const maxCandidates = isRoot
    ? CANDIDATE_CONFIG.ROOT_MAX_CANDIDATES
    : criticalTier.length > 0
      ? CANDIDATE_CONFIG.TACTICAL_MAX_CANDIDATES
      : CANDIDATE_CONFIG.DEFAULT_MAX_CANDIDATES;

  /**
   * CRITICAL が存在する局面:
   * - TT Move と CRITICAL は絶対に残す。
   * - その上で、余裕があれば Countermove / Killer / Quiet を追加する。
   */
  if (criticalTier.length > 0) {
    const essential = [...ttTier, ...criticalTier];
    const extras = [...counterTier, ...killerTier, ...finalQuietTier];

    if (essential.length >= maxCandidates) {
      return essential;
    }

    return [...essential, ...extras.slice(0, maxCandidates - essential.length)];
  }

  /**
   * 静かな局面:
   * - TT / Countermove / Killer は優先的に残す。
   * - 残りを Quiet の上位で埋める。
   */
  const essential = [...ttTier, ...counterTier, ...killerTier];

  if (essential.length >= maxCandidates) {
    return essential.slice(0, maxCandidates);
  }

  return [...essential, ...finalQuietTier.slice(0, maxCandidates - essential.length)];
};