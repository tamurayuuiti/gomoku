// src/utils/ai/searchStats.ts
// 第4弾：統計情報の生成・集計・ログ出力を担うモジュール。
//
// 設計方針:
//   - 統計値は探索の意思決定に使わない。
//   - 探索中の文字列生成・JSON 生成は行わず、思考終了後だけログ出力する。
//   - Worker / UI には送信せず、Worker 内 console への出力に留める。
//
// 追加機能:
//   - 対局開始から終了までの全体統計（GameSessionStats）を保持する。
//   - 対局終了時に [AI:GameSummary] を出力する。

import type { Player } from '../../types/game';
import type { SearchStats } from '../../types/ai';
import type { TTExtendedStats } from './transpositionTable';
import type { PatternCacheStats } from './evaluator';
import { AI_DEBUG_CONFIG } from './constants';
import { BOARD_SIZE } from '../gameLogic';

/**
 * 空の統計オブジェクトを生成する。
 * 1回の calculateNextMove 呼び出しごとに新規生成する。
 */
export const createSearchStats = (
  turn: Player | null,
  searchMode: 'center' | 'fixed' | 'iterative',
  maxDepth: number,
  timeLimitMs: number | null,
  lastMove: import('../../types/game').Position | null
): SearchStats => ({
  schemaVersion: 1,
  turn,
  searchMode,
  selectedMove: null,
  selectedScore: null,
  lastMove,
  maxDepth,
  completedDepth: 0,
  time: {
    elapsedMs: 0,
    limitMs: timeLimitMs,
    aborted: false,
  },
  nodes: {
    total: 0,
    internal: 0,
    leaf: 0,
    ttCutoff: 0,
    immediateWin: 0,
    immediateLoss: 0,
  },
  tt: {
    lookups: 0,
    hits: 0,
    hitRate: 0,
    stores: 0,
    storesExact: 0,
    storesLower: 0,
    storesUpper: 0,
    storesRejectedShallow: 0,
    bestMoveProvided: 0,
    bestMoveUsed: 0,
    evictions: 0,
    maxSize: 0,
    finalSize: 0,
  },
  pvs: {
    nullSearches: 0,
    failHighResearches: 0,
    failLowResearches: 0,
    fullResearches: 0,
    rootNullSearches: 0,
  },
  lmr: {
    attempted: 0,
    reduced: 0,
    reductionTotal: 0,
    researches: 0,
    skippedTactical: 0,
    skippedKiller: 0,
    skippedCountermove: 0,
    skippedTTMove: 0,
  },
  aspiration: {
    attempts: 0,
    failHigh: 0,
    failLow: 0,
    fullResearches: 0,
  },
  candidates: {
    genCalls: 0,
    selectedTotal: 0,
    avgPerNode: 0,
    maxPerNode: 0,
    criticalTotal: 0,
    quietTotal: 0,
    quietPrunedTotal: 0,
  },
  ordering: {
    ttBestMoveUsed: 0,
    killerHits: 0,
    killerStores: 0,
    countermoveHits: 0,
    countermoveStores: 0,
    historyStores: 0,
  },
  cache: {
    lineCacheUpdates: 0,
    lineCacheUndos: 0,
    lineCacheEvalCalls: 0,
    lineCacheFallbackCalls: 0,
    patternCacheHits: 0,
    patternCacheMisses: 0,
    patternCacheSize: 0,
  },
  candidateSet: {
    used: false,
    updates: 0,
    undos: 0,
    maxSize: 0,
    avgSize: 0,
    sizeSum: 0,
    sizeSamples: 0,
  },
});

/**
 * CandidateSet サイズを標本記録する。
 * 平均・最大サイズ算出用。
 */
export const recordCandidateSetSize = (
  stats: SearchStats,
  size: number
): void => {
  stats.candidateSet.sizeSum += size;
  stats.candidateSet.sizeSamples += 1;

  if (size > stats.candidateSet.maxSize) {
    stats.candidateSet.maxSize = size;
  }
};

/**
 * TranspositionTable の拡張統計を SearchStats へ反映する。
 * tt.bestMoveUsed は candidateGenerator 側で集計済みのため、ここでは上書きしない。
 */
