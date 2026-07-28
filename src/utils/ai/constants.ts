// src/utils/ai/constants.ts
// AI探索・評価・キャッシュ・診断に関する定数とFeature Flagを定義する。
//
// 方針:
// - 探索強度・評価関数・Worker通信の意味を変えず、設定の責務を明確化する。
// - 本番機能 / 実験機能 / 診断機能 / inactive 設定をコメントで区別する。
// - Phase由来の命名は使用せず、現在の役割で管理する。

import type { AiLogLevel } from '../../types/ai';

// ============================================================
// 評価スコア
// ============================================================

/**
 * 戦術評価の基準スコア。
 * この値は探索の強さに直結するため、v2.0.0 では凍結扱い。
 */
export const AI_SCORES = {
  // 最優先事項
  WIN: 1_000_000,
  DEFEND_WIN: 500_000,

  // 必勝パターン
  OPEN_FOUR: 100_000,
  DOUBLE_FOUR: 90_000,
  FOUR_THREE: 90_000,

  // 強い脅威
  DOUBLE_THREE: 50_000,

  // 通常評価
  CLOSED_FOUR: 10_000,
  OPEN_THREE: 5_000,
  CLOSED_THREE: 500,
  OPEN_TWO: 100,
  CLOSED_TWO: 10,
  SINGLE: 1,
} as const;

// ============================================================
// Core Search Settings
// ============================================================

/**
 * 探索の中核パラメータ。
 * depth / time / search range / fallback candidate limit など。
 */
export const AI_CONFIG = {
  ATTACK_WEIGHT: 1.1,

  /** 候補手生成時の周辺探索距離 */
  SEARCH_RANGE: 2,

  /**
   * ミニマックス探索の基本深さ。
   * - timeLimitMs 未指定: 固定深度探索
   * - timeLimitMs 指定: 反復深化の上限深度
   */
  MINIMAX_DEPTH: 12,

  /**
   * 反復深化の既定時間制限 [ms]。
   * UIから difficulty / timeLimitMs を渡す場合の既定値として使う。
   */
  DEFAULT_TIME_LIMIT_MS: 1200,

  /**
   * 各ノードで探索する候補手の上限数。
   * 現在は candidateGenerator 側の局面依存制御が主で、これは fallback 基準値。
   */
  MAX_CANDIDATES: 15,
} as const;

// ============================================================
// Evaluation Settings
// ============================================================

/**
 * 全盤評価・形状ボーナスなどの評価関数設定。
 */
export const EVAL_CONFIG = {
  /**
   * evaluateBoard で集計する上位 K 手の数。
   * 多重脅威の評価に使う。
   */
  TOP_K: 3,

  /**
   * 2番手以降のスコアに掛ける減衰係数。
   */
  TOP_K_DECAY: 0.3,

  /**
   * 形状ボーナス: 近接自石1個あたりのボーナス。
   * 通常評価分支でのみ使用し、即時戦術スコアには影響しない。
   */
  SHAPE_BONUS_PER_STONE: 0.02,

  /** 形状ボーナスの絶対上限 */
  SHAPE_MAX_BONUS: 0.3,
} as const;

// ============================================================
// Transposition Table / Aspiration Base Settings
// ============================================================

export const TT_CONFIG = {
  /** 置換表の最大エントリ数 */
  MAX_ENTRIES: 200_000,

  /**
   * Aspiration Window の初期幅。
   * 現在、Aspiration Window 自体が master OFF のため、実運用では inactive。
   */
  ASPIRATION_WINDOW: 100,

  /** TT oldest eviction 時に削除する割合 */
  EVICTION_RATIO: 0.2,
} as const;

// ============================================================
// Core Production Feature Flags
// ============================================================

/**
 * 探索の中核機能群。
 * 原則として本番機能として安定化済みの Flag を置く。
 */
