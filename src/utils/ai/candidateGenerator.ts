// src/utils/ai/candidateGenerator.ts
// 候補手生成・move ordering・各種 heuristic・CandidateSet 増分管理・forced move 後処理を担うモジュール。
//
// 責務:
//   - Killer / History / Countermove heuristic の管理
//   - CandidateSet の増分更新
//   - 候補手生成と tier 分類
//   - forced move list の後処理
//
// 注意:
//   - 評価値・tier 優先順位・LMR / PVS 判定の意味は変更しない。
//   - 型定義は types/ai.ts を参照する。

import type { BoardState, Position, Player } from '@/types/game';
import type {
  KillerEntry,
  KillerTable,
  HistoryTable,
  OrderedCandidate,
  CountermoveTable,
  LineCacheState,
  CandidateSetState,
  CandidateSetUndo,
  SearchStats,
  ForcedMove,
} from '@/types/ai';
import { BOARD_SIZE } from '@/utils/gameLogic';
import {
  AI_CONFIG,
  AI_SCORES,
  AI_FEATURES,
  CANDIDATE_CONFIG,
  SEARCH_TUNING_FEATURES,
  THREAT_FORBIDDEN_FEATURES,
  THREAT_FORBIDDEN_CONFIG,
} from './constants';
import {
  evaluatePosition,
  hasStoneNearby,
  evaluatePositionWithCache,
} from './evaluator';
import {
  recordCandidateSetSize,
  isGameSessionActive,
  recordCandidateGenTime,
} from './searchStats';
import {
  generateForcedMoveList,
  isEssentialForcedCategory,
  getForcedPriorityRank,
} from './forcedMoveGenerator';
import type { DynamicForbiddenController } from './dynamicForbidden';

// ============================================================
// キラームーブテーブル
// ============================================================

/**
 * killer table が対応する最大探索深さ。
 * 余裕を持って 32 まで対応する。
 */
export const MAX_KILLER_DEPTH = 32 as const;

export const createKillerTable = (): KillerTable =>
  Array.from({ length: MAX_KILLER_DEPTH }, (): KillerEntry => [null, null]);

// ============================================================
// 履歴テーブル
// ============================================================

export const createHistoryTable = (): HistoryTable => ({
  Black: Array.from({ length: BOARD_SIZE }, () => new Array<number>(BOARD_SIZE).fill(0)),
  White: Array.from({ length: BOARD_SIZE }, () => new Array<number>(BOARD_SIZE).fill(0)),
});

// ============================================================
// 応手テーブル
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
// 重要度の閾値
// ============================================================

/**
 * CRITICAL tier と REST tier を区切るスコア閾値。
 * DOUBLE_THREE 以上（DOUBLE_THREE / FOUR_THREE / DOUBLE_FOUR / OPEN_FOUR / DEFEND_WIN / WIN）
 * は常に先頭に来るため killer 管理は不要とみなす。
 */
export const CRITICAL_SCORE_THRESHOLD = AI_SCORES.DOUBLE_THREE;

// ============================================================
// キラームーブの管理
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
// 履歴ヒューリスティックの管理
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
// 候補集合の増分状態
// ============================================================

const toFlat = (row: number, col: number): number => row * BOARD_SIZE + col;

/**
 * 候補集合を初期盤面から構築する。
 *
 * 各空マスについて SEARCH_RANGE 内の石数を数え、
 * 1 以上あれば候補とする。
 */
export const createCandidateSet = (
  board: BoardState,
  forbiddenMoves: boolean[][]
): CandidateSetState => {
  const refCount: number[][] = Array.from({ length: BOARD_SIZE }, () =>
    new Array<number>(BOARD_SIZE).fill(0)
  );
  const isCandidate: boolean[][] = Array.from({ length: BOARD_SIZE }, () =>
    new Array<boolean>(BOARD_SIZE).fill(false)
  );
  const candidates = new Set<number>();
  const range = AI_CONFIG.SEARCH_RANGE;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;

      let count = 0;
      for (let dr = -range; dr <= range; dr++) {
        for (let dc = -range; dc <= range; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) {
            continue;
          }
          if (board[nr][nc] !== null) {
            count++;
          }
        }
      }

      refCount[r][c] = count;
      if (count > 0) {
        isCandidate[r][c] = true;
        candidates.add(toFlat(r, c));
      }
    }
  }

  return { candidates, isCandidate, refCount };
};

