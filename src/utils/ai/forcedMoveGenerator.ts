// src/utils/ai/forcedMoveGenerator.ts
// 第6.1弾：forced move list 生成
//
// 責務:
//   - Threat Model に基づく forced move list の生成
//   - OWN_WIN / BLOCK_WIN / OWN_OPEN_FOUR / BLOCK_OPEN_FOUR / OWN_FOUR / BLOCK_FOUR の分類
//   - OPEN_THREE_DEFENSE は feature flag 付き
//   - root / internal の生成制御
//
// 既存評価値・候補手 tier・LMR / PVS の意味は変更しない。
//
// v2.0.0 禁手整合性修正:
//   - forbiddenRuleEnabled を受け取り、threatModel の禁手判定へ伝搬する。
//   - 禁手 OFF の場合、Black 禁手判定を一切行わない。
import type { BoardState, Player, Position } from '../../types/game';
import type {
  CandidateSetState,
  ForcedCategory,
  ForcedMove,
  ForcedMoveList,
  LineCacheState,
  SearchStats,
} from '../../types/ai';
import { BOARD_SIZE } from '../gameLogic';
import { THREAT_FORBIDDEN_CONFIG, THREAT_FORBIDDEN_FEATURES } from './constants';
import { hasStoneNearby, opponentOf } from './evaluator';
import {
  wouldWin,
  isHypotheticalLegal,
  isUiLegalMove,
  isMoverLegal,
  getHypotheticalPatternCounts,
} from './threatModel';

export interface ForcedMoveGenerationRequest {
  board: BoardState;
  mover: Player;
  forbiddenMoves: boolean[][];
  lineCache: LineCacheState | null;
  candidateSet: CandidateSetState | null;
  currentHash: bigint;
  isRoot: boolean;
  depth: number;
  /** 禁手ルールが有効かどうか。false の場合、Black 禁手判定を一切行わない。 */
  forbiddenRuleEnabled: boolean;
}

const FORCED_CATEGORIES: ForcedCategory[] = [
  'OWN_WIN',
  'BLOCK_WIN',
  'OWN_OPEN_FOUR',
  'BLOCK_OPEN_FOUR',
  'OWN_FOUR',
  'BLOCK_FOUR',
  'OPEN_THREE_DEFENSE',
  'NONE',
];

/**
 * forced move の優先度順序。
 * インデックスが小さいほど高優先。
 */
const PRIORITY_ORDER: ForcedCategory[] = [
  'OWN_WIN',
  'BLOCK_WIN',
  'OWN_OPEN_FOUR',
  'BLOCK_OPEN_FOUR',
  'OWN_FOUR',
  'BLOCK_FOUR',
  'OPEN_THREE_DEFENSE',
  'NONE',
];

export const getForcedPriorityRank = (category: ForcedCategory): number => {
  const index = PRIORITY_ORDER.indexOf(category);
  return index === -1 ? PRIORITY_ORDER.length : index;
};

/**
 * root forced protection で必須扱いするカテゴリ。
 *
 * 第6.1弾では候補手増加を抑えるため、
 * OWN_WIN / BLOCK_WIN / OWN_OPEN_FOUR / BLOCK_OPEN_FOUR のみ必須とする。
 */
export const isEssentialForcedCategory = (category: ForcedCategory): boolean =>
  category === 'OWN_WIN' ||
  category === 'BLOCK_WIN' ||
  category === 'OWN_OPEN_FOUR' ||
  category === 'BLOCK_OPEN_FOUR';

const createByCategory = (): Record<ForcedCategory, Position[]> => {
  const result = {} as Record<ForcedCategory, Position[]>;
  for (const category of FORCED_CATEGORIES) {
    result[category] = [];
  }
  return result;
};

const createEmptyForcedMoveList = (hash: bigint): ForcedMoveList => ({
  moves: [],
  byCategory: createByCategory(),
  hasOwnWin: false,
  hasBlockWin: false,
  hasOwnOpenFour: false,
  hasBlockOpenFour: false,
  hasOwnFour: false,
  hasBlockFour: false,
  maxPriority: null,
  nodeKind: 'quiet',
  generatedAtHash: hash,
});

const higherPriority = (
  a: ForcedCategory,
  b: ForcedCategory
): ForcedCategory =>
  getForcedPriorityRank(a) <= getForcedPriorityRank(b) ? a : b;

const toKey = (pos: Position): number => pos.row * BOARD_SIZE + pos.col;

/**
 * forced move list を生成する。
 *
 * - root では常に生成を試みる。
 * - internal では ENABLE_INTERNAL_FORCED_LIST が有効で、
 *   depth <= INTERNAL_FORCED_MAX_DEPTH の場合のみ生成する。
 * - 生成結果は探索スコアを直接変更しない。
 */