export const AI_FEATURES = {
  /** 戦術的候補手生成 */
  ENABLE_TACTICAL_CANDIDATES: true,

  /** Countermove Heuristic */
  ENABLE_COUNTERMOVE: true,

  /** Late Move Reduction */
  ENABLE_LMR: true,

  /** PVS / NegaScout */
  ENABLE_PVS: true,

  /** 差分ラインキャッシュ */
  ENABLE_LINE_CACHE: true,

  /** 候補集合の増分管理 */
  ENABLE_INCREMENTAL_CANDIDATES: true,

  /**
   * Aspiration Window の master flag。
   * 現在 OFF。有効化すると SEARCH_TUNING_FEATURES 側の設定が active になる。
   */
  ENABLE_ASPIRATION_WINDOW: false,

  /** TT 上限到達時の oldest eviction */
  ENABLE_TT_OLDEST_EVICTION: true,

  /** detectPattern のキャッシュ */
  ENABLE_PATTERN_CACHE: true,
} as const;

// ============================================================
// Candidate Generation Settings
// ============================================================

export const CANDIDATE_CONFIG = {
  /** ルートノードの候補手上限 */
  ROOT_MAX_CANDIDATES: 16,

  /** 静かな局面での通常ノード候補手上限 */
  DEFAULT_MAX_CANDIDATES: 12,

  /**
   * CRITICAL 手が存在する局面での候補手上限。
   * ただし CRITICAL 手自体はこの上限で切り捨てない。
   */
  TACTICAL_MAX_CANDIDATES: 10,

  /** Quiet 手のマージン剪定 */
  ENABLE_MARGIN_PRUNING: true,

  /** Quiet 手のマージン幅 */
  QUIET_SCORE_MARGIN: AI_SCORES.OPEN_THREE,
} as const;

// ============================================================
// LMR / PVS Settings
// ============================================================

export const LMR_CONFIG = {
  MIN_DEPTH: 3,
  MIN_MOVE_INDEX: 3,
  MAX_REDUCTION: 2,
  DEEP_REDUCTION_DEPTH: 6,
  DEEP_REDUCTION_MOVE_INDEX: 6,

  /** ルートノードでの LMR を許可するか */
  ALLOW_ROOT: false,
} as const;

export const PVS_CONFIG = {
  /**
   * ルートノードでの PVS を許可するか。
   * 既定では最善手安定性を重視して OFF。
   */
  ENABLE_ROOT_PVS: false,
} as const;

// ============================================================
// Diagnostics / Logging Settings
// ============================================================

/**
 * ログ・統計・診断出力の設定。
 * 探索の意思決定には一切使わない。
 */
export const DIAGNOSTICS_CONFIG: {
  LOG_LEVEL: AiLogLevel;
  ENABLE_STATS: boolean;
  ENABLE_DETAILED_JSON: boolean;
  ENABLE_VERBOSE_SEARCH_LOGS: boolean;
} = {
  LOG_LEVEL: 'summary',
  ENABLE_STATS: true,
  ENABLE_DETAILED_JSON: false,
  ENABLE_VERBOSE_SEARCH_LOGS: false,
};

// ============================================================
// Search Tuning Features
// ============================================================

/**
 * 探索効率・時間制御・Aspiration / PVS 調整などのチューニング群。
 *
 * 分類:
 * - Production: cache / candidate generation / time prediction
 * - Inactive: Aspiration 関連（master OFF）
 * - Experimental: PVS policy / conditional root PVS
 */
export const SEARCH_TUNING_FEATURES = {
  // --- Production: cache / generation ---

  /** 中心文字差し替え済みパターンキャッシュ */
  ENABLE_CENTER_PATTERN_CACHE: true,

  /** 候補手 tier 分類を bucket 方式で行う */
  ENABLE_TIER_BUCKET_GENERATION: true,

  /** TopK 挿入の固定長最適化 */
  ENABLE_TOPK_FIXED_ARRAY: true,

  /** 葉評価の Static Eval Cache */
  ENABLE_STATIC_EVAL_CACHE: true,

  /** 時間予測による反復深化の打ち切り */
  ENABLE_TIME_PREDICTION: true,

  // --- Inactive: Aspiration related ---
  // AI_FEATURES.ENABLE_ASPIRATION_WINDOW = false のため、以下は現在 inactive。

  /** Aspiration Window 幅の再調整 */
  ENABLE_ASPIRATION_WINDOW_TUNING: true,

  /** Aspiration Window の adaptive 拡張 */
  ENABLE_ASPIRATION_ADAPTIVE_EXPANSION: true,

  /** Aspiration Window を静かな局面でのみ使う */
  ENABLE_ASPIRATION_QUIET_ONLY: true,

  // --- Experimental: PVS policy ---

  /**
   * PVS null-window 抑制ポリシーを有効化する。
   * false の場合は baseline 挙動。
   */
  ENABLE_PVS_NULL_MODE_POLICY: false,

  /**
   * 条件付き root PVS。
   * 現在 OFF の実験機能。
   */
  ENABLE_CONDITIONAL_ROOT_PVS: false,
} as const;