/**
 * 着手に伴い候補集合を増分更新する。
 *
 * board[row][col] に石が置かれた直後に呼ぶことを想定する。
 * 影響範囲は着手位置の SEARCH_RANGE 近傍のみ。
 */
export const applyCandidateSet = (
  state: CandidateSetState,
  board: BoardState,
  forbiddenMoves: boolean[][],
  row: number,
  col: number
): CandidateSetUndo => {
  const affected: CandidateSetUndo['affected'] = [];
  const seen = new Set<number>();
  const range = AI_CONFIG.SEARCH_RANGE;

  const record = (r: number, c: number): void => {
    const idx = toFlat(r, c);
    if (seen.has(idx)) return;
    seen.add(idx);
    affected.push({
      index: idx,
      oldRefCount: state.refCount[r][c],
      oldIsCandidate: state.isCandidate[r][c],
    });
  };

  // 影響範囲の旧状態をすべて記録する
  for (let dr = -range; dr <= range; dr++) {
    for (let dc = -range; dc <= range; dc++) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) {
        continue;
      }
      record(nr, nc);
    }
  }

  // 着手位置は候補から外す
  if (state.isCandidate[row][col]) {
    state.isCandidate[row][col] = false;
    state.candidates.delete(toFlat(row, col));
  }

  // 近傍の空マスの refCount を増やす
  for (let dr = -range; dr <= range; dr++) {
    for (let dc = -range; dc <= range; dc++) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) {
        continue;
      }
      if (nr === row && nc === col) continue;
      if (board[nr][nc] !== null) continue;
      if (forbiddenMoves[nr][nc]) continue;

      state.refCount[nr][nc]++;
      if (state.refCount[nr][nc] === 1) {
        state.isCandidate[nr][nc] = true;
        state.candidates.add(toFlat(nr, nc));
      }
    }
  }

  return { affected };
};

/**
 * applyCandidateSet の前に状態を復元する。
 */
export const undoCandidateSet = (
  state: CandidateSetState,
  undo: CandidateSetUndo
): void => {
  for (const change of undo.affected) {
    const r = Math.floor(change.index / BOARD_SIZE);
    const c = change.index % BOARD_SIZE;
    const currentIsCandidate = state.isCandidate[r][c];

    state.refCount[r][c] = change.oldRefCount;

    if (change.oldIsCandidate) {
      if (!currentIsCandidate) {
        state.isCandidate[r][c] = true;
        state.candidates.add(change.index);
      }
    } else {
      if (currentIsCandidate) {
        state.isCandidate[r][c] = false;
        state.candidates.delete(change.index);
      }
    }
  }
};

// ============================================================
// 候補手統計の補助関数
// ============================================================

/**
 * 実際に探索へ渡す候補手配列の長さを統計へ記録する。
 * 戻り値はそのまま返すだけで、候補手の中身は変更しない。
 */
const recordReturnedCandidates = (
  stats: SearchStats | undefined,
  candidates: OrderedCandidate[]
): OrderedCandidate[] => {
  if (stats) {
    stats.candidates.selectedTotal += candidates.length;
    if (candidates.length > stats.candidates.maxPerNode) {
      stats.candidates.maxPerNode = candidates.length;
    }
  }
  return candidates;
};

// ============================================================
// 候補手生成の本体
// ============================================================