export const mergeTTStats = (
  stats: SearchStats,
  ttStats: TTExtendedStats
): void => {
  stats.tt.lookups = ttStats.lookups;
  stats.tt.hits = ttStats.hits;
  stats.tt.stores = ttStats.stores;
  stats.tt.storesExact = ttStats.storesExact;
  stats.tt.storesLower = ttStats.storesLower;
  stats.tt.storesUpper = ttStats.storesUpper;
  stats.tt.storesRejectedShallow = ttStats.storesRejectedShallow;
  stats.tt.bestMoveProvided = ttStats.bestMoveProvided;
  stats.tt.evictions = ttStats.evictions;
  stats.tt.maxSize = ttStats.maxSize;
  stats.tt.finalSize = ttStats.size;
};

/**
 * パターンキャッシュ統計を SearchStats へ反映する。
 */
export const mergePatternCacheStats = (
  stats: SearchStats,
  patternStats: PatternCacheStats
): void => {
  stats.cache.patternCacheHits = patternStats.hits;
  stats.cache.patternCacheMisses = patternStats.misses;
  stats.cache.patternCacheSize = patternStats.size;
};

/**
 * 派生指標の確定と JSON 安全化を行う。
 * 思考終了後、ログ出力前に呼び出す。
 */
export const finalizeSearchStats = (stats: SearchStats): void => {
  stats.time.elapsedMs = Math.round(stats.time.elapsedMs);

  stats.tt.hitRate =
    stats.tt.lookups > 0 ? stats.tt.hits / stats.tt.lookups : 0;

  stats.candidates.avgPerNode =
    stats.candidates.genCalls > 0
      ? stats.candidates.selectedTotal / stats.candidates.genCalls
      : 0;

  stats.candidateSet.avgSize =
    stats.candidateSet.sizeSamples > 0
      ? stats.candidateSet.sizeSum / stats.candidateSet.sizeSamples
      : 0;

  if (
    stats.selectedScore !== null &&
    !Number.isFinite(stats.selectedScore)
  ) {
    stats.selectedScore = null;
  }

  if (!Number.isFinite(stats.tt.hitRate)) {
    stats.tt.hitRate = 0;
  }

  if (!Number.isFinite(stats.candidates.avgPerNode)) {
    stats.candidates.avgPerNode = 0;
  }

  if (!Number.isFinite(stats.candidateSet.avgSize)) {
    stats.candidateSet.avgSize = 0;
  }
};

/**
 * 既存の [Minimax] / [Search] 系ログを出力するかどうか。
 * 第4弾ではデフォルトで抑制する。
 */
export const shouldLogVerboseSearch = (): boolean =>
  AI_DEBUG_CONFIG.ENABLE_STATS && AI_DEBUG_CONFIG.ENABLE_VERBOSE_SEARCH_LOGS;

const formatMove = (
  move: import('../../types/game').Position | null
): string =>
  move ? `(${move.row},${move.col})` : 'none';

const formatScore = (score: number | null): string =>
  score === null ? 'none' : String(score);

const formatLimit = (limitMs: number | null): string =>
  limitMs === null ? 'none' : `${Math.round(limitMs)}ms`;

/**
 * 思考終了後に 1 回だけログ出力する。
 *
 * - LOG_LEVEL = 'none'     : 出力しない
 * - LOG_LEVEL = 'summary'  : 1 行サマリのみ
 * - LOG_LEVEL = 'detailed' : サマリ + JSON
 * - ENABLE_DETAILED_JSON   : summary でも JSON を併記
 */