export type PvsNullMode = 'baseline' | 'quiet_only' | 'off';

/**
 * Search tuning 用の詳細設定。
 */
export const SEARCH_TUNING_CONFIG: {
  CENTER_PATTERN_CACHE_LIMIT: number;
  STATIC_EVAL_CACHE_LIMIT: number;
  STATIC_EVAL_CACHE_EVICTION_RATIO: number;
  STATIC_EVAL_VERSION: bigint;

  /** inactive when ENABLE_ASPIRATION_WINDOW = false */
  ASPIRATION_WINDOW_OVERRIDE: number;

  /** inactive when ENABLE_ASPIRATION_WINDOW = false */
  ASPIRATION_ADAPTIVE_MAX_WINDOW: number;

  /** inactive when ENABLE_ASPIRATION_WINDOW = false */
  ASPIRATION_QUIET_THRESHOLD: number;

  /** used only when ENABLE_PVS_NULL_MODE_POLICY = true */
  PVS_NULL_MODE: PvsNullMode;

  TIME_PREDICTION_SAFETY: number;
  TIME_PREDICTION_MIN_DEPTH: number;

  /** used only when ENABLE_CONDITIONAL_ROOT_PVS = true */
  ROOT_PVS_MIN_DEPTH: number;
} = {
  CENTER_PATTERN_CACHE_LIMIT: 20_000,

  STATIC_EVAL_CACHE_LIMIT: 50_000,
  STATIC_EVAL_CACHE_EVICTION_RATIO: 0.2,

  /**
   * Static Eval Cache の世代。
   * 評価関数変更時はこの値を増やす。
   */
  STATIC_EVAL_VERSION: 2n,

  // Aspiration 関連は master OFF のため inactive。
  ASPIRATION_WINDOW_OVERRIDE: 200,
  ASPIRATION_ADAPTIVE_MAX_WINDOW: 800,
  ASPIRATION_QUIET_THRESHOLD: AI_SCORES.CLOSED_FOUR,

  // PVS null-mode policy が有効な場合のみ使用。
  PVS_NULL_MODE: 'quiet_only',

  TIME_PREDICTION_SAFETY: 1.6,
  TIME_PREDICTION_MIN_DEPTH: 3,

  // Conditional root PVS が有効な場合のみ使用。
  ROOT_PVS_MIN_DEPTH: 3,
};

// ============================================================
// Timing Diagnostics
// ============================================================

/**
 * 時間計測専用。
 * 探索結果や評価値には影響しない。
 */
export const TIMING_DIAGNOSTICS_CONFIG = {
  /** checkWin の時間計測 */
  ENABLE_CHECKWIN_TIMING: true,

  /** 葉評価の時間計測 */
  ENABLE_LEAF_TIMING: true,
} as const;

// ============================================================
// Threat Model / Forbidden Features
// ============================================================

/**
 * Threat Model / forced move list / 動的禁手の機能群。
 */