const generateOrderedCandidatesInternal = (
  board: BoardState,
  player: Player,
  forbiddenMoves: boolean[][],
  killerTable: KillerTable,
  historyTable: HistoryTable,
  countermoveTable: CountermoveTable,
  depth: number,
  lastMove: Position | null = null,
  ttBestMove: Position | null = null,
  isRoot: boolean = false,
  lineCache: LineCacheState | null = null,
  candidateSet: CandidateSetState | null = null,
  stats?: SearchStats,
  currentHash: bigint = 0n,
  dynamicForbidden: DynamicForbiddenController | null = null
): OrderedCandidate[] => {
  if (stats) {
    stats.candidates.genCalls++;
  }

  const ttKey = ttBestMove ? toIndex(ttBestMove) : -1;
  const counterPos = AI_FEATURES.ENABLE_COUNTERMOVE
    ? getCountermove(countermoveTable, player, lastMove)
    : null;
  const counterKey = counterPos ? toIndex(counterPos) : -1;

  const useLineCache = AI_FEATURES.ENABLE_LINE_CACHE && lineCache !== null;
  const useCandidateSet =
    AI_FEATURES.ENABLE_INCREMENTAL_CANDIDATES && candidateSet !== null;

  if (stats && useCandidateSet && candidateSet) {
    stats.candidateSet.used = true;
    recordCandidateSetSize(stats, candidateSet.candidates.size);
  }

  // このノードで動的禁手フィルタを使うか判定する。
  const applyDynamicForbidden = dynamicForbidden
    ? dynamicForbidden.shouldFilterNode(player, isRoot, depth, stats)
    : false;

  const isDynamicForbiddenMove = (r: number, c: number): boolean => {
    if (!applyDynamicForbidden || !dynamicForbidden) return false;
    const pos: Position = { row: r, col: c };
    const forbidden = dynamicForbidden.check(
      board,
      pos,
      player,
      currentHash,
      stats
    );
    // 静的 forbiddenMoves では合法だったが、動的禁手で除外された場合。
    if (forbidden && stats) {
      stats.forbidden.mismatchWithStaticForbidden++;
    }
    return forbidden;
  };

  // ------------------------------------------------------------
  // bucket 方式候補手生成
  // ------------------------------------------------------------
  if (SEARCH_TUNING_FEATURES.ENABLE_TIER_BUCKET_GENERATION) {
    type InternalCandidate = OrderedCandidate & { order: number };

    const ttTier: InternalCandidate[] = [];
    const criticalTier: InternalCandidate[] = [];
    const counterTier: InternalCandidate[] = [];
    const killerTier: InternalCandidate[] = [];
    const quietTier: InternalCandidate[] = [];
    let order = 0;

    const addBucketCandidate = (r: number, c: number): void => {
      const score = useLineCache
        ? evaluatePositionWithCache(lineCache as LineCacheState, r, c, player)
        : evaluatePosition(board, r, c, player);

      const posKey = toIndex({ row: r, col: c });
      const isTTMove = posKey === ttKey;
      const isKillerMove = isKiller(killerTable, depth, r, c);
      const isCountermove =
        AI_FEATURES.ENABLE_COUNTERMOVE && posKey === counterKey;
      const isCritical = score >= CRITICAL_SCORE_THRESHOLD;
      const isTactical = isCritical || score >= AI_SCORES.CLOSED_FOUR;
      const isQuiet = !isTactical;

      const entry: InternalCandidate = {
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
        order,
      };
      order++;

      if (entry.flags.isTTMove) {
        ttTier.push(entry);
      } else if (entry.flags.isCritical) {
        criticalTier.push(entry);
      } else if (entry.flags.isCountermove) {
        counterTier.push(entry);
      } else if (entry.flags.isKiller) {
        killerTier.push(entry);
      } else {
        quietTier.push(entry);
      }
    };

    if (useCandidateSet && candidateSet) {
      for (const idx of candidateSet.candidates) {
        const r = Math.floor(idx / BOARD_SIZE);
        const c = idx % BOARD_SIZE;
        if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
        // refCount 事前フィルタ。
        // root では全候補を評価するため適用しない。
        if (
          CANDIDATE_CONFIG.ENABLE_REFCOUNT_PREFILTER &&
          !isRoot &&
          candidateSet.refCount[r][c] <
            CANDIDATE_CONFIG.REFCOUNT_PREFILTER_MIN
        ) {
          continue;
        }
        if (isDynamicForbiddenMove(r, c)) continue;
        addBucketCandidate(r, c);
      }
    } else {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
          if (!hasStoneNearby(board, r, c)) continue;
          if (isDynamicForbiddenMove(r, c)) continue;
          addBucketCandidate(r, c);
        }
      }
    }

    const totalCount =
      ttTier.length +
      criticalTier.length +
      counterTier.length +
      killerTier.length +
      quietTier.length;

    if (totalCount === 0) {
      return recordReturnedCandidates(stats, []);
    }

    const sortByScore = (tier: InternalCandidate[]): void => {
      tier.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.order - b.order;
      });
    };

    sortByScore(ttTier);
    sortByScore(criticalTier);
    sortByScore(counterTier);
    sortByScore(killerTier);

    // Quiet tier は score 降順、同点は history 降順、さらに生成順で安定化。
    quietTier.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const historyA = getHistoryScore(historyTable, player, a.pos.row, a.pos.col);
      const historyB = getHistoryScore(historyTable, player, b.pos.row, b.pos.col);
      if (historyB !== historyA) return historyB - historyA;
      return a.order - b.order;
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

    // tier 集計（生成された候補の構成を記録する）
    if (stats) {
      stats.candidates.criticalTotal += criticalTier.length;
      stats.candidates.quietTotal += finalQuietTier.length;
      stats.candidates.quietPrunedTotal += quietTier.length - finalQuietTier.length;
      stats.tt.bestMoveUsed += ttTier.length;
      stats.ordering.ttBestMoveUsed += ttTier.length;
      stats.ordering.killerHits += killerTier.length;
      stats.ordering.countermoveHits += counterTier.length;
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
      return recordReturnedCandidates(stats, ordered.slice(0, AI_CONFIG.MAX_CANDIDATES));
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
        return recordReturnedCandidates(stats, essential);
      }
      return recordReturnedCandidates(
        stats,
        [...essential, ...extras.slice(0, maxCandidates - essential.length)]
      );
    }

    /**
     * 静かな局面:
     * - TT / Countermove / Killer は優先的に残す。
     * - 残りを Quiet の上位で埋める。
     */
    const essential = [...ttTier, ...counterTier, ...killerTier];
    if (essential.length >= maxCandidates) {
      return recordReturnedCandidates(stats, essential.slice(0, maxCandidates));
    }
    return recordReturnedCandidates(
      stats,
      [...essential, ...finalQuietTier.slice(0, maxCandidates - essential.length)]
    );
  }

  // ------------------------------------------------------------
  // 従来方式候補手生成
  // ------------------------------------------------------------
  const scored: OrderedCandidate[] = [];

  const addCandidate = (r: number, c: number): void => {
    const score = useLineCache
      ? evaluatePositionWithCache(lineCache as LineCacheState, r, c, player)
      : evaluatePosition(board, r, c, player);

    const posKey = toIndex({ row: r, col: c });
    const isTTMove = posKey === ttKey;
    const isKillerMove = isKiller(killerTable, depth, r, c);
    const isCountermove =
      AI_FEATURES.ENABLE_COUNTERMOVE && posKey === counterKey;
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
  };

  if (useCandidateSet && candidateSet) {
    for (const idx of candidateSet.candidates) {
      const r = Math.floor(idx / BOARD_SIZE);
      const c = idx % BOARD_SIZE;
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      // refCount 事前フィルタ。
      // root では全候補を評価するため適用しない。
      if (
        CANDIDATE_CONFIG.ENABLE_REFCOUNT_PREFILTER &&
        !isRoot &&
        candidateSet.refCount[r][c] <
          CANDIDATE_CONFIG.REFCOUNT_PREFILTER_MIN
      ) {
        continue;
      }
      if (isDynamicForbiddenMove(r, c)) continue;
      addCandidate(r, c);
    }
  } else {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
        if (!hasStoneNearby(board, r, c)) continue;
        if (isDynamicForbiddenMove(r, c)) continue;
        addCandidate(r, c);
      }
    }
  }

  if (scored.length === 0) {
    return recordReturnedCandidates(stats, []);
  }

  // score 降順（WIN > DEFEND_WIN > ... の自然な tier 順を維持）
  scored.sort((a, b) => b.score - a.score);

  const ttTier: OrderedCandidate[] = [];
  const criticalTier: OrderedCandidate[] = [];
  const counterTier: OrderedCandidate[] = [];
  const killerTier: OrderedCandidate[] = [];
  const quietTier: OrderedCandidate[] = [];
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

  // tier 集計（生成された候補の構成を記録する）
  if (stats) {
    stats.candidates.criticalTotal += criticalTier.length;
    stats.candidates.quietTotal += finalQuietTier.length;
    stats.candidates.quietPrunedTotal += quietTier.length - finalQuietTier.length;
    stats.tt.bestMoveUsed += ttTier.length;
    stats.ordering.ttBestMoveUsed += ttTier.length;
    stats.ordering.killerHits += killerTier.length;
    stats.ordering.countermoveHits += counterTier.length;
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
    return recordReturnedCandidates(stats, ordered.slice(0, AI_CONFIG.MAX_CANDIDATES));
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
      return recordReturnedCandidates(stats, essential);
    }
    return recordReturnedCandidates(
      stats,
      [...essential, ...extras.slice(0, maxCandidates - essential.length)]
    );
  }

  /**
   * 静かな局面:
   * - TT / Countermove / Killer は優先的に残す。
   * - 残りを Quiet の上位で埋める。
   */
  const essential = [...ttTier, ...counterTier, ...killerTier];
  if (essential.length >= maxCandidates) {
    return recordReturnedCandidates(stats, essential.slice(0, maxCandidates));
  }
  return recordReturnedCandidates(
    stats,
    [...essential, ...finalQuietTier.slice(0, maxCandidates - essential.length)]
  );
};