export const logSearchSummary = (stats: SearchStats): void => {
  if (!AI_DEBUG_CONFIG.ENABLE_STATS) return;
  if (AI_DEBUG_CONFIG.LOG_LEVEL === 'none') return;

  const summary =
    `[AI:Summary] v=${stats.schemaVersion} ` +
    `mode=${stats.searchMode} ` +
    `turn=${stats.turn ?? 'none'} ` +
    `move=${formatMove(stats.selectedMove)} ` +
    `depth=${stats.completedDepth}/${stats.maxDepth} ` +
    `time=${Math.round(stats.time.elapsedMs)}ms ` +
    `limit=${formatLimit(stats.time.limitMs)} ` +
    `score=${formatScore(stats.selectedScore)} ` +
    `aborted=${stats.time.aborted} ` +
    `nodes=${stats.nodes.total} ` +
    `leaf=${stats.nodes.leaf} ` +
    `ttHit=${(stats.tt.hitRate * 100).toFixed(1)}% ` +
    `pvsRS=${stats.pvs.fullResearches} ` +
    `lmrRed=${stats.lmr.reduced} ` +
    `candAvg=${stats.candidates.avgPerNode.toFixed(1)} ` +
    `csUsed=${stats.candidateSet.used} ` +
    `csMax=${stats.candidateSet.maxSize}`;

  console.log(summary);

  const shouldOutputJson =
    AI_DEBUG_CONFIG.LOG_LEVEL === 'detailed' ||
    AI_DEBUG_CONFIG.ENABLE_DETAILED_JSON;

  if (shouldOutputJson) {
    console.log(JSON.stringify(stats));
  }
};

// ============================================================
// 対局全体統計（GameSessionStats）
// ============================================================

export type GameSessionResult =
  | 'Win'
  | 'Loss'
  | 'Draw'
  | 'Unknown'
  | 'Reset';

export interface GameSessionStats {
  schemaVersion: number;

  /** AI から見た勝敗 */
  result: GameSessionResult | null;

  /** AI プレイヤー色 */
  aiPlayer: Player | null;

  /** セッション開始時刻（performance.now 基準） */
  startedAtMs: number;

  /** セッション終了時刻（performance.now 基準） */
  finishedAtMs: number;

  /** 対局経過時間（参考値。人間の手番待ちを含む） */
  durationMs: number;

  /** AI が実際に着手した回数 */
  aiMoves: number;

  /** 推定総手数（盤上の石数ベース） */
  totalMoves: number;

  /** 最後に観測した盤面手数（AI 着手後） */
  lastObservedPlies: number;

  /** 完了深度合計 */
  completedDepthSum: number;

  /** 最大完了深度 */
  completedDepthMax: number;

  /** 平均完了深度 */
  avgDepth: number;

  /** AI 思考時間合計 [ms] */
  elapsedSumMs: number;

  /** AI 最大思考時間 [ms] */
  elapsedMaxMs: number;

  /** AI 平均思考時間 [ms] */
  avgTimeMs: number;

  /** 時間切れ中断が発生した AI 手数 */
  abortCount: number;

  /** 即時勝利検出回数 */
  immediateWinCount: number;

  /** 即時負け検出回数 */
  immediateLossCount: number;

  /** TT 参照回数合計 */
  ttLookups: number;

  /** TT ヒット回数合計 */
  ttHits: number;

  /** TT ヒット率合計 */
  ttHitRate: number;

  /** TT 保存回数合計 */
  ttStores: number;

  /** TT eviction 回数合計 */
  ttEvictions: number;

  /** 最終 TT サイズ（直近 AI 手のもの） */
  ttFinalSize: number;

  /** TT 最大サイズ（AI 手ごと最大） */
  ttMaxSize: number;

  /** Aspiration fail-high 回数 */
  aspirationFailHigh: number;

  /** Aspiration fail-low 回数 */
  aspirationFailLow: number;

  /** Aspiration fail 合計 */
  aspirationFailTotal: number;

  /** Aspiration full re-search 回数 */
  aspirationFullResearches: number;

  /** PVS full re-search 回数 */
  pvsFullResearches: number;

  /** root PVS re-search 回数（現在は予約。default では 0） */
  rootPvsResearches: number;

  /** root PVS null 探索回数（参考） */
  rootPvsNullSearches: number;

  /** LMR 適用回数 */
  lmrReduced: number;

  /** LMR 再探索回数 */
  lmrResearches: number;

  /** 候補手生成回数 */
  candidateGenCalls: number;

  /** 候補手生成時間合計 [ms] */
  candidateGenTimeMs: number;

  /** Static Eval Cache 参照回数（予約） */
  staticEvalCacheLookups: number;

  /** Static Eval Cache ヒット回数（予約） */
  staticEvalCacheHits: number;

  /** Static Eval Cache ヒット率（予約） */
  staticEvalCacheHitRate: number;