export const THREAT_FORBIDDEN_FEATURES = {
  // --- Production ---

  /** Threat Model を有効化 */
  ENABLE_THREAT_MODEL: true,

  /** forced move list 生成を有効化 */
  ENABLE_FORCED_MOVE_LIST: true,

  /**
   * root で必須 forced move が候補から欠落している場合、
   * 末尾へ追加して保護する。
   */
  ENABLE_ROOT_FORCED_PROTECTION: true,

  /** 限定動的禁手 */
  ENABLE_DYNAMIC_FORBIDDEN: true,

  /** root node で動的禁手を適用 */
  ENABLE_DYNAMIC_FORBIDDEN_ROOT: true,

  /** 動的禁手判定結果のキャッシュ */
  ENABLE_FORBIDDEN_CACHE: true,

  // --- Experimental / Inactive ---

  /**
   * forced move に基づく並び順変更。
   * 現在 OFF。
   */
  ENABLE_FORCED_ORDERING: false,

  /**
   * internal node で forced move list 生成。
   * 現在 OFF。
   */
  ENABLE_INTERNAL_FORCED_LIST: false,

  /**
   * OPEN_THREE_DEFENSE を forced move list に含める。
   * 現在 OFF。
   */
  ENABLE_OPEN_THREE_DEFENSE: false,

  /**
   * internal node で動的禁手を適用。
   * 現在 OFF。
   */
  ENABLE_DYNAMIC_FORBIDDEN_INTERNAL: false,

  // --- Debug ---

  /**
   * 状態管理の監査。
   * 開発時以外は OFF 推奨。
   */
  ENABLE_STATE_AUDIT: false,
} as const;

export const THREAT_FORBIDDEN_CONFIG = {
  /** root forced protection で追加を許容する手数 */
  ROOT_FORCED_EXTRA_CAPACITY: 2,

  /** internal forced move list を使う場合の最大残り深度 */
  INTERNAL_FORCED_MAX_DEPTH: 4,

  /** internal forced move list 生成時の候補手上限 */
  INTERNAL_FORCED_MAX_CANDIDATES: 32,

  /** internal 動的禁手を有効化した場合の最大残り深度 */
  DYNAMIC_FORBIDDEN_INTERNAL_MAX_DEPTH: 2,

  /** 禁手キャッシュの最大エントリ数 */
  FORBIDDEN_CACHE_LIMIT: 20_000,

  /** 禁手キャッシュ上限到達時の eviction 割合 */
  FORBIDDEN_CACHE_EVICTION_RATIO: 0.2,

  /** 禁手キャッシュ世代 */
  FORBIDDEN_CACHE_VERSION: 1n,

  /**
   * true の場合、SearchOptions.forbiddenRuleEnabled === true が明示されたときだけ
   * 動的禁手を有効化する。
   *
   * false の場合、undefined を禁手有効として扱う。
   */
  REQUIRE_EXPLICIT_FORBIDDEN_RULE: false,
} as const;

// ============================================================
// VCF Features
// ============================================================

/**
 * Root VCF 専用。
 */
export const VCF_FEATURES = {
  /** VCF 全体 master */
  ENABLE_VCF: true,

  /** Root VCF を有効化 */
  ENABLE_ROOT_VCF: true,

  /** VCF 内で LineCache を使用 */
  VCF_USE_LINE_CACHE: true,

  /** VCF 内で禁手キャッシュを使用 */
  VCF_USE_FORBIDDEN_CACHE: true,

  /** 防御側の即時勝ち反撃を確認 */
  VCF_CHECK_DEFENDER_COUNTER_WIN: true,

  /** 即時勝ちマスが2箇所以上の場合を受け不可として終端 */
  VCF_ALLOW_OPEN_FOUR_TERMINAL: true,

  /** VCF で勝ち証明できた場合、通常探索より優先して着手を返す */
  ENABLE_VCF_RETURN_ON_WIN: true,

  // --- Debug ---

  /** VCF 状態監査 */
  ENABLE_VCF_STATE_AUDIT: false,

  /** VCF 詳細ログ */
  ENABLE_VCF_VERBOSE_LOG: false,
} as const;