// ============================================================
// forced move の後処理
// ============================================================

/**
 * 候補手配列へ forced move 情報を付与する。
 *
 * - 既存候補が forced move に含まれていれば isForced 等を付与する。
 * - root では必須 forced move が欠落している場合、末尾へ追加する。
 * - ENABLE_FORCED_ORDERING が有効な場合のみ、forced 手を前に並べ替える。
 *
 * 既定では既存 tier の順序・LMR / PVS 判定を変更しない。
 */
const applyForcedMovePostProcessing = (
  board: BoardState,
  player: Player,
  forbiddenMoves: boolean[][],
  lineCache: LineCacheState | null,
  candidateSet: CandidateSetState | null,
  currentHash: bigint,
  isRoot: boolean,
  depth: number,
  forbiddenRuleEnabled: boolean,
  candidates: OrderedCandidate[],
  stats?: SearchStats
): OrderedCandidate[] => {
  if (
    !THREAT_FORBIDDEN_FEATURES.ENABLE_THREAT_MODEL ||
    !THREAT_FORBIDDEN_FEATURES.ENABLE_FORCED_MOVE_LIST
  ) {
    return candidates;
  }
  if (!isRoot && !THREAT_FORBIDDEN_FEATURES.ENABLE_INTERNAL_FORCED_LIST) {
    return candidates;
  }
  if (!isRoot && depth > THREAT_FORBIDDEN_CONFIG.INTERNAL_FORCED_MAX_DEPTH) {
    return candidates;
  }

  const forcedList = generateForcedMoveList(
    {
      board,
      mover: player,
      forbiddenMoves,
      lineCache,
      candidateSet,
      currentHash,
      isRoot,
      depth,
      forbiddenRuleEnabled,
    },
    stats
  );

  if (forcedList.moves.length === 0) {
    return candidates;
  }

  const forcedByKey = new Map<number, ForcedMove>();
  for (const forcedMove of forcedList.moves) {
    forcedByKey.set(toIndex(forcedMove.pos), forcedMove);
  }

  const present = new Set<number>();

  // 既存候補へ forced flag を付与する。
  for (const candidate of candidates) {
    const key = toIndex(candidate.pos);
    present.add(key);
    const forcedMove = forcedByKey.get(key);
    if (forcedMove) {
      candidate.flags.isForced = true;
      candidate.flags.forcedPriority = forcedMove.priority;
      candidate.flags.forcedCategories = forcedMove.categories;
    }
  }

  // root では必須 forced move の欠落を保護する。
  if (isRoot) {
    const essentialForcedMoves = forcedList.moves.filter(
      (forcedMove) =>
        forcedMove.legal &&
        forcedMove.categories.some(isEssentialForcedCategory)
    );
    const missingForcedMoves = essentialForcedMoves.filter(
      (forcedMove) => !present.has(toIndex(forcedMove.pos))
    );

    if (stats) {
      stats.threat.rootForcedMissing += missingForcedMoves.length;
    }

    if (THREAT_FORBIDDEN_FEATURES.ENABLE_ROOT_FORCED_PROTECTION) {
      const useLineCache = AI_FEATURES.ENABLE_LINE_CACHE && lineCache !== null;
      let appended = 0;

      for (const forcedMove of missingForcedMoves) {
        if (appended >= THREAT_FORBIDDEN_CONFIG.ROOT_FORCED_EXTRA_CAPACITY) {
          if (stats) {
            stats.threat.rootForcedDropped += 1;
          }
          continue;
        }

        const { row, col } = forcedMove.pos;

        // 二重防御: board / UI forbidden と矛盾する場合は追加しない。
        if (board[row][col] !== null || forbiddenMoves[row][col]) {
          continue;
        }

        const score = useLineCache
          ? evaluatePositionWithCache(lineCache as LineCacheState, row, col, player)
          : evaluatePosition(board, row, col, player);

        const isCritical = score >= CRITICAL_SCORE_THRESHOLD;
        const isTactical = isCritical || score >= AI_SCORES.CLOSED_FOUR;
        const isQuiet = !isTactical;

        candidates.push({
          pos: { row, col },
          score,
          flags: {
            isTTMove: false,
            isKiller: false,
            isCountermove: false,
            isCritical,
            isTactical,
            isQuiet,
            reductionAllowed: isQuiet,
            isForced: true,
            forcedPriority: forcedMove.priority,
            forcedCategories: forcedMove.categories,
          },
        });
        present.add(toIndex(forcedMove.pos));
        appended++;
      }

      if (stats && appended > 0) {
        stats.threat.rootForcedIncluded += appended;
        // recordReturnedCandidates は internal 側で呼ばれているため、
        // 追加分だけ候補手統計へ加算する。
        stats.candidates.selectedTotal += appended;
        if (candidates.length > stats.candidates.maxPerNode) {
          stats.candidates.maxPerNode = candidates.length;
        }
      }
    }
  }

  // 実験的: forced move を優先する並び順。
  // 既定 OFF。有効化した場合のみ既存順序を変更する。
  if (THREAT_FORBIDDEN_FEATURES.ENABLE_FORCED_ORDERING) {
    const ttTier: OrderedCandidate[] = [];
    const criticalTier: OrderedCandidate[] = [];
    const forcedTier: OrderedCandidate[] = [];
    const restTier: OrderedCandidate[] = [];

    for (const candidate of candidates) {
      if (candidate.flags.isTTMove) {
        ttTier.push(candidate);
      } else if (candidate.flags.isCritical) {
        criticalTier.push(candidate);
      } else if (
        candidate.flags.isForced &&
        candidate.flags.forcedPriority &&
        isEssentialForcedCategory(candidate.flags.forcedPriority)
      ) {
        forcedTier.push(candidate);
      } else {
        restTier.push(candidate);
      }
    }

    forcedTier.sort((a, b) => {
      const rankA = getForcedPriorityRank(a.flags.forcedPriority ?? 'NONE');
      const rankB = getForcedPriorityRank(b.flags.forcedPriority ?? 'NONE');
      if (rankA !== rankB) return rankA - rankB;
      if (b.score !== a.score) return b.score - a.score;
      return 0;
    });

    candidates.length = 0;
    candidates.push(...ttTier, ...criticalTier, ...forcedTier, ...restTier);
  }

  return candidates;
};

