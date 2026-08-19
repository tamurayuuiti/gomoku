// src/types/ai.ts
// AI 探索（utils/ai 配下）で共有される型定義をまとめるファイル。
//
// 配置方針:
//   - 盤面・進行状態とは責務が異なる探索内部の型をここに集約する。
//   - 単一ファイル内でのみ使う型は定義元に残す。
//   - ファクトリ関数・定数・スコア値はロジックのため定義元に残す。

import type { Position, Player, AiLevel } from './game';

// ============================================================
// パターン評価
// ============================================================

export type PatternType =
  | 'WIN'
  | 'OPEN_FOUR'
  | 'CLOSED_FOUR'
  | 'OPEN_THREE'
  | 'CLOSED_THREE'
  | 'OPEN_TWO'
  | 'CLOSED_TWO'
  | 'SINGLE';

/**
 * 8 種のパターンを固定インデックスで集計する数値配列。
 * インデックスは evaluator.ts の PATTERN_INDEX と対応し、
 * 長さは PATTERN_COUNT_SIZE（= 8）。
 */
export type PatternCount = number[];

// ============================================================
// Threat Model / forced move list
// ============================================================

/**
 * forced move の分類。
 * 既存の PatternType / AI_SCORES / CandidateFlags の意味は変更せず、
 * 着手の戦術的役割を表す追加分類として使う。
 */
export type ForcedCategory =
  | 'OWN_WIN'
  | 'BLOCK_WIN'
  | 'OWN_OPEN_FOUR'
  | 'BLOCK_OPEN_FOUR'
  | 'OWN_FOUR'
  | 'BLOCK_FOUR'
  | 'OPEN_THREE_DEFENSE'
  | 'NONE';

/**
 * 1つの forced move を表す。
 * 1手が複数のカテゴリに該当することがある。
 */
export interface ForcedMove {
  pos: Position;
  categories: ForcedCategory[];
  priority: ForcedCategory;
  legal: boolean;
  forbiddenChecked: boolean;
}

/**
 * forced move list 全体の結果。
 * generatedAtHash は将来のキャッシュ / 診断用キーとして保持する。
 */
export interface ForcedMoveList {
  moves: ForcedMove[];
  byCategory: Record<ForcedCategory, Position[]>;
  hasOwnWin: boolean;
  hasBlockWin: boolean;
  hasOwnOpenFour: boolean;
  hasBlockOpenFour: boolean;
  hasOwnFour: boolean;
  hasBlockFour: boolean;
  maxPriority: ForcedCategory | null;
  nodeKind: 'tactical' | 'quiet';
  generatedAtHash: bigint;
}

// ============================================================
// 探索オプション
// ============================================================

export interface SearchOptions {
  /** 探索深さの上書き。未指定時は AI_CONFIG.MINIMAX_DEPTH */
  depth?: number;
  /**
   * 探索時間上限 [ms]。
   * 指定時は反復深化を行い、制限時間内に完了した最後の深さの結果を採用する。
   */
  timeLimitMs?: number;
  /**
   * 直前手。
   * Countermove Heuristic のルート精度を上げたい場合に渡す。
   */
  lastMove?: Position | null;
  /**
   * 禁手ルールが有効かどうか。
   * false の場合は動的禁手を明示的に無効化する。
   */
  forbiddenRuleEnabled?: boolean;
  /** Root VCF を明示的に有効 / 無効化する */
  vcfEnabled?: boolean;
  /** Root VCF 時間予算 [ms] */
  vcfTimeBudgetMs?: number;
  /** Root VCF ノード上限 */
  vcfNodeLimit?: number;
  /** 戦術 Quiescence を明示的に有効 / 無効化する */
  qsearchEnabled?: boolean;
  /** Quiescence 最大 ply */
  qsearchMaxPly?: number;
  /** Quiescence 1葉あたりノード上限 */
  qsearchNodeLimitPerLeaf?: number;
  /** Quiescence 総ノード上限 */
  qsearchTotalNodeLimit?: number;
  /** Quiescence 時間予算 [ms] */
  qsearchTimeBudgetMs?: number;
  /** AI レベル（診断用）*/
  aiLevel?: AiLevel | null;
}