  /** LineCache 評価呼び出し回数 */
  lineCacheEvalCalls: number;

  /** LineCache フォールバック呼び出し回数 */
  lineCacheFallbackCalls: number;

  /** パターンキャッシュヒット回数 */
  patternCacheHits: number;

  /** パターンキャッシュミス回数 */
  patternCacheMisses: number;
}

let activeGameSession: GameSessionStats | null = null;

const createGameSessionStats = (
  aiPlayer: Player | null
): GameSessionStats => ({
  schemaVersion: 1,
  result: null,
  aiPlayer,
  startedAtMs: performance.now(),
  finishedAtMs: 0,
  durationMs: 0,
  aiMoves: 0,
  totalMoves: 0,
  lastObservedPlies: 0,
  completedDepthSum: 0,
  completedDepthMax: 0,
  avgDepth: 0,
  elapsedSumMs: 0,
  elapsedMaxMs: 0,
  avgTimeMs: 0,
  abortCount: 0,
  immediateWinCount: 0,
  immediateLossCount: 0,
  ttLookups: 0,
  ttHits: 0,
  ttHitRate: 0,
  ttStores: 0,
  ttEvictions: 0,
  ttFinalSize: 0,
  ttMaxSize: 0,
  aspirationFailHigh: 0,
  aspirationFailLow: 0,
  aspirationFailTotal: 0,
  aspirationFullResearches: 0,
  pvsFullResearches: 0,
  rootPvsResearches: 0,
  rootPvsNullSearches: 0,
  lmrReduced: 0,
  lmrResearches: 0,
  candidateGenCalls: 0,
  candidateGenTimeMs: 0,
  staticEvalCacheLookups: 0,
  staticEvalCacheHits: 0,
  staticEvalCacheHitRate: 0,
  lineCacheEvalCalls: 0,
  lineCacheFallbackCalls: 0,
  patternCacheHits: 0,
  patternCacheMisses: 0,
});

export const isGameSessionActive = (): boolean =>
  activeGameSession !== null;

export const getActiveGameSession = (): GameSessionStats | null =>
  activeGameSession;

/**
 * 対局セッションを確保する。
 * 既にアクティブなセッションがあれば何もしない。
 */
export const ensureGameSession = (aiPlayer: Player | null): void => {
  if (!AI_DEBUG_CONFIG.ENABLE_STATS) return;

  if (!activeGameSession) {
    activeGameSession = createGameSessionStats(aiPlayer);
  }
};

/**
 * candidateGenerator から候補手生成時間を受け取る。
 */
export const recordCandidateGenTime = (ms: number): void => {
  if (!activeGameSession) return;

  activeGameSession.candidateGenTimeMs += ms;
};

/**
 * 1手分の SearchStats を対局セッションへ積算する。
 */
export const recordMoveToSession = (
  stats: SearchStats,
  observedPliesAfter: number,
  movePlayed: boolean
): void => {
  if (!activeGameSession) return;

  const s = activeGameSession;

  if (movePlayed) {
    s.aiMoves += 1;
    s.lastObservedPlies = Math.max(s.lastObservedPlies, observedPliesAfter);
  }

  s.completedDepthSum += stats.completedDepth;
  s.completedDepthMax = Math.max(s.completedDepthMax, stats.completedDepth);

  s.elapsedSumMs += stats.time.elapsedMs;
  s.elapsedMaxMs = Math.max(s.elapsedMaxMs, stats.time.elapsedMs);

  if (stats.time.aborted) {
    s.abortCount += 1;
  }

  s.immediateWinCount += stats.nodes.immediateWin;
  s.immediateLossCount += stats.nodes.immediateLoss;

  s.ttLookups += stats.tt.lookups;
  s.ttHits += stats.tt.hits;
  s.ttStores += stats.tt.stores;
  s.ttEvictions += stats.tt.evictions;
  s.ttFinalSize = stats.tt.finalSize;
  s.ttMaxSize = Math.max(s.ttMaxSize, stats.tt.maxSize);

  s.aspirationFailHigh += stats.aspiration.failHigh;
  s.aspirationFailLow += stats.aspiration.failLow;
  s.aspirationFullResearches += stats.aspiration.fullResearches;

  s.pvsFullResearches += stats.pvs.fullResearches;
  s.rootPvsNullSearches += stats.pvs.rootNullSearches;

  s.lmrReduced += stats.lmr.reduced;
  s.lmrResearches += stats.lmr.researches;

  s.candidateGenCalls += stats.candidates.genCalls;

  s.lineCacheEvalCalls += stats.cache.lineCacheEvalCalls;
  s.lineCacheFallbackCalls += stats.cache.lineCacheFallbackCalls;
  s.patternCacheHits += stats.cache.patternCacheHits;
  s.patternCacheMisses += stats.cache.patternCacheMisses;
};