// ============================================================
// 公開 API
// ============================================================

/**
 * 候補手生成の公開 API。
 *
 * 本体は generateOrderedCandidatesInternal に委譲し、
 * 必要時のみ生成時間を計測する。
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
  isRoot: boolean = false,
  lineCache: LineCacheState | null = null,
  candidateSet: CandidateSetState | null = null,
  stats?: SearchStats,
  currentHash: bigint = 0n,
  dynamicForbidden: DynamicForbiddenController | null = null
): OrderedCandidate[] => {
  const forbiddenRuleEnabledForForcedMoves = dynamicForbidden
    ? dynamicForbidden.ruleEnabled
    : true;

  const finalizeCandidatesWithForcedMoves = (
    result: OrderedCandidate[]
  ): OrderedCandidate[] =>
    applyForcedMovePostProcessing(
      board,
      player,
      forbiddenMoves,
      lineCache,
      candidateSet,
      currentHash,
      isRoot,
      depth,
      forbiddenRuleEnabledForForcedMoves,
      result,
      stats
    );

  const shouldTime = isGameSessionActive() || stats !== undefined;

  if (!shouldTime) {
    const result = generateOrderedCandidatesInternal(
      board,
      player,
      forbiddenMoves,
      killerTable,
      historyTable,
      countermoveTable,
      depth,
      lastMove,
      ttBestMove,
      isRoot,
      lineCache,
      candidateSet,
      stats,
      currentHash,
      dynamicForbidden
    );
    return finalizeCandidatesWithForcedMoves(result);
  }

  const start = performance.now();
  let result: OrderedCandidate[] | undefined;

  try {
    result = generateOrderedCandidatesInternal(
      board,
      player,
      forbiddenMoves,
      killerTable,
      historyTable,
      countermoveTable,
      depth,
      lastMove,
      ttBestMove,
      isRoot,
      lineCache,
      candidateSet,
      stats,
      currentHash,
      dynamicForbidden
    );
    result = finalizeCandidatesWithForcedMoves(result);
    return result;
  } finally {
    const elapsed = performance.now() - start;
    if (stats) {
      stats.candidates.genTimeMs += elapsed;
    }
    if (isGameSessionActive()) {
      recordCandidateGenTime(elapsed);
    }
  }
};