// ============================================================
// 候補手
// ============================================================

/**
 * evaluatePosition の結果を保持したまま候補手を表す型。
 * 同一候補への再計算を避けるために使う。
 */
export interface ScoredPosition {
  pos: Position;
  score: number;
}

/**
 * 候補手の戦術的性質・ordering 属性を表すフラグ。
 * LMR / PVS / 候補手絞り込みで使用する。
 */
export interface CandidateFlags {
  /** Transposition Table に登録されていた最善手 */
  isTTMove: boolean;
  /** killer heuristic に登録されていた手 */
  isKiller: boolean;
  /** countermove heuristic に登録されていた手 */
  isCountermove: boolean;
  /**
   * 戦術的に最重要の手。
   * WIN / DEFEND_WIN / OPEN_FOUR / DOUBLE_FOUR / FOUR_THREE / DOUBLE_THREE 相当。
   */
  isCritical: boolean;
  /**
   * 戦術手として LMR 除外対象にする手。
   * isCritical に加え、CLOSED_FOUR 以上の明確な脅威を含む。
   */
  isTactical: boolean;
  /** 静かな手。LMR 適用候補 */
  isQuiet: boolean;
  /** LMR を適用してよいか */
  reductionAllowed: boolean;
  /** forced move list に含まれる手 */
  isForced?: boolean;
  /** forced move 内の最高優先度 */
  forcedPriority?: ForcedCategory | null;
  /** forced move カテゴリ一覧 */
  forcedCategories?: ForcedCategory[];
}

/**
 * 候補手生成の結果を表す型。
 * ScoredPosition に探索制御用フラグを付与する。
 */
export interface OrderedCandidate extends ScoredPosition {
  flags: CandidateFlags;
}

// ============================================================
// Killer heuristic
// ============================================================

/** 深さ 1 レベルの killer スロット（最新 / 次点） */
export type KillerEntry = [Position | null, Position | null];
/** killer table 本体。インデックスが深さに対応する */
export type KillerTable = KillerEntry[];

// ============================================================
// History heuristic
// ============================================================

/**
 * history heuristic 用のスコアテーブル。
 * historyTable[player][row][col] にカットオフ貢献度を累積する。
 */
export type HistoryTable = Record<Player, number[][]>;

// ============================================================
// Countermove heuristic
// ============================================================

/**
 * countermove heuristic 用テーブル。
 * table[player][lastMoveIndex] = lastMove に対してカットオフを起こした応手。
 * lastMoveIndex = row * BOARD_SIZE + col で平坦化する。
 */
export type CountermoveTable = Record<Player, (Position | null)[]>;

// ============================================================
// Transposition Table
// ============================================================

/**
 * TT エントリの種別。
 * - EXACT: 正確なスコア
 * - LOWERBOUND: 下限値
 * - UPPERBOUND: 上限値
 */
export type TTFlag = 'EXACT' | 'LOWERBOUND' | 'UPPERBOUND';

// ============================================================
// LineCache
// ============================================================

/**
 * 1方向分のラインキャッシュ。
 * [row][col] に 3 進整数エンコードされたラインコード（0〜19682）を保持する。
 */
export type LineCacheDirectionCache = number[][];

/**
 * ある手番視点の全方向ラインキャッシュ。
 * DIRECTIONS の順に 4 要素持つ。
 */
export type LineCachePerspective = LineCacheDirectionCache[];

/**
 * 盤面全体のラインキャッシュ。
 * Black 視点・White 視点の両方を保持する。
 */
export interface LineCacheState {
  caches: Record<Player, LineCachePerspective>;
}

/**
 * LineCache 差分更新の undo 情報。
 * 着手前の空マス状態へ戻すため、着手位置と手番のみで十分。
 */
export interface LineCacheUndo {
  row: number;
  col: number;
  player: Player;
}

// ============================================================
// CandidateSet
// ============================================================

/**
 * CandidateSet の差分更新で影響を受けたセルの旧状態。
 */