/**
 * 対局セッションを終了し、要約ログを出力する。
 * 既にセッションがなければ何もしない。
 */
export const finalizeGameSession = (
  result: GameSessionResult = 'Unknown'
): void => {
  if (!activeGameSession) return;

  const s = activeGameSession;
  activeGameSession = null;

  s.result = result;
  s.finishedAtMs = performance.now();
  s.durationMs = Math.round(s.finishedAtMs - s.startedAtMs);

  // 総手数の推定。
  // 基本は最後に観測した AI 着手後の石数。
  // 人間の手で終わった場合は +1 して推定する。
  let totalMoves = s.lastObservedPlies;

  if (result === 'Loss') {
    totalMoves += 1;
  }

  if (result === 'Draw' && totalMoves < BOARD_SIZE * BOARD_SIZE) {
    totalMoves += 1;
  }

  s.totalMoves = totalMoves;

  s.avgDepth = s.aiMoves > 0 ? s.completedDepthSum / s.aiMoves : 0;
  s.avgTimeMs = s.aiMoves > 0 ? s.elapsedSumMs / s.aiMoves : 0;

  s.ttHitRate = s.ttLookups > 0 ? s.ttHits / s.ttLookups : 0;
  s.aspirationFailTotal = s.aspirationFailHigh + s.aspirationFailLow;

  s.staticEvalCacheHitRate =
    s.staticEvalCacheLookups > 0
      ? s.staticEvalCacheHits / s.staticEvalCacheLookups
      : 0;

  if (!AI_DEBUG_CONFIG.ENABLE_STATS) return;
  if (AI_DEBUG_CONFIG.LOG_LEVEL === 'none') return;

  const summary =
    `[AI:GameSummary] v=${s.schemaVersion} ` +
    `result=${s.result} ` +
    `ai=${s.aiPlayer ?? 'none'} ` +
    `totalMoves=${s.totalMoves} ` +
    `aiMoves=${s.aiMoves} ` +
    `depthAvg=${s.avgDepth.toFixed(1)} ` +
    `depthMax=${s.completedDepthMax} ` +
    `timeAvg=${Math.round(s.avgTimeMs)}ms ` +
    `timeTotal=${Math.round(s.elapsedSumMs)}ms ` +
    `aborts=${s.abortCount} ` +
    `immWin=${s.immediateWinCount} ` +
    `ttLookups=${s.ttLookups} ` +
    `ttHit=${(s.ttHitRate * 100).toFixed(1)}% ` +
    `ttStores=${s.ttStores} ` +
    `ttEvictions=${s.ttEvictions} ` +
    `ttSize=${s.ttFinalSize} ` +
    `aspFail=${s.aspirationFailTotal} ` +
    `pvsRS=${s.pvsFullResearches} ` +
    `rootPvsRS=${s.rootPvsResearches} ` +
    `lmrRed=${s.lmrReduced} ` +
    `candGenCalls=${s.candidateGenCalls} ` +
    `candGenTime=${Math.round(s.candidateGenTimeMs)}ms ` +
    `secLookups=${s.staticEvalCacheLookups} ` +
    `secHit=${(s.staticEvalCacheHitRate * 100).toFixed(1)}%`;

  console.log(summary);

  const shouldOutputJson =
    AI_DEBUG_CONFIG.LOG_LEVEL === 'detailed' ||
    AI_DEBUG_CONFIG.ENABLE_DETAILED_JSON;

  if (shouldOutputJson) {
    console.log(JSON.stringify(s));
  }
};