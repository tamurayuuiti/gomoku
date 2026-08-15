// src/utils/ai/searchStats.ts
// 統計情報の生成・集計・ログ出力を担うモジュール。
//
// 設計方針:
//   - 統計値は探索の意思決定に使わない。
//   - 探索中の文字列生成・JSON 生成は行わず、思考終了後だけログ出力する。
//   - Worker / UI には送信せず、Worker 内 console への出力に留める。
//
// 内部構成:
//   1. 1手ごとの統計: 生成 / マージ / 派生指標の確定 / ログ出力
//   2. 対局セッション: 型定義 / 状態 / ライフサイクル / 積算 / 派生指標 / ログ出力

import type { Player, Position } from '../../types/game';
import type { SearchStats } from '../../types/ai';
import type { TTExtendedStats } from './transpositionTable';
import { DIAGNOSTICS_CONFIG } from './diagnosticsFlags';
import { PERF_FEATURES } from './constants';
import { BOARD_SIZE } from '../gameLogic';

// ============================================================
// 1手ごとの統計: 生成
// ============================================================

/**
 * 空の統計オブジェクトを生成する。
 * 1回の calculateNextMove 呼び出しごとに新規生成する。
 */
export const createSearchStats = (
  turn: Player | null,
  searchMode: 'center' | 'fixed' | 'iterative',
  maxDepth: number,
  timeLimitMs: number | null,
  lastMove: Position | null
): SearchStats => ({
  schemaVersion: 10,
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
    lastIterationMs: 0,
    predictedSkips: 0,
    remainingAtSkipMs: 0,
    adaptivePredictionUsed: false,
    adaptiveEstimateMs: 0,
    adaptiveRatioSamples: 0,
    adaptiveMedianRatio: 0,
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
    tacticalNullSkips: 0,
    quietNullSearches: 0,
    rootFailHighResearches: 0,
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
    windowSum: 0,
    windowMax: 0,
    adaptiveExpansions: 0,
    disabledNearWin: 0,
  },
  candidates: {
    genCalls: 0,
    selectedTotal: 0,
    avgPerNode: 0,
    maxPerNode: 0,
    criticalTotal: 0,
    quietTotal: 0,
    quietPrunedTotal: 0,
    genTimeMs: 0,
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
  diagnostics: {
    checkWinCalls: 0,
    checkWinTimeMs: 0,
    leafEvalCalls: 0,
    leafEvalTimeMs: 0,
    /** Packed Integer 評価が有効かどうか（Flag 状態の診断用） */
    packedEvalEnabled: PERF_FEATURES.ENABLE_PACKED_EVALUATION,
  },
  staticEvalCache: {
    lookups: 0,
    hits: 0,
    misses: 0,
    stores: 0,
    evictions: 0,
    size: 0,
    maxSize: 0,
    hitRate: 0,
  },
  threat: {
    modelCalls: 0,
    modelTimeMs: 0,
    forcedGenerated: 0,
    forcedMovesTotal: 0,
    ownWinMoves: 0,
    blockWinMoves: 0,
    ownOpenFourMoves: 0,
    blockOpenFourMoves: 0,
    ownFourMoves: 0,
    blockFourMoves: 0,
    openThreeDefenseMoves: 0,
    rootForcedIncluded: 0,
    rootForcedMissing: 0,
    rootForcedDropped: 0,
    internalForcedCalls: 0,
    tacticalNodes: 0,
    quietNodes: 0,
  },
  forbidden: {
    dynamicChecks: 0,
    dynamicForbiddenMoves: 0,
    dynamicSkippedWhite: 0,
    dynamicSkippedDeep: 0,
    dynamicSkippedDisabled: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheEvictions: 0,
    cacheSize: 0,
    cacheMaxSize: 0,
    rootMoveRejectedByForbidden: 0,
    mismatchWithStaticForbidden: 0,
    forbiddenRuleEnabled: false,
  },
  vcf: {
    rootCalls: 0,
    rootDisabled: 0,
    rootSkippedEarlyGame: 0,
    rootSkippedLowTime: 0,
    rootSkippedLowDepth: 0,
    rootSkippedByOption: 0,
    rootFound: 0,
    rootFail: 0,
    rootAborted: 0,
    rootError: 0,
    rootUsedAsFinalMove: 0,
    rootRejectedByForbidden: 0,
    rootNodes: 0,
    rootMaxPlyReached: 0,
    rootTimeMs: 0,
    rootBudgetMs: 0,
    rootImmediateWins: 0,
    rootTerminalOpenFours: 0,
    rootDefenderCounterWins: 0,
    rootIllegalBlockMoves: 0,
    rootForbiddenChecks: 0,
    rootForbiddenCacheHits: 0,
    rootForbiddenCacheMisses: 0,
  },
  qsearch: {
    calls: 0,
    disabled: 0,
    skippedEarlyGame: 0,
    skippedLowTime: 0,
    skippedLowDepth: 0,
    skippedByOption: 0,
    budgetExhausted: 0,
    nodes: 0,
    timeMs: 0,
    budgetMs: 0,
    win: 0,
    loss: 0,
    unknown: 0,
    abort: 0,
    error: 0,
    fallback: 0,
    maxPlyReached: 0,
    immediateWins: 0,
    terminalOpenFours: 0,
    illegalBlocks: 0,
    defenderCounterWins: 0,
    forbiddenChecks: 0,
    forbiddenCacheHits: 0,
    forbiddenCacheMisses: 0,
    forbiddenCacheEvictions: 0,
    forbiddenCacheSize: 0,
    forbiddenCacheMaxSize: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheEvictions: 0,
    cacheSize: 0,
    cacheMaxSize: 0,
    cacheHitRate: 0,
    forbiddenCacheHitRate: 0,
    auditFails: 0,
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

// ============================================================
// 1手ごとの統計: 外部統計のマージ
// ============================================================

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

// ============================================================
// 1手ごとの統計: 派生指標の確定
// ============================================================

/**
 * 派生指標の確定と JSON 安全化を行う。
 * 思考終了後、ログ出力前に呼び出す。
 */
export const finalizeSearchStats = (stats: SearchStats): void => {
  stats.time.elapsedMs = Math.round(stats.time.elapsedMs);
  stats.time.adaptiveEstimateMs = Number.isFinite(stats.time.adaptiveEstimateMs)
    ? Math.round(stats.time.adaptiveEstimateMs)
    : 0;
  stats.time.adaptiveMedianRatio = Number.isFinite(stats.time.adaptiveMedianRatio)
    ? Math.round(stats.time.adaptiveMedianRatio * 100) / 100
    : 0;

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

  stats.staticEvalCache.hitRate =
    stats.staticEvalCache.lookups > 0
      ? stats.staticEvalCache.hits / stats.staticEvalCache.lookups
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
  if (!Number.isFinite(stats.staticEvalCache.hitRate)) {
    stats.staticEvalCache.hitRate = 0;
  }
  if (!Number.isFinite(stats.threat.modelTimeMs)) {
    stats.threat.modelTimeMs = 0;
  }
  if (!Number.isFinite(stats.vcf.rootTimeMs)) {
    stats.vcf.rootTimeMs = 0;
  }
  if (!Number.isFinite(stats.vcf.rootBudgetMs)) {
    stats.vcf.rootBudgetMs = 0;
  }
  stats.vcf.rootTimeMs = Math.round(stats.vcf.rootTimeMs);
  stats.vcf.rootBudgetMs = Math.round(stats.vcf.rootBudgetMs);

  const qCacheCalls = stats.qsearch.cacheHits + stats.qsearch.cacheMisses;
  stats.qsearch.cacheHitRate =
    qCacheCalls > 0 ? stats.qsearch.cacheHits / qCacheCalls : 0;

  const qFbCalls =
    stats.qsearch.forbiddenCacheHits + stats.qsearch.forbiddenCacheMisses;
  stats.qsearch.forbiddenCacheHitRate =
    qFbCalls > 0 ? stats.qsearch.forbiddenCacheHits / qFbCalls : 0;

  if (!Number.isFinite(stats.qsearch.timeMs)) {
    stats.qsearch.timeMs = 0;
  }
  if (!Number.isFinite(stats.qsearch.cacheHitRate)) {
    stats.qsearch.cacheHitRate = 0;
  }
  if (!Number.isFinite(stats.qsearch.forbiddenCacheHitRate)) {
    stats.qsearch.forbiddenCacheHitRate = 0;
  }
  stats.qsearch.timeMs = Math.round(stats.qsearch.timeMs);
  stats.qsearch.budgetMs = Math.round(stats.qsearch.budgetMs);
};

// ============================================================
// 1手ごとの統計: ログ出力補助関数
// ============================================================

/**
 * 既存の [Minimax] / [Search] 系ログを出力するかどうか。
 */
export const shouldLogVerboseSearch = (): boolean =>
  DIAGNOSTICS_CONFIG.ENABLE_STATS &&
  DIAGNOSTICS_CONFIG.ENABLE_VERBOSE_SEARCH_LOGS;

const formatMove = (move: Position | null): string =>
  move ? `(${move.row},${move.col})` : 'none';

const formatScore = (score: number | null): string =>
  score === null ? 'none' : String(score);

const formatLimit = (limitMs: number | null): string =>
  limitMs === null ? 'none' : `${Math.round(limitMs)}ms`;

/**
 * 安全な割合計算。
 */
const safeRate = (
  numerator: number,
  denominator: number,
  digits: number
): string => {
  if (denominator <= 0) {
    return (0).toFixed(digits);
  }
  const value = (100 * numerator) / denominator;
  return Number.isFinite(value) ? value.toFixed(digits) : (0).toFixed(digits);
};

/**
 * 安全な平均時間（µs）計算。
 */
const safeAvgUs = (timeMs: number, calls: number): string => {
  if (calls <= 0 || timeMs <= 0) {
    return '0.00';
  }
  const value = (timeMs * 1000) / calls;
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
};

// ============================================================
// 1手ごとの統計: ログ出力
// ============================================================

/**
 * 思考終了後に 1 回だけログ出力する。
 *
 * - LOG_LEVEL = 'none'     : 出力しない
 * - LOG_LEVEL = 'summary'  : 1 行サマリのみ
 * - LOG_LEVEL = 'detailed' : サマリ + JSON
 * - ENABLE_DETAILED_JSON   : summary でも JSON を併記
 */
export const logSearchSummary = (stats: SearchStats): void => {
  if (!DIAGNOSTICS_CONFIG.ENABLE_STATS) return;
  if (DIAGNOSTICS_CONFIG.LOG_LEVEL === 'none') return;

  const aspirationFail =
    stats.aspiration.failHigh + stats.aspiration.failLow;
  const aspFailRate = safeRate(
    aspirationFail,
    stats.aspiration.attempts,
    1
  );

  const chkAvgUs = safeAvgUs(
    stats.diagnostics.checkWinTimeMs,
    stats.diagnostics.checkWinCalls
  );
  const leafAvgUs = safeAvgUs(
    stats.diagnostics.leafEvalTimeMs,
    stats.diagnostics.leafEvalCalls
  );
  const candAvgUs = safeAvgUs(
    stats.candidates.genTimeMs,
    stats.candidates.genCalls
  );
  const threatAvgUs = safeAvgUs(
    stats.threat.modelTimeMs,
    stats.threat.modelCalls
  );

  const forbiddenCacheCalls =
    stats.forbidden.cacheHits + stats.forbidden.cacheMisses;
  const forbiddenCacheHitRate = safeRate(
    stats.forbidden.cacheHits,
    forbiddenCacheCalls,
    1
  );

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
    `csMax=${stats.candidateSet.maxSize} ` +
    `candTime=${Math.round(stats.candidates.genTimeMs)}ms ` +
    `secHit=${(stats.staticEvalCache.hitRate * 100).toFixed(1)}% ` +
    `secMax=${stats.staticEvalCache.maxSize} ` +
    `pvsNull=${stats.pvs.nullSearches} ` +
    `pvsFH=${stats.pvs.failHighResearches} ` +
    `pvsFL=${stats.pvs.failLowResearches} ` +
    `pvsSkip=${stats.pvs.tacticalNullSkips} ` +
    `lmrRS=${stats.lmr.researches} ` +
    `ttCut=${stats.nodes.ttCutoff} ` +
    `ttBest=${stats.tt.bestMoveUsed} ` +
    `ttMax=${stats.tt.maxSize} ` +
    `ttFinal=${stats.tt.finalSize} ` +
    `chk=${stats.diagnostics.checkWinCalls} ` +
    `chkMs=${Math.round(stats.diagnostics.checkWinTimeMs)} ` +
    `leafEval=${stats.diagnostics.leafEvalCalls} ` +
    `leafMs=${Math.round(stats.diagnostics.leafEvalTimeMs)} ` +
    `packedEval=${stats.diagnostics.packedEvalEnabled ? 1 : 0} ` +
    `timeSkip=${stats.time.predictedSkips} ` +
    `adpUsed=${stats.time.adaptivePredictionUsed ? 1 : 0} ` +
    `adpEst=${stats.time.adaptiveEstimateMs}ms ` +
    `adpSamples=${stats.time.adaptiveRatioSamples} ` +
    `adpRatio=${stats.time.adaptiveMedianRatio.toFixed(2)} ` +
    `aspFailRate=${aspFailRate}% ` +
    `chkAvgUs=${chkAvgUs} ` +
    `leafAvgUs=${leafAvgUs} ` +
    `candAvgUs=${candAvgUs} ` +
    `secMiss=${stats.staticEvalCache.misses} ` +
    `secEvict=${stats.staticEvalCache.evictions} ` +
    `threatCalls=${stats.threat.modelCalls} ` +
    `threatAvgUs=${threatAvgUs} ` +
    `forced=${stats.threat.forcedMovesTotal} ` +
    `fw=${stats.threat.ownWinMoves} ` +
    `bfw=${stats.threat.blockWinMoves} ` +
    `fof=${stats.threat.ownOpenFourMoves} ` +
    `bfof=${stats.threat.blockOpenFourMoves} ` +
    `f4=${stats.threat.ownFourMoves} ` +
    `bf4=${stats.threat.blockFourMoves} ` +
    `rfInc=${stats.threat.rootForcedIncluded} ` +
    `rfMiss=${stats.threat.rootForcedMissing} ` +
    `rfDrop=${stats.threat.rootForcedDropped} ` +
    `tNodes=${stats.threat.tacticalNodes}/${stats.threat.quietNodes} ` +
    `fbRule=${stats.forbidden.forbiddenRuleEnabled ? 1 : 0} ` +
    `dynFb=${stats.forbidden.dynamicForbiddenMoves} ` +
    `dynChk=${stats.forbidden.dynamicChecks} ` +
    `fbHit=${forbiddenCacheHitRate}% ` +
    `fbMis=${stats.forbidden.mismatchWithStaticForbidden} ` +
    `fbRej=${stats.forbidden.rootMoveRejectedByForbidden} ` +
    `vcfRoot=${stats.vcf.rootCalls} ` +
    `vcfFound=${stats.vcf.rootFound} ` +
    `vcfFail=${stats.vcf.rootFail} ` +
    `vcfAbort=${stats.vcf.rootAborted} ` +
    `vcfErr=${stats.vcf.rootError} ` +
    `vcfTime=${Math.round(stats.vcf.rootTimeMs)}ms ` +
    `vcfBudget=${Math.round(stats.vcf.rootBudgetMs)}ms ` +
    `vcfNodes=${stats.vcf.rootNodes} ` +
    `vcfPly=${stats.vcf.rootMaxPlyReached} ` +
    `vcfUsed=${stats.vcf.rootUsedAsFinalMove} ` +
    `vcfRej=${stats.vcf.rootRejectedByForbidden} ` +
    `vcfDis=${stats.vcf.rootDisabled} ` +
    `vcfSkipEarly=${stats.vcf.rootSkippedEarlyGame} ` +
    `vcfSkipTime=${stats.vcf.rootSkippedLowTime} ` +
    `vcfSkipDepth=${stats.vcf.rootSkippedLowDepth} ` +
    `vcfSkipOpt=${stats.vcf.rootSkippedByOption} ` +
    `vcfImm=${stats.vcf.rootImmediateWins} ` +
    `vcfTerm=${stats.vcf.rootTerminalOpenFours} ` +
    `vcfCnt=${stats.vcf.rootDefenderCounterWins} ` +
    `vcfBlkIll=${stats.vcf.rootIllegalBlockMoves} ` +
    `qsCalls=${stats.qsearch.calls} ` +
    `qsWin=${stats.qsearch.win} ` +
    `qsLoss=${stats.qsearch.loss} ` +
    `qsUnk=${stats.qsearch.unknown} ` +
    `qsAbort=${stats.qsearch.abort} ` +
    `qsErr=${stats.qsearch.error} ` +
    `qsFall=${stats.qsearch.fallback} ` +
    `qsTime=${Math.round(stats.qsearch.timeMs)}ms ` +
    `qsNodes=${stats.qsearch.nodes} ` +
    `qsPly=${stats.qsearch.maxPlyReached} ` +
    `qsDis=${stats.qsearch.disabled} ` +
    `qsBudget=${stats.qsearch.budgetExhausted} ` +
    `qsHit=${(stats.qsearch.cacheHitRate * 100).toFixed(1)}% ` +
    `qsFbHit=${(stats.qsearch.forbiddenCacheHitRate * 100).toFixed(1)}% ` +
    `qsAudit=${stats.qsearch.auditFails}`;

  console.log(summary);

  const shouldOutputJson =
    DIAGNOSTICS_CONFIG.LOG_LEVEL === 'detailed' ||
    DIAGNOSTICS_CONFIG.ENABLE_DETAILED_JSON;

  if (shouldOutputJson) {
    console.log(JSON.stringify(stats));
  }
};

// ============================================================
// 対局セッション: 型定義
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
  /** checkWin 呼び出し回数 */
  checkWinCalls: number;
  /** checkWin 時間合計 [ms] */
  checkWinTimeMs: number;
  /** 葉評価実行回数 */
  leafEvalCalls: number;
  /** 葉評価時間合計 [ms] */
  leafEvalTimeMs: number;
  /** PVS null-window 回数 */
  pvsNullSearches: number;
  /** PVS fail-high 再探索回数 */
  pvsFailHighResearches: number;
  /** PVS fail-low 再探索回数 */
  pvsFailLowResearches: number;
  /** PVS null-window 抑制回数 */
  pvsTacticalNullSkips: number;
  /** quiet 手での PVS null-window 回数 */
  pvsQuietNullSearches: number;
  /** TT カットオフ回数 */
  ttCutoffs: number;
  /** TT bestMove が候補 tier に含まれた回数 */
  ttBestMoveUsed: number;
  /** 直近 AI 手の TT 最終サイズ（生の値） */
  ttActualFinalSize: number;
  /** 直近の非ゼロ TT 最終サイズ（ttSize=0 問題の補正用） */
  ttLastNonZeroSize: number;
  /** Aspiration 適用回数 */
  aspirationAttempts: number;
  /** Aspiration 窓幅合計 */
  aspirationWindowSum: number;
  /** Aspiration 窓幅最大 */
  aspirationWindowMax: number;
  /** Aspiration adaptive 拡張回数 */
  aspirationAdaptiveExpansions: number;
  /** Aspiration WIN/LOSS 付近無効化回数 */
  aspirationDisabledNearWin: number;
  /** Static Eval Cache 新規保存回数 */
  staticEvalCacheStores: number;
  /** Static Eval Cache ミス回数 */
  staticEvalCacheMisses: number;
  /** Static Eval Cache eviction 回数 */
  staticEvalCacheEvictions: number;
  /** Static Eval Cache 最大サイズ */
  staticEvalCacheMaxSize: number;
  /** 時間予測による打ち切り回数 */
  timePredictedSkips: number;
  /** Threat Model / forced move list 生成呼び出し回数 */
  threatModelCalls: number;
  /** Threat Model / forced move list 生成時間合計 [ms] */
  threatModelTimeMs: number;
  /** forced move list を生成した回数 */
  forcedGenerated: number;
  /** 生成された forced move の延べ件数 */
  forcedMovesTotal: number;
  /** OWN_WIN に分類された手の延べ件数 */
  ownWinMoves: number;
  /** BLOCK_WIN に分類された手の延べ件数 */
  blockWinMoves: number;
  /** OWN_OPEN_FOUR に分類された手の延べ件数 */
  ownOpenFourMoves: number;
  /** BLOCK_OPEN_FOUR に分類された手の延べ件数 */
  blockOpenFourMoves: number;
  /** OWN_FOUR に分類された手の延べ件数 */
  ownFourMoves: number;
  /** BLOCK_FOUR に分類された手の延べ件数 */
  blockFourMoves: number;
  /** OPEN_THREE_DEFENSE に分類された手の延べ件数 */
  openThreeDefenseMoves: number;
  /** root で既存候補に不足していた必須 forced move を追加した件数 */
  rootForcedIncluded: number;
  /** root で既存候補に不足していた必須 forced move の件数 */
  rootForcedMissing: number;
  /** root で容量上限により追加できなかった必須 forced move の件数 */
  rootForcedDropped: number;
  /** internal node で forced move list 生成を呼び出した回数 */
  internalForcedCalls: number;
  /** tactical node と分類された回数 */
  tacticalNodes: number;
  /** quiet node と分類された回数 */
  quietNodes: number;
  /** 動的禁手判定を実行した回数 */
  dynamicChecks: number;
  /** 動的禁手判定により禁手と判定された回数 */
  dynamicForbiddenMoves: number;
  /** White 手番のため動的禁手をスキップしたノード数 */
  dynamicSkippedWhite: number;
  /** 深度条件により動的禁手をスキップしたノード数 */
  dynamicSkippedDeep: number;
  /** flag / ルール設定により動的禁手をスキップしたノード数 */
  dynamicSkippedDisabled: number;
  /** 禁手キャッシュ hit 回数 */
  forbiddenCacheHits: number;
  /** 禁手キャッシュ miss 回数 */
  forbiddenCacheMisses: number;
  /** 禁手キャッシュ eviction 回数 */
  forbiddenCacheEvictions: number;
  /** 禁手キャッシュ最大サイズ */
  forbiddenCacheMaxSize: number;
  /** root 最終着手が禁手と判定され、フォールバックした回数 */
  rootMoveRejectedByForbidden: number;
  /** 静的 forbiddenMoves では合法だが動的禁手で禁手となった回数 */
  forbiddenMismatch: number;
  /** Root VCF 呼び出し回数 */
  vcfRootCalls: number;
  /** Root VCF 勝ち証明回数 */
  vcfRootFound: number;
  /** Root VCF 証明失敗回数 */
  vcfRootFail: number;
  /** Root VCF 中断回数 */
  vcfRootAborted: number;
  /** Root VCF エラー回数 */
  vcfRootError: number;
  /** Root VCF が最終手として採用された回数 */
  vcfRootUsedAsFinalMove: number;
  /** Root VCF 結果が禁手検証で棄却された回数 */
  vcfRootRejectedByForbidden: number;
  /** Root VCF 時間合計 [ms] */
  vcfRootTimeMs: number;
  /** Root VCF ノード数合計 */
  vcfRootNodes: number;
  /** Root VCF 最大到達 ply */
  vcfRootMaxPlyReached: number;
  /** Root VCF が flag により無効化された回数 */
  vcfRootDisabled: number;
  /** Root VCF が序盤石数不足で skip された回数 */
  vcfRootSkippedEarlyGame: number;
  /** Root VCF が時間制限不足で skip された回数 */
  vcfRootSkippedLowTime: number;
  /** Root VCF が低深度で skip された回数 */
  vcfRootSkippedLowDepth: number;
  /** Root VCF が option / budget により skip された回数 */
  vcfRootSkippedByOption: number;
  /** Root VCF 内で即時勝ちを検出した回数 */
  vcfRootImmediateWins: number;
  /** Root VCF 内で受け不可な四を終端とした回数 */
  vcfRootTerminalOpenFours: number;
  /** Root VCF 内で防御側即時勝ちにより攻撃枝を失敗とした回数 */
  vcfRootDefenderCounterWins: number;
  /** Root VCF 内で防御側ブロック不能により勝ちとした回数 */
  vcfRootIllegalBlockMoves: number;
  /** qsearch 葉呼び出し回数 */
  qsearchCalls: number;
  /** qsearch 勝ち証明回数 */
  qsearchWin: number;
  /** qsearch 負け証明回数 */
  qsearchLoss: number;
  /** qsearch 不明回数 */
  qsearchUnknown: number;
  /** qsearch 中断回数 */
  qsearchAbort: number;
  /** qsearch エラー回数 */
  qsearchError: number;
  /** qsearch fallback 回数 */
  qsearchFallback: number;
  /** qsearch 時間合計 [ms] */
  qsearchTimeMs: number;
  /** qsearch ノード数合計 */
  qsearchNodes: number;
  /** qsearch 最大到達 ply */
  qsearchMaxPlyReached: number;
  /** qsearch 予算切れ回数 */
  qsearchBudgetExhausted: number;
  /** qsearch 無効化回数 */
  qsearchDisabled: number;
  /** qsearch 序盤 skip 回数 */
  qsearchSkippedEarlyGame: number;
  /** qsearch 時間不足 skip 回数 */
  qsearchSkippedLowTime: number;
  /** qsearch 低深度 skip 回数 */
  qsearchSkippedLowDepth: number;
  /** qsearch option skip 回数 */
  qsearchSkippedByOption: number;
  /** qsearch 結果キャッシュ hit 回数 */
  qsearchCacheHits: number;
  /** qsearch 結果キャッシュ miss 回数 */
  qsearchCacheMisses: number;
  /** qsearch 禁手判定回数 */
  qsearchForbiddenChecks: number;
  /** qsearch 禁手キャッシュ hit 回数 */
  qsearchForbiddenCacheHits: number;
  /** qsearch 禁手キャッシュ miss 回数 */
  qsearchForbiddenCacheMisses: number;
  /** qsearch state audit 失敗回数 */
  qsearchAuditFails: number;
  /** adaptive 時間予測が使用された手数 */
  adaptivePredictionUsedCount: number;
  /** adaptive 時間予測の推定比率合計（平均計算用） */
  adaptiveMedianRatioSum: number;
  /** adaptive 時間予測の推定比率平均 */
  adaptiveMedianRatioAvg: number;
}

// ============================================================
// 対局セッション: 状態 / 生成
// ============================================================

let activeGameSession: GameSessionStats | null = null;

const createGameSessionStats = (
  aiPlayer: Player | null
): GameSessionStats => ({
  schemaVersion: 10,
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
  checkWinCalls: 0,
  checkWinTimeMs: 0,
  leafEvalCalls: 0,
  leafEvalTimeMs: 0,
  pvsNullSearches: 0,
  pvsFailHighResearches: 0,
  pvsFailLowResearches: 0,
  pvsTacticalNullSkips: 0,
  pvsQuietNullSearches: 0,
  ttCutoffs: 0,
  ttBestMoveUsed: 0,
  ttActualFinalSize: 0,
  ttLastNonZeroSize: 0,
  aspirationAttempts: 0,
  aspirationWindowSum: 0,
  aspirationWindowMax: 0,
  aspirationAdaptiveExpansions: 0,
  aspirationDisabledNearWin: 0,
  staticEvalCacheStores: 0,
  staticEvalCacheMisses: 0,
  staticEvalCacheEvictions: 0,
  staticEvalCacheMaxSize: 0,
  timePredictedSkips: 0,
  threatModelCalls: 0,
  threatModelTimeMs: 0,
  forcedGenerated: 0,
  forcedMovesTotal: 0,
  ownWinMoves: 0,
  blockWinMoves: 0,
  ownOpenFourMoves: 0,
  blockOpenFourMoves: 0,
  ownFourMoves: 0,
  blockFourMoves: 0,
  openThreeDefenseMoves: 0,
  rootForcedIncluded: 0,
  rootForcedMissing: 0,
  rootForcedDropped: 0,
  internalForcedCalls: 0,
  tacticalNodes: 0,
  quietNodes: 0,
  dynamicChecks: 0,
  dynamicForbiddenMoves: 0,
  dynamicSkippedWhite: 0,
  dynamicSkippedDeep: 0,
  dynamicSkippedDisabled: 0,
  forbiddenCacheHits: 0,
  forbiddenCacheMisses: 0,
  forbiddenCacheEvictions: 0,
  forbiddenCacheMaxSize: 0,
  rootMoveRejectedByForbidden: 0,
  forbiddenMismatch: 0,
  vcfRootCalls: 0,
  vcfRootFound: 0,
  vcfRootFail: 0,
  vcfRootAborted: 0,
  vcfRootError: 0,
  vcfRootUsedAsFinalMove: 0,
  vcfRootRejectedByForbidden: 0,
  vcfRootTimeMs: 0,
  vcfRootNodes: 0,
  vcfRootMaxPlyReached: 0,
  vcfRootDisabled: 0,
  vcfRootSkippedEarlyGame: 0,
  vcfRootSkippedLowTime: 0,
  vcfRootSkippedLowDepth: 0,
  vcfRootSkippedByOption: 0,
  vcfRootImmediateWins: 0,
  vcfRootTerminalOpenFours: 0,
  vcfRootDefenderCounterWins: 0,
  vcfRootIllegalBlockMoves: 0,
  qsearchCalls: 0,
  qsearchWin: 0,
  qsearchLoss: 0,
  qsearchUnknown: 0,
  qsearchAbort: 0,
  qsearchError: 0,
  qsearchFallback: 0,
  qsearchTimeMs: 0,
  qsearchNodes: 0,
  qsearchMaxPlyReached: 0,
  qsearchBudgetExhausted: 0,
  qsearchDisabled: 0,
  qsearchSkippedEarlyGame: 0,
  qsearchSkippedLowTime: 0,
  qsearchSkippedLowDepth: 0,
  qsearchSkippedByOption: 0,
  qsearchCacheHits: 0,
  qsearchCacheMisses: 0,
  qsearchForbiddenChecks: 0,
  qsearchForbiddenCacheHits: 0,
  qsearchForbiddenCacheMisses: 0,
  qsearchAuditFails: 0,
  adaptivePredictionUsedCount: 0,
  adaptiveMedianRatioSum: 0,
  adaptiveMedianRatioAvg: 0,
});

// ============================================================
// 対局セッション: ライフサイクル
// ============================================================

export const isGameSessionActive = (): boolean =>
  activeGameSession !== null;

export const getActiveGameSession = (): GameSessionStats | null =>
  activeGameSession;

/**
 * 対局セッションを確保する。
 * 既にアクティブなセッションがあれば何もしない。
 */
export const ensureGameSession = (aiPlayer: Player | null): void => {
  if (!DIAGNOSTICS_CONFIG.ENABLE_STATS) return;
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

// ============================================================
// 対局セッション: 1手ごとの積算
// ============================================================

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
  s.ttActualFinalSize = stats.tt.finalSize;
  if (stats.tt.finalSize > 0) {
    s.ttLastNonZeroSize = stats.tt.finalSize;
  }
  s.ttMaxSize = Math.max(s.ttMaxSize, stats.tt.maxSize);

  s.aspirationFailHigh += stats.aspiration.failHigh;
  s.aspirationFailLow += stats.aspiration.failLow;
  s.aspirationFullResearches += stats.aspiration.fullResearches;

  s.pvsFullResearches += stats.pvs.fullResearches;
  s.rootPvsNullSearches += stats.pvs.rootNullSearches;
  s.rootPvsResearches += stats.pvs.rootFailHighResearches;

  s.lmrReduced += stats.lmr.reduced;
  s.lmrResearches += stats.lmr.researches;

  s.candidateGenCalls += stats.candidates.genCalls;

  s.lineCacheEvalCalls += stats.cache.lineCacheEvalCalls;
  s.lineCacheFallbackCalls += stats.cache.lineCacheFallbackCalls;

  s.checkWinCalls += stats.diagnostics.checkWinCalls;
  s.checkWinTimeMs += stats.diagnostics.checkWinTimeMs;
  s.leafEvalCalls += stats.diagnostics.leafEvalCalls;
  s.leafEvalTimeMs += stats.diagnostics.leafEvalTimeMs;

  s.pvsNullSearches += stats.pvs.nullSearches;
  s.pvsFailHighResearches += stats.pvs.failHighResearches;
  s.pvsFailLowResearches += stats.pvs.failLowResearches;
  s.pvsTacticalNullSkips += stats.pvs.tacticalNullSkips;
  s.pvsQuietNullSearches += stats.pvs.quietNullSearches;

  s.ttCutoffs += stats.nodes.ttCutoff;
  s.ttBestMoveUsed += stats.tt.bestMoveUsed;

  s.aspirationAttempts += stats.aspiration.attempts;
  s.aspirationWindowSum += stats.aspiration.windowSum;
  s.aspirationWindowMax = Math.max(
    s.aspirationWindowMax,
    stats.aspiration.windowMax
  );
  s.aspirationAdaptiveExpansions += stats.aspiration.adaptiveExpansions;
  s.aspirationDisabledNearWin += stats.aspiration.disabledNearWin;

  s.staticEvalCacheLookups += stats.staticEvalCache.lookups;
  s.staticEvalCacheHits += stats.staticEvalCache.hits;
  s.staticEvalCacheMisses += stats.staticEvalCache.misses;
  s.staticEvalCacheStores += stats.staticEvalCache.stores;
  s.staticEvalCacheEvictions += stats.staticEvalCache.evictions;
  s.staticEvalCacheMaxSize = Math.max(
    s.staticEvalCacheMaxSize,
    stats.staticEvalCache.maxSize
  );

  s.timePredictedSkips += stats.time.predictedSkips;

  if (stats.time.adaptivePredictionUsed) {
    s.adaptivePredictionUsedCount += 1;
    s.adaptiveMedianRatioSum += stats.time.adaptiveMedianRatio;
  }

  s.threatModelCalls += stats.threat.modelCalls;
  s.threatModelTimeMs += stats.threat.modelTimeMs;
  s.forcedGenerated += stats.threat.forcedGenerated;
  s.forcedMovesTotal += stats.threat.forcedMovesTotal;
  s.ownWinMoves += stats.threat.ownWinMoves;
  s.blockWinMoves += stats.threat.blockWinMoves;
  s.ownOpenFourMoves += stats.threat.ownOpenFourMoves;
  s.blockOpenFourMoves += stats.threat.blockOpenFourMoves;
  s.ownFourMoves += stats.threat.ownFourMoves;
  s.blockFourMoves += stats.threat.blockFourMoves;
  s.openThreeDefenseMoves += stats.threat.openThreeDefenseMoves;
  s.rootForcedIncluded += stats.threat.rootForcedIncluded;
  s.rootForcedMissing += stats.threat.rootForcedMissing;
  s.rootForcedDropped += stats.threat.rootForcedDropped;
  s.internalForcedCalls += stats.threat.internalForcedCalls;
  s.tacticalNodes += stats.threat.tacticalNodes;
  s.quietNodes += stats.threat.quietNodes;

  s.dynamicChecks += stats.forbidden.dynamicChecks;
  s.dynamicForbiddenMoves += stats.forbidden.dynamicForbiddenMoves;
  s.dynamicSkippedWhite += stats.forbidden.dynamicSkippedWhite;
  s.dynamicSkippedDeep += stats.forbidden.dynamicSkippedDeep;
  s.dynamicSkippedDisabled += stats.forbidden.dynamicSkippedDisabled;
  s.forbiddenCacheHits += stats.forbidden.cacheHits;
  s.forbiddenCacheMisses += stats.forbidden.cacheMisses;
  s.forbiddenCacheEvictions += stats.forbidden.cacheEvictions;
  s.forbiddenCacheMaxSize = Math.max(
    s.forbiddenCacheMaxSize,
    stats.forbidden.cacheMaxSize
  );
  s.rootMoveRejectedByForbidden +=
    stats.forbidden.rootMoveRejectedByForbidden;
  s.forbiddenMismatch += stats.forbidden.mismatchWithStaticForbidden;

  s.vcfRootCalls += stats.vcf.rootCalls;
  s.vcfRootFound += stats.vcf.rootFound;
  s.vcfRootFail += stats.vcf.rootFail;
  s.vcfRootAborted += stats.vcf.rootAborted;
  s.vcfRootError += stats.vcf.rootError;
  s.vcfRootUsedAsFinalMove += stats.vcf.rootUsedAsFinalMove;
  s.vcfRootRejectedByForbidden += stats.vcf.rootRejectedByForbidden;
  s.vcfRootTimeMs += stats.vcf.rootTimeMs;
  s.vcfRootNodes += stats.vcf.rootNodes;
  s.vcfRootMaxPlyReached = Math.max(
    s.vcfRootMaxPlyReached,
    stats.vcf.rootMaxPlyReached
  );
  s.vcfRootDisabled += stats.vcf.rootDisabled;
  s.vcfRootSkippedEarlyGame += stats.vcf.rootSkippedEarlyGame;
  s.vcfRootSkippedLowTime += stats.vcf.rootSkippedLowTime;
  s.vcfRootSkippedLowDepth += stats.vcf.rootSkippedLowDepth;
  s.vcfRootSkippedByOption += stats.vcf.rootSkippedByOption;
  s.vcfRootImmediateWins += stats.vcf.rootImmediateWins;
  s.vcfRootTerminalOpenFours += stats.vcf.rootTerminalOpenFours;
  s.vcfRootDefenderCounterWins += stats.vcf.rootDefenderCounterWins;
  s.vcfRootIllegalBlockMoves += stats.vcf.rootIllegalBlockMoves;

  s.qsearchCalls += stats.qsearch.calls;
  s.qsearchWin += stats.qsearch.win;
  s.qsearchLoss += stats.qsearch.loss;
  s.qsearchUnknown += stats.qsearch.unknown;
  s.qsearchAbort += stats.qsearch.abort;
  s.qsearchError += stats.qsearch.error;
  s.qsearchFallback += stats.qsearch.fallback;
  s.qsearchTimeMs += stats.qsearch.timeMs;
  s.qsearchNodes += stats.qsearch.nodes;
  s.qsearchMaxPlyReached = Math.max(
    s.qsearchMaxPlyReached,
    stats.qsearch.maxPlyReached
  );
  s.qsearchBudgetExhausted += stats.qsearch.budgetExhausted;
  s.qsearchDisabled += stats.qsearch.disabled;
  s.qsearchSkippedEarlyGame += stats.qsearch.skippedEarlyGame;
  s.qsearchSkippedLowTime += stats.qsearch.skippedLowTime;
  s.qsearchSkippedLowDepth += stats.qsearch.skippedLowDepth;
  s.qsearchSkippedByOption += stats.qsearch.skippedByOption;
  s.qsearchCacheHits += stats.qsearch.cacheHits;
  s.qsearchCacheMisses += stats.qsearch.cacheMisses;
  s.qsearchForbiddenChecks += stats.qsearch.forbiddenChecks;
  s.qsearchForbiddenCacheHits += stats.qsearch.forbiddenCacheHits;
  s.qsearchForbiddenCacheMisses += stats.qsearch.forbiddenCacheMisses;
  s.qsearchAuditFails += stats.qsearch.auditFails;
};

// ============================================================
// 対局セッション: 派生指標
// ============================================================

/**
 * 対局終了時の推定総手数を計算する。
 *
 * 基本は最後に観測した AI 着手後の石数。
 * 人間の手で終わった場合は +1 して推定する。
 */
const estimateGameSessionTotalMoves = (s: GameSessionStats): number => {
  let totalMoves = s.lastObservedPlies;
  if (s.result === 'Loss') {
    totalMoves += 1;
  }
  if (s.result === 'Draw' && totalMoves < BOARD_SIZE * BOARD_SIZE) {
    totalMoves += 1;
  }
  return totalMoves;
};

/**
 * 対局セッションの派生指標を確定する。
 */
const finalizeGameSessionDerivedStats = (s: GameSessionStats): void => {
  s.totalMoves = estimateGameSessionTotalMoves(s);
  s.avgDepth = s.aiMoves > 0 ? s.completedDepthSum / s.aiMoves : 0;
  s.avgTimeMs = s.aiMoves > 0 ? s.elapsedSumMs / s.aiMoves : 0;
  s.ttHitRate = s.ttLookups > 0 ? s.ttHits / s.ttLookups : 0;
  s.aspirationFailTotal = s.aspirationFailHigh + s.aspirationFailLow;
  s.staticEvalCacheHitRate =
    s.staticEvalCacheLookups > 0
      ? s.staticEvalCacheHits / s.staticEvalCacheLookups
      : 0;
  s.adaptiveMedianRatioAvg =
    s.adaptivePredictionUsedCount > 0
      ? s.adaptiveMedianRatioSum / s.adaptivePredictionUsedCount
      : 0;

  if (!Number.isFinite(s.ttHitRate)) {
    s.ttHitRate = 0;
  }
  if (!Number.isFinite(s.staticEvalCacheHitRate)) {
    s.staticEvalCacheHitRate = 0;
  }
  if (!Number.isFinite(s.adaptiveMedianRatioAvg)) {
    s.adaptiveMedianRatioAvg = 0;
  }
};

// ============================================================
// 対局セッション: ログ出力
// ============================================================

/**
 * 対局セッション終了ログを出力する。
 *
 * - LOG_LEVEL = 'none'     : 出力しない
 * - LOG_LEVEL = 'summary'  : 1 行サマリのみ
 * - LOG_LEVEL = 'detailed' : サマリ + JSON
 * - ENABLE_DETAILED_JSON   : summary でも JSON を併記
 */
const logGameSessionSummary = (s: GameSessionStats): void => {
  if (!DIAGNOSTICS_CONFIG.ENABLE_STATS) return;
  if (DIAGNOSTICS_CONFIG.LOG_LEVEL === 'none') return;

  const aspWinAvg =
    s.aspirationAttempts > 0
      ? s.aspirationWindowSum / s.aspirationAttempts
      : 0;

  const abortRate = safeRate(s.abortCount, s.aiMoves, 1);
  const aspFailRate = safeRate(
    s.aspirationFailTotal,
    s.aspirationAttempts,
    1
  );

  const chkAvgUs = safeAvgUs(s.checkWinTimeMs, s.checkWinCalls);
  const leafAvgUs = safeAvgUs(s.leafEvalTimeMs, s.leafEvalCalls);
  const candAvgUs = safeAvgUs(
    s.candidateGenTimeMs,
    s.candidateGenCalls
  );
  const threatAvgUs = safeAvgUs(
    s.threatModelTimeMs,
    s.threatModelCalls
  );

  const forbiddenCacheCalls =
    s.forbiddenCacheHits + s.forbiddenCacheMisses;
  const forbiddenCacheHitRate = safeRate(
    s.forbiddenCacheHits,
    forbiddenCacheCalls,
    1
  );

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
    `ttSize=${s.ttLastNonZeroSize} ` +
    `aspFail=${s.aspirationFailTotal} ` +
    `pvsRS=${s.pvsFullResearches} ` +
    `rootPvsRS=${s.rootPvsResearches} ` +
    `lmrRed=${s.lmrReduced} ` +
    `candGenCalls=${s.candidateGenCalls} ` +
    `candGenTime=${Math.round(s.candidateGenTimeMs)}ms ` +
    `secLookups=${s.staticEvalCacheLookups} ` +
    `secHit=${(s.staticEvalCacheHitRate * 100).toFixed(1)}% ` +
    `ttCut=${s.ttCutoffs} ` +
    `ttBest=${s.ttBestMoveUsed} ` +
    `ttMax=${s.ttMaxSize} ` +
    `ttFinal=${s.ttActualFinalSize} ` +
    `pvsNull=${s.pvsNullSearches} ` +
    `pvsFH=${s.pvsFailHighResearches} ` +
    `pvsFL=${s.pvsFailLowResearches} ` +
    `pvsSkip=${s.pvsTacticalNullSkips} ` +
    `lmrRS=${s.lmrResearches} ` +
    `aspAttempts=${s.aspirationAttempts} ` +
    `aspWinAvg=${aspWinAvg.toFixed(1)} ` +
    `aspWinMax=${s.aspirationWindowMax} ` +
    `aspAdapt=${s.aspirationAdaptiveExpansions} ` +
    `aspNearOff=${s.aspirationDisabledNearWin} ` +
    `chk=${s.checkWinCalls} ` +
    `chkMs=${Math.round(s.checkWinTimeMs)} ` +
    `leafEval=${s.leafEvalCalls} ` +
    `leafMs=${Math.round(s.leafEvalTimeMs)} ` +
    `secStores=${s.staticEvalCacheStores} ` +
    `secMiss=${s.staticEvalCacheMisses} ` +
    `secEvict=${s.staticEvalCacheEvictions} ` +
    `secMax=${s.staticEvalCacheMaxSize} ` +
    `timeSkip=${s.timePredictedSkips} ` +
    `adpUsedMoves=${s.adaptivePredictionUsedCount} ` +
    `adpRatioAvg=${s.adaptiveMedianRatioAvg.toFixed(2)} ` +
    `abortRate=${abortRate}% ` +
    `aspFailRate=${aspFailRate}% ` +
    `chkAvgUs=${chkAvgUs} ` +
    `leafAvgUs=${leafAvgUs} ` +
    `candAvgUs=${candAvgUs} ` +
    `secHits=${s.staticEvalCacheHits} ` +
    `threatCalls=${s.threatModelCalls} ` +
    `threatAvgUs=${threatAvgUs} ` +
    `forced=${s.forcedMovesTotal} ` +
    `fw=${s.ownWinMoves} ` +
    `bfw=${s.blockWinMoves} ` +
    `fof=${s.ownOpenFourMoves} ` +
    `bfof=${s.blockOpenFourMoves} ` +
    `f4=${s.ownFourMoves} ` +
    `bf4=${s.blockFourMoves} ` +
    `rfInc=${s.rootForcedIncluded} ` +
    `rfMiss=${s.rootForcedMissing} ` +
    `rfDrop=${s.rootForcedDropped} ` +
    `tNodes=${s.tacticalNodes}/${s.quietNodes} ` +
    `dynFb=${s.dynamicForbiddenMoves} ` +
    `dynChk=${s.dynamicChecks} ` +
    `fbHit=${forbiddenCacheHitRate}% ` +
    `fbMis=${s.forbiddenMismatch} ` +
    `fbRej=${s.rootMoveRejectedByForbidden} ` +
    `vcfCalls=${s.vcfRootCalls} ` +
    `vcfFound=${s.vcfRootFound} ` +
    `vcfFail=${s.vcfRootFail} ` +
    `vcfAbort=${s.vcfRootAborted} ` +
    `vcfErr=${s.vcfRootError} ` +
    `vcfUsed=${s.vcfRootUsedAsFinalMove} ` +
    `vcfRej=${s.vcfRootRejectedByForbidden} ` +
    `vcfTime=${Math.round(s.vcfRootTimeMs)}ms ` +
    `vcfNodes=${s.vcfRootNodes} ` +
    `vcfPly=${s.vcfRootMaxPlyReached} ` +
    `vcfDis=${s.vcfRootDisabled} ` +
    `vcfSkipEarly=${s.vcfRootSkippedEarlyGame} ` +
    `vcfSkipTime=${s.vcfRootSkippedLowTime} ` +
    `vcfSkipDepth=${s.vcfRootSkippedLowDepth} ` +
    `vcfSkipOpt=${s.vcfRootSkippedByOption} ` +
    `vcfImm=${s.vcfRootImmediateWins} ` +
    `vcfTerm=${s.vcfRootTerminalOpenFours} ` +
    `vcfCnt=${s.vcfRootDefenderCounterWins} ` +
    `vcfBlkIll=${s.vcfRootIllegalBlockMoves} ` +
    `qsCalls=${s.qsearchCalls} ` +
    `qsWin=${s.qsearchWin} ` +
    `qsLoss=${s.qsearchLoss} ` +
    `qsUnk=${s.qsearchUnknown} ` +
    `qsAbort=${s.qsearchAbort} ` +
    `qsErr=${s.qsearchError} ` +
    `qsFall=${s.qsearchFallback} ` +
    `qsTime=${Math.round(s.qsearchTimeMs)}ms ` +
    `qsNodes=${s.qsearchNodes} ` +
    `qsPly=${s.qsearchMaxPlyReached} ` +
    `qsDis=${s.qsearchDisabled} ` +
    `qsBudget=${s.qsearchBudgetExhausted} ` +
    `qsAudit=${s.qsearchAuditFails}`;

  console.log(summary);

  const shouldOutputJson =
    DIAGNOSTICS_CONFIG.LOG_LEVEL === 'detailed' ||
    DIAGNOSTICS_CONFIG.ENABLE_DETAILED_JSON;

  if (shouldOutputJson) {
    console.log(JSON.stringify(s));
  }
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

  finalizeGameSessionDerivedStats(s);
  logGameSessionSummary(s);
};