export const generateForcedMoveList = (
  req: ForcedMoveGenerationRequest,
  stats?: SearchStats
): ForcedMoveList => {
  const empty = createEmptyForcedMoveList(req.currentHash);

  if (
    !THREAT_FORBIDDEN_FEATURES.ENABLE_THREAT_MODEL ||
    !THREAT_FORBIDDEN_FEATURES.ENABLE_FORCED_MOVE_LIST
  ) {
    return empty;
  }

  if (!req.isRoot && !THREAT_FORBIDDEN_FEATURES.ENABLE_INTERNAL_FORCED_LIST) {
    return empty;
  }

  if (
    !req.isRoot &&
    req.depth > THREAT_FORBIDDEN_CONFIG.INTERNAL_FORCED_MAX_DEPTH
  ) {
    return empty;
  }

  const start = performance.now();
  if (stats) {
    stats.threat.modelCalls++;
    if (!req.isRoot) {
      stats.threat.internalForcedCalls++;
    }
  }

  const {
    board,
    mover,
    forbiddenMoves,
    lineCache,
    forbiddenRuleEnabled,
  } = req;
  const opponent = opponentOf(mover);

  const moveMap = new Map<number, ForcedMove>();

  const addCategory = (pos: Position, category: ForcedCategory): void => {
    const key = toKey(pos);
    const existing = moveMap.get(key);
    if (!existing) {
      moveMap.set(key, {
        pos: { row: pos.row, col: pos.col },
        categories: [category],
        priority: category,
        legal: true,
        forbiddenChecked: true,
      });
      return;
    }

    if (!existing.categories.includes(category)) {
      existing.categories.push(category);
    }
    existing.priority = higherPriority(existing.priority, category);
  };

  /**
   * WIN / BLOCK_WIN を中心に判定する。
   * root では candidateSet 外の即勝ち/即受けも拾うため、全空マス走査でも使う。
   */
  const processWin = (row: number, col: number): void => {
    const pos: Position = { row, col };
    if (!isUiLegalMove(board, pos, forbiddenMoves)) return;

    if (wouldWin(board, pos, mover)) {
      addCategory(pos, 'OWN_WIN');
    }

    if (wouldWin(board, pos, opponent)) {
      // 自分がその受け場所に着手できない場合、forced move としては除外する。
      // ただし mover が Black で、かつ自分の勝ちにもなっている場合は
      // checkForbiddenMove 内で勝利優先されるため BLOCK_WIN も追加され得る。
      if (isMoverLegal(board, pos, mover, forbiddenMoves, forbiddenRuleEnabled)) {
        addCategory(pos, 'BLOCK_WIN');
      }
    }
  };

  /**
   * 四・活四・必要なら活三受けを判定する。
   * 高コストな禁手判定は、実際に脅威が検出された場合だけ行う。
   */
  const processPatterns = (row: number, col: number): void => {
    const pos: Position = { row, col };
    if (!isUiLegalMove(board, pos, forbiddenMoves)) return;

    // --- 自分の四 / 活四 ---
    const ownCounts = getHypotheticalPatternCounts(
      board,
      lineCache,
      row,
      col,
      mover
    );

    if (ownCounts.OPEN_FOUR > 0 || ownCounts.CLOSED_FOUR > 0) {
      if (isMoverLegal(board, pos, mover, forbiddenMoves, forbiddenRuleEnabled)) {
        if (ownCounts.OPEN_FOUR > 0) {
          addCategory(pos, 'OWN_OPEN_FOUR');
        }
        if (ownCounts.CLOSED_FOUR > 0) {
          addCategory(pos, 'OWN_FOUR');
        }
      }
    }

    // --- 相手の四 / 活四 / 必要なら活三受け ---
    const oppCounts = getHypotheticalPatternCounts(
      board,
      lineCache,
      row,
      col,
      opponent
    );

    const oppHasFourThreat =
      oppCounts.OPEN_FOUR > 0 || oppCounts.CLOSED_FOUR > 0;
    const oppHasOpenThreeThreat =
      THREAT_FORBIDDEN_FEATURES.ENABLE_OPEN_THREE_DEFENSE &&
      oppCounts.OPEN_THREE > 0;

    if (!oppHasFourThreat && !oppHasOpenThreeThreat) return;

    // 相手が Black の場合、禁手ルールが有効ならその仮着手が禁手なら実際の脅威ではない。
    // 禁手ルール OFF の場合は禁手判定を行わず合法として扱う。
    if (!isHypotheticalLegal(board, pos, opponent, forbiddenRuleEnabled)) return;

    // 自分がその場所へ着手できなければ受けとして成立しない。
    if (!isMoverLegal(board, pos, mover, forbiddenMoves, forbiddenRuleEnabled)) return;

    if (oppCounts.OPEN_FOUR > 0) {
      addCategory(pos, 'BLOCK_OPEN_FOUR');
    }
    if (oppCounts.CLOSED_FOUR > 0) {
      addCategory(pos, 'BLOCK_FOUR');
    }
    if (oppHasOpenThreeThreat) {
      addCategory(pos, 'OPEN_THREE_DEFENSE');
    }
  };

  const patternKeys = new Set<number>();

  const processPatternCandidate = (row: number, col: number): void => {
    const key = row * BOARD_SIZE + col;
    if (patternKeys.has(key)) return;
    patternKeys.add(key);

    processWin(row, col);
    processPatterns(row, col);
  };

  // ------------------------------------------------------------
  // 候補走査
  // ------------------------------------------------------------
  //
  // root:
  //   CandidateSet / 近傍候補について四・活四系を判定し、
  //   その後に全空マスへ WIN / BLOCK_WIN だけを追加走査する。
  //
  // internal:
  //   ENABLE_INTERNAL_FORCED_LIST 有効時のみ。
  //   CandidateSet があればその中から上限件数だけ走査する。
  //   CandidateSet がなければ近傍候補を走査する。
  // ------------------------------------------------------------
  const internalLimit = THREAT_FORBIDDEN_CONFIG.INTERNAL_FORCED_MAX_CANDIDATES;
  let scanned = 0;

  if (req.candidateSet) {
    for (const idx of req.candidateSet.candidates) {
      if (!req.isRoot && scanned >= internalLimit) break;

      const r = Math.floor(idx / BOARD_SIZE);
      const c = idx % BOARD_SIZE;
      if (board[r][c] !== null) continue;

      processPatternCandidate(r, c);
      scanned++;
    }
  } else {
    outer: for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (!req.isRoot && scanned >= internalLimit) break outer;
        if (board[r][c] !== null) continue;
        if (!hasStoneNearby(board, r, c)) continue;

        processPatternCandidate(r, c);
        scanned++;
      }
    }
  }

  if (req.isRoot) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== null) continue;

        const key = r * BOARD_SIZE + c;
        if (patternKeys.has(key)) continue;

        // candidateSet 外でも即勝ち/即受けだけ拾う。
        processWin(r, c);
      }
    }
  }

  // ------------------------------------------------------------
  // 結果構築
  // ------------------------------------------------------------
  const moves = Array.from(moveMap.values());
  moves.sort((a, b) => {
    const rankA = getForcedPriorityRank(a.priority);
    const rankB = getForcedPriorityRank(b.priority);
    if (rankA !== rankB) return rankA - rankB;
    if (a.pos.row !== b.pos.row) return a.pos.row - b.pos.row;
    return a.pos.col - b.pos.col;
  });

  const byCategory = createByCategory();
  for (const move of moves) {
    for (const category of move.categories) {
      byCategory[category].push(move.pos);
    }
  }

  const hasOwnWin = byCategory.OWN_WIN.length > 0;
  const hasBlockWin = byCategory.BLOCK_WIN.length > 0;
  const hasOwnOpenFour = byCategory.OWN_OPEN_FOUR.length > 0;
  const hasBlockOpenFour = byCategory.BLOCK_OPEN_FOUR.length > 0;
  const hasOwnFour = byCategory.OWN_FOUR.length > 0;
  const hasBlockFour = byCategory.BLOCK_FOUR.length > 0;

  const nodeKind: ForcedMoveList['nodeKind'] =
    hasOwnWin ||
    hasBlockWin ||
    hasOwnOpenFour ||
    hasBlockOpenFour ||
    hasOwnFour ||
    hasBlockFour
      ? 'tactical'
      : 'quiet';

  const result: ForcedMoveList = {
    moves,
    byCategory,
    hasOwnWin,
    hasBlockWin,
    hasOwnOpenFour,
    hasBlockOpenFour,
    hasOwnFour,
    hasBlockFour,
    maxPriority: moves.length > 0 ? moves[0].priority : null,
    nodeKind,
    generatedAtHash: req.currentHash,
  };

  if (stats) {
    stats.threat.modelTimeMs += performance.now() - start;
    stats.threat.forcedGenerated += 1;
    stats.threat.forcedMovesTotal += moves.length;
    stats.threat.ownWinMoves += byCategory.OWN_WIN.length;
    stats.threat.blockWinMoves += byCategory.BLOCK_WIN.length;
    stats.threat.ownOpenFourMoves += byCategory.OWN_OPEN_FOUR.length;
    stats.threat.blockOpenFourMoves += byCategory.BLOCK_OPEN_FOUR.length;
    stats.threat.ownFourMoves += byCategory.OWN_FOUR.length;
    stats.threat.blockFourMoves += byCategory.BLOCK_FOUR.length;
    stats.threat.openThreeDefenseMoves += byCategory.OPEN_THREE_DEFENSE.length;

    if (nodeKind === 'tactical') {
      stats.threat.tacticalNodes++;
    } else {
      stats.threat.quietNodes++;
    }
  }

  return result;
};