export const VCF_CONFIG = {
  /** VCF 世代 */
  VCF_VERSION: 1n,

  /** timeLimitMs に対する Root VCF 時間予算比率 */
  ROOT_VCF_TIME_BUDGET_RATIO: 0.05,

  /** Root VCF 時間予算の最小値 [ms] */
  ROOT_VCF_TIME_BUDGET_MIN_MS: 20,

  /** Root VCF 時間予算の最大値 [ms] */
  ROOT_VCF_TIME_BUDGET_MAX_MS: 80,

  /** timeLimitMs 未指定時の Root VCF 時間予算 [ms] */
  ROOT_VCF_FIXED_TIME_BUDGET_MS: 30,

  /** Root VCF のノード上限 */
  ROOT_VCF_NODE_LIMIT: 2000,

  /** Root VCF の最大 ply */
  ROOT_VCF_MAX_PLY: 20,

  /** timeLimitMs がこの値未満なら Root VCF を skip */
  ROOT_VCF_MIN_TIME_LIMIT_MS: 300,

  /** maxDepth がこの値未満なら Root VCF を skip */
  ROOT_VCF_MIN_MAX_DEPTH: 4,

  /** 盤面石数がこの値未満なら Root VCF を skip */
  ROOT_VCF_MIN_STONES: 5,

  /** VCF 禁手キャッシュの最大エントリ数 */
  VCF_FORBIDDEN_CACHE_LIMIT: 5000,

  /** VCF 禁手キャッシュ上限到達時の eviction 割合 */
  VCF_FORBIDDEN_CACHE_EVICTION_RATIO: 0.2,
} as const;

// ============================================================
// Quiescence Search Features
// ============================================================

/**
 * 戦術 Quiescence 専用。
 */
export const QSEARCH_FEATURES = {
  /** Quiescence 全体 master */
  ENABLE_QSEARCH: true,

  /** qsearch 結果キャッシュ */
  ENABLE_QSEARCH_CACHE: true,

  /** qsearch 禁手キャッシュ */
  ENABLE_QSEARCH_FORBIDDEN_CACHE: true,

  /** 負け証明を有効化 */
  ENABLE_QSEARCH_LOSS_PROOF: true,

  // --- Debug ---

  /** qsearch 状態監査 */
  ENABLE_QSEARCH_STATE_AUDIT: false,

  /** qsearch 詳細ログ */
  ENABLE_QSEARCH_VERBOSE_LOG: false,
} as const;

export const QSEARCH_CONFIG = {
  /** qsearch 世代 */
  QSEARCH_VERSION: 1n,

  /** qsearch 最大 ply */
  QSEARCH_MAX_PLY: 4,

  /** qsearch 1葉あたりノード上限 */
  QSEARCH_NODE_LIMIT_PER_LEAF: 32,

  /** qsearch 総ノード上限 */
  QSEARCH_TOTAL_NODE_LIMIT: 8000,

  /** timeLimitMs に対する qsearch 時間予算比率 */
  QSEARCH_TOTAL_TIME_RATIO: 0.05,

  /** qsearch 時間予算の最小値 [ms] */
  QSEARCH_TOTAL_TIME_MIN_MS: 20,

  /** qsearch 時間予算の最大値 [ms] */
  QSEARCH_TOTAL_TIME_MAX_MS: 80,

  /** timeLimitMs 未指定時の qsearch 時間予算 [ms] */
  QSEARCH_FIXED_TIME_BUDGET_MS: 30,

  /** timeLimitMs がこの値未満なら qsearch を skip */
  QSEARCH_MIN_TIME_LIMIT_MS: 300,

  /** 現在の反復深化深度がこの値未満なら qsearch を使わない */
  QSEARCH_MIN_ROOT_DEPTH: 4,

  /** 盤面石数がこの値未満なら qsearch を skip */
  QSEARCH_MIN_STONES: 5,

  /** 全体 deadline に対する安全マージン [ms] */
  QSEARCH_DEADLINE_SAFETY_MS: 5,

  /** qsearch 結果キャッシュの最大エントリ数 */
  QSEARCH_RESULT_CACHE_LIMIT: 5000,

  /** qsearch 禁手キャッシュの最大エントリ数 */
  QSEARCH_FORBIDDEN_CACHE_LIMIT: 5000,

  /** qsearch キャッシュ上限到達時の eviction 割合 */
  QSEARCH_CACHE_EVICTION_RATIO: 0.2,
} as const;

// ============================================================
// Evaluation Feature Flags
// ============================================================

/**
 * 評価関数そのものに影響する Feature Flag。
 */
export const EVALUATION_FEATURES = {
  /**
   * 形状ボーナスを有効化。
   * 通常評価分支でのみ使用し、即時戦術スコアには影響しない。
   */
  ENABLE_SHAPE_BONUS: true,
} as const;