export interface CandidateSetChange {
  /** row * BOARD_SIZE + col */
  index: number;
  /** 更新前の近接石カウント */
  oldRefCount: number;
  /** 更新前に候補集合に含まれていたか */
  oldIsCandidate: boolean;
}

/**
 * CandidateSet の undo 情報。
 */
export interface CandidateSetUndo {
  affected: CandidateSetChange[];
}

/**
 * 候補集合の増分管理状態。
 *
 * - candidates: 候補マスの flat index 集合
 * - isCandidate: 候補かどうかの高速参照用マップ
 * - refCount: 各空マスについて、SEARCH_RANGE 内にある石の数
 */
export interface CandidateSetState {
  candidates: Set<number>;
  isCandidate: boolean[][];
  refCount: number[][];
}

// ============================================================
// 統計・ログ用型
// ============================================================

/** 診断ログの出力レベル */
export type AiLogLevel = 'none' | 'summary' | 'detailed';

/** 思考モード */
export type SearchMode = 'center' | 'fixed' | 'iterative';

/** 時間関連の統計 */
export interface SearchTimeStats {
  /** 思考時間 [ms] */
  elapsedMs: number;
  /** 時間制限 [ms]。固定深度探索では null */
  limitMs: number | null;
  /** 時間切れ等で探索が中断されたか */
  aborted: boolean;
  /** 直近の反復深化 1 回の所要時間 [ms] */
  lastIterationMs: number;
  /** 時間予測により次の深度をスキップした回数 */
  predictedSkips: number;
  /** 時間予測で打ち切ったときの残り時間 [ms] */
  remainingAtSkipMs: number;
  /** adaptive 時間予測が使用されたか */
  adaptivePredictionUsed: boolean;
  /** adaptive 予測が算出した推定時間（診断用） [ms] */
  adaptiveEstimateMs: number;
  /** 比率計算に使用したサンプル数 */
  adaptiveRatioSamples: number;
  /** 採用された推定比率（診断用） */
  adaptiveMedianRatio: number;
}

/** ノード関連の統計 */
export interface SearchNodeStats {
  /** 探索ノード総数 */
  total: number;
  /** 内部ノード数（TT カットオフを含む） */
  internal: number;
  /** 葉ノード数（静的評価で終了したノード） */
  leaf: number;
  /** TT カットオフ回数 */
  ttCutoff: number;
  /** 即時勝利検出回数 */
  immediateWin: number;
  /** 即時負け検出回数 */
  immediateLoss: number;
}

/** TT 関連の統計 */
export interface SearchTTStats {
  /** TT 参照試行回数 */
  lookups: number;
  /** TT hit 回数 */
  hits: number;
  /** hit / lookups */
  hitRate: number;
  /** 保存回数 */
  stores: number;
  /** EXACT 保存数 */
  storesExact: number;
  /** LOWERBOUND 保存数 */
  storesLower: number;
  /** UPPERBOUND 保存数 */
  storesUpper: number;
  /** 既存エントリが深かったため保存を見送った回数 */
  storesRejectedShallow: number;
  /** TT から bestMove を取得した回数 */
  bestMoveProvided: number;
  /** TT Move が候補手 tier に実際に含まれた回数 */
  bestMoveUsed: number;
  /** 異なるキーによる上書きが発生した回数 */
  evictions: number;
  /** 最大サイズ */
  maxSize: number;
  /** 最終サイズ */
  finalSize: number;
}

/** PVS 関連の統計 */
export interface SearchPvsStats {
  /** null-window 探索回数 */
  nullSearches: number;
  /** 最大化側 fail-high 再探索回数 */
  failHighResearches: number;
  /** 最小化側 fail-low 再探索回数 */
  failLowResearches: number;
  /** full window 再探索回数 */
  fullResearches: number;
  /** ルート PVS null 探索回数 */
  rootNullSearches: number;
  /** PVS null-window を抑制した回数 */
  tacticalNullSkips: number;
  /** quiet 手で PVS null-window を使った回数 */
  quietNullSearches: number;
  /** ルート PVS fail-high 再探索回数 */
  rootFailHighResearches: number;
}

/** LMR 関連の統計 */
export interface SearchLmrStats {
  /** LMR 判定が行われた回数 */
  attempted: number;
  /** 実際に削減された回数 */
  reduced: number;
  /** 削減された深度の合計 */
  reductionTotal: number;
  /** 削減後の再探索回数 */
  researches: number;
  /** 戦術手としてスキップした回数 */
  skippedTactical: number;
  /** Killer のためスキップした回数 */
  skippedKiller: number;
  /** Countermove のためスキップした回数 */
  skippedCountermove: number;
  /** TT Move のためスキップした回数 */
  skippedTTMove: number;
}

/** Aspiration Window 関連の統計 */
export interface SearchAspirationStats {
  /** Aspiration 適用回数 */
  attempts: number;
  /** fail-high 回数 */
  failHigh: number;
  /** fail-low 回数 */
  failLow: number;
  /** full window 再探索回数 */
  fullResearches: number;
  /** 使用した窓幅の合計 */
  windowSum: number;
  /** 使用した窓幅の最大値 */
  windowMax: number;
  /** adaptive 拡張が発生した回数 */
  adaptiveExpansions: number;
  /** WIN / LOSS 付近のため Aspiration を無効化した回数 */
  disabledNearWin: number;
}

/** 候補手生成関連の統計 */
export interface SearchCandidateStats {
  /** 候補手生成呼び出し回数 */
  genCalls: number;
  /** 実際に探索へ渡した候補手の総数 */
  selectedTotal: number;
  /** 1ノードあたり平均候補手数 */
  avgPerNode: number;
  /** 最大候補手数 */
  maxPerNode: number;
  /** CRITICAL 候補の総数 */
  criticalTotal: number;
  /** Quiet 候補の総数 */
  quietTotal: number;
  /** Quiet 剪定で捨てた数 */
  quietPrunedTotal: number;
  /** 候補手生成時間合計 [ms] */
  genTimeMs: number;
}

/** Move ordering 関連の統計 */
export interface SearchOrderingStats {
  /** TT Move が候補 tier に上がった回数 */
  ttBestMoveUsed: number;
  /** Killer が候補 tier に上がった回数 */
  killerHits: number;
  /** Killer 保存回数 */
  killerStores: number;
  /** Countermove が候補 tier に上がった回数 */
  countermoveHits: number;
  /** Countermove 保存回数 */
  countermoveStores: number;
  /** History 保存回数 */
  historyStores: number;
}

/** LineCache 関連の統計 */
export interface SearchCacheStats {
  lineCacheUpdates: number;
  lineCacheUndos: number;
  lineCacheEvalCalls: number;
  lineCacheFallbackCalls: number;
}

/** CandidateSet 関連の統計 */
export interface SearchCandidateSetStats {
  /** CandidateSet が使われたか */
  used: boolean;
  /** 増分更新回数 */
  updates: number;
  /** 復元回数 */
  undos: number;
  /** 最大候補集合サイズ */
  maxSize: number;
  /** 平均候補集合サイズ */
  avgSize: number;
  /** 平均計算用のサイズ合計 */
  sizeSum: number;
  /** 平均計算用のサンプル数 */
  sizeSamples: number;
}

/** 診断用統計 */
export interface SearchDiagnosticsStats {
  /** checkWin 呼び出し回数 */
  checkWinCalls: number;
  /** checkWin 時間合計 [ms] */
  checkWinTimeMs: number;
  /** 葉評価実行回数 */
  leafEvalCalls: number;
  /** 葉評価時間合計 [ms] */
  leafEvalTimeMs: number;
  /**
   * Packed Integer 評価が有効かどうか。
   * 診断専用であり、探索ロジックの分岐条件として使用してはならない。
   */
  packedEvalEnabled: boolean;
}

/** Static Eval Cache 統計 */
export interface SearchStaticEvalCacheStats {
  /** キャッシュ参照回数 */
  lookups: number;
  /** キャッシュヒット回数 */
  hits: number;
  /** キャッシュミス回数 */
  misses: number;
  /** 新規保存回数 */
  stores: number;
  /** 異なるキーによる上書きが発生した回数 */
  evictions: number;
  /** 現在のサイズ */
  size: number;
  /** 最大サイズ */
  maxSize: number;
  /** hit / lookups */
  hitRate: number;
}

/** Threat Model / forced move list 統計 */
export interface SearchThreatStats {
  /** Threat Model / forced move list 生成呼び出し回数 */
  modelCalls: number;
  /** Threat Model / forced move list 生成時間合計 [ms] */
  modelTimeMs: number;
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
}

/** 限定動的禁手統計 */
export interface SearchForbiddenStats {
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
  cacheHits: number;
  /** 禁手キャッシュ miss 回数 */
  cacheMisses: number;
  /** 禁手キャッシュ eviction 回数 */
  cacheEvictions: number;
  /** 禁手キャッシュ現在サイズ */
  cacheSize: number;
  /** 禁手キャッシュ最大サイズ */
  cacheMaxSize: number;
  /** root 最終着手が禁手と判定され、フォールバックした回数 */
  rootMoveRejectedByForbidden: number;
  /** 静的 forbiddenMoves では合法だが動的禁手で禁手となった回数 */
  mismatchWithStaticForbidden: number;
  /** 動的禁手の前提として禁手ルールが有効と解決されたか */
  forbiddenRuleEnabled: boolean;
}

/** Root VCF 統計 */
export interface SearchVcfStats {
  /** Root VCF 呼び出し回数 */
  rootCalls: number;
  /** flag により無効化された回数 */
  rootDisabled: number;
  /** 序盤のため skip した回数 */
  rootSkippedEarlyGame: number;
  /** 時間制限が短いため skip した回数 */
  rootSkippedLowTime: number;
  /** maxDepth が短いため skip した回数 */
  rootSkippedLowDepth: number;
  /** option / budget により skip した回数 */
  rootSkippedByOption: number;
  /** VCF 勝ち証明に成功した回数 */
  rootFound: number;
  /** VCF が証明不能として失敗した回数 */
  rootFail: number;
  /** VCF が budget / node limit で中断した回数 */
  rootAborted: number;
  /** VCF が例外で終了した回数 */
  rootError: number;
  /** VCF 結果が最終手として採用された回数 */
  rootUsedAsFinalMove: number;
  /** VCF 結果が最終検証で禁手 / 不正として棄却された回数 */
  rootRejectedByForbidden: number;
  /** VCF 探索ノード数 */
  rootNodes: number;
  /** VCF で到達した最大 ply */
  rootMaxPlyReached: number;
  /** VCF 時間合計 [ms] */
  rootTimeMs: number;
  /** VCF 時間予算 [ms] */
  rootBudgetMs: number;
  /** VCF 内で即時勝ちを検出した回数 */
  rootImmediateWins: number;
  /** VCF 内で受け不可な四を終端とした回数 */
  rootTerminalOpenFours: number;
  /** VCF 内で防御側即時勝ちにより攻撃枝を失敗とした回数 */
  rootDefenderCounterWins: number;
  /** VCF 内で防御側がブロックできず勝ちとした回数 */
  rootIllegalBlockMoves: number;
  /** VCF 用禁手判定呼び出し回数 */
  rootForbiddenChecks: number;
  /** VCF 用禁手キャッシュ hit 回数 */
  rootForbiddenCacheHits: number;
  /** VCF 用禁手キャッシュ miss 回数 */
  rootForbiddenCacheMisses: number;
}

/** 戦術 Quiescence 統計 */
export interface SearchQSearchStats {
  /** qsearch 葉呼び出し回数 */
  calls: number;
  /** flag により無効化された回数 */
  disabled: number;
  /** 序盤石数不足で skip した回数 */
  skippedEarlyGame: number;
  /** 時間制限不足で skip した回数 */
  skippedLowTime: number;
  /** 低深度で skip した回数 */
  skippedLowDepth: number;
  /** option / budget により skip した回数 */
  skippedByOption: number;
  /** 予算切れで fallback した回数 */
  budgetExhausted: number;
  /** qsearch 探索ノード数 */
  nodes: number;
  /** qsearch 時間合計 [ms] */
  timeMs: number;
  /** qsearch 時間予算 [ms] */
  budgetMs: number;
  /** 勝ち証明回数 */
  win: number;
  /** 負け証明回数 */
  loss: number;
  /** 不明回数 */
  unknown: number;
  /** 中断回数 */
  abort: number;
  /** エラー回数 */
  error: number;
  /** 静的評価へ fallback した回数 */
  fallback: number;
  /** 最大到達 ply */
  maxPlyReached: number;
  /** 即時勝ち検出回数 */
  immediateWins: number;
  /** 受け不可な四終端回数 */
  terminalOpenFours: number;
  /** ブロック不能回数 */
  illegalBlocks: number;
  /** 防御側即時勝ち反撃回数 */
  defenderCounterWins: number;
  /** 禁手判定呼び出し回数 */
  forbiddenChecks: number;
  /** 禁手キャッシュ hit 回数 */
  forbiddenCacheHits: number;
  /** 禁手キャッシュ miss 回数 */
  forbiddenCacheMisses: number;
  /** 禁手キャッシュ eviction 回数 */
  forbiddenCacheEvictions: number;
  /** 禁手キャッシュ現在サイズ */
  forbiddenCacheSize: number;
  /** 禁手キャッシュ最大サイズ */
  forbiddenCacheMaxSize: number;
  /** 結果キャッシュ hit 回数 */
  cacheHits: number;
  /** 結果キャッシュ miss 回数 */
  cacheMisses: number;
  /** 結果キャッシュ eviction 回数 */
  cacheEvictions: number;
  /** 結果キャッシュ現在サイズ */
  cacheSize: number;
  /** 結果キャッシュ最大サイズ */
  cacheMaxSize: number;
  /** 結果キャッシュ hit 率 */
  cacheHitRate: number;
  /** 禁手キャッシュ hit 率 */
  forbiddenCacheHitRate: number;
  /** state audit 失敗回数 */
  auditFails: number;
}

/**
 * 1回の calculateNextMove 呼び出し単位で集計する統計情報。
 * 統計値は探索の意思決定には使用しない。
 */
export interface SearchStats {
  /** 統計スキーマバージョン */
  schemaVersion: number;
  /** 手番 */
  turn: Player | null;
  /** 思考モード */
  searchMode: SearchMode;
  /** AI レベル（診断用。探索挙動には影響しない） */
  aiLevel: AiLevel | null;
  /** 最終的に選んだ手 */
  selectedMove: Position | null;
  /** 最終スコア */
  selectedScore: number | null;
  /** 入力された直前手 */
  lastMove: Position | null;
  /** 設定上の最大深度 */
  maxDepth: number;
  /** 完了した反復深化深度 */
  completedDepth: number;
  /** 時間統計 */
  time: SearchTimeStats;
  /** ノード統計 */
  nodes: SearchNodeStats;
  /** TT 統計 */
  tt: SearchTTStats;
  /** PVS 統計 */
  pvs: SearchPvsStats;
  /** LMR 統計 */
  lmr: SearchLmrStats;
  /** Aspiration 統計 */
  aspiration: SearchAspirationStats;
  /** 候補手生成統計 */
  candidates: SearchCandidateStats;
  /** ordering 統計 */
  ordering: SearchOrderingStats;
  /** cache 統計 */
  cache: SearchCacheStats;
  /** CandidateSet 統計 */
  candidateSet: SearchCandidateSetStats;
  /** 診断統計 */
  diagnostics: SearchDiagnosticsStats;
  /** Static Eval Cache 統計 */
  staticEvalCache: SearchStaticEvalCacheStats;
  /** Threat Model / forced move list 統計 */
  threat: SearchThreatStats;
  /** 限定動的禁手統計 */
  forbidden: SearchForbiddenStats;
  /** Root VCF 統計 */
  vcf: SearchVcfStats;
  /** 戦術 Quiescence 統計 */
  qsearch: SearchQSearchStats;
}