// src/utils/ai/constants.ts
// AI 探索・評価・キャッシュ・チューニングに関する定数と Feature Flag を定義する。
//
// 方針:
//   - 探索強度・評価関数・Worker 通信の意味を変えず、設定の責務を明確化する。
//   - 本番機能 / 実験機能 / inactive 設定をコメントで区別する。
//   - 診断・デバッグ専用設定は diagnosticsFlags.ts に移動済み。
//   - constants.ts からは診断設定を参照・再 export しない。

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
// 探索基本設定
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
   * UI から difficulty / timeLimitMs を渡す場合の既定値として使う。
   */
  DEFAULT_TIME_LIMIT_MS: 1200,

  /**
   * 各ノードで探索する候補手の上限数。
   * 現在は candidateGenerator 側の局面依存制御が主で、これは fallback 基準値。
   */
  MAX_CANDIDATES: 15,
} as const;

// ============================================================
// 評価設定
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
   * 盤面集約の K 拡大時に使用する上位 K 手の数。
   * ENABLE_ENHANCED_TOP_K が有効な場合のみ参照される。
   */
  TOP_K_ENHANCED: 5,

  /**
   * 盤面集約の K 拡大時に使用する減衰係数。
   * ENABLE_ENHANCED_TOP_K が有効な場合のみ参照される。
   */
  TOP_K_DECAY_ENHANCED: 0.3,

  /**
   * 形状ボーナス: 近接自石 1 個あたりのボーナス。
   * 通常評価分支でのみ使用し、即時戦術スコアには影響しない。
   */
  SHAPE_BONUS_PER_STONE: 0.02,

  /** 形状ボーナスの絶対上限 */
  SHAPE_MAX_BONUS: 0.3,

  /**
   * 中央近接ボーナスの最大値。
   * 二次減衰（(1 - d/D)^2）で盤中心に最大、盤端で 0 となる。
   * SINGLE（1）の 1/20 に抑え、素点が異なる候補の順位を逆転させない。
   */
  POSITION_BONUS_MAX: 0.05,

  /**
   * 形状ボーナス: 距離1（隣接）の近接自石 1 個あたりのボーナス。
   * 隣接による接続は距離2よりも戦術的価値が高いため、大きな重みを付ける。
   */
  SHAPE_BONUS_PER_STONE_DIST1: 0.15,

  /**
   * 形状ボーナス: 距離2（1マス空き）の近接自石 1 個あたりのボーナス。
   * 距離1の約半分に減衰し、緩やかな関係の価値を反映する。
   */
  SHAPE_BONUS_PER_STONE_DIST2: 0.08,

  /** 形状ボーナスの絶対上限 */
  SHAPE_MAX_BONUS_ENHANCED: 1.5,

  /**
   * 脅威密度ボーナスの係数。
   * 盤面全体の中小脅威の累積価値を補助的に加算する。
   * ENABLE_THREAT_DENSITY が有効な場合のみ参照される。
   */
  THREAT_DENSITY_COEFFICIENT: 0.01,

  /**
   * 脅威密度ボーナスの絶対上限。
   * CLOSED_TWO（10）の 50% に抑え、戦術判断を歪めない。
   */
  THREAT_DENSITY_MAX: 5.0,

  /**
   * 脅威密度の集計対象とする最低セルスコア。
   * この値未満のスコアは集計から除外する。
   */
  THREAT_DENSITY_THRESHOLD: AI_SCORES.SINGLE,

  /**
   * 脅威密度の集計から除外するセルスコアの閾値。
   * 即時評価（DOUBLE_THREE 以上）のセルは脅威密度に含めない。
   */
  THREAT_DENSITY_EXCLUDE_THRESHOLD: AI_SCORES.DOUBLE_THREE,

  /**
   * 攻守分離集約時の攻撃側重み。
   * ENABLE_BALANCED_AGGREGATION が有効な場合のみ参照される。
   */
  ATTACK_AGG_WEIGHT: 1.0,

  /**
   * 攻守分離集約時の防御側重み。
   * ENABLE_BALANCED_AGGREGATION が有効な場合のみ参照される。
   */
  DEFENSE_AGG_WEIGHT: 1.0,

  /**
   * 攻守分離集約時の攻撃 Top-K 減衰係数。
   * ENABLE_BALANCED_AGGREGATION が有効な場合のみ参照される。
   */
  ATTACK_TOP_K_DECAY: 0.3,

  /**
   * 攻守分離集約時の防御 Top-K 減衰係数。
   * ENABLE_BALANCED_AGGREGATION が有効な場合のみ参照される。
   */
  DEFENSE_TOP_K_DECAY: 0.3,
} as const;

// ============================================================
// Transposition Table / Aspiration 基本設定
// ============================================================

export const TT_CONFIG = {
  /**
   * Aspiration Window の初期幅。
   * 現在、Aspiration Window 自体が master OFF のため、実運用では inactive。
   */
  ASPIRATION_WINDOW: 100,
} as const;

/**
 * TranspositionTable の固定テーブルサイズ（2^18 = 262,144）。
 * 最大 200,000 エントリを保持できる 2 の累乗として設定している。
 * 直接マッピング方式のハッシュテーブルとして使用するため、
 * 2 の累乗であることでインデックス計算をビット AND に限定できる。
 */
export const TT_TABLE_SIZE = 262_144;

// ============================================================
// 本番 Feature Flags
// ============================================================

/**
 * 探索の中核機能群。
 * 原則として本番機能として安定化済みの Flag を置く。
 * v2.0.0 では以下の値を固定扱いとする。
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
   * 現在 OFF（inactive / v2.0.0 固定）。
   * 有効化すると SEARCH_TUNING_FEATURES 側の Aspiration 関連設定が active になる。
   */
  ENABLE_ASPIRATION_WINDOW: false,
} as const;

// ============================================================
// 候補手生成設定
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

  /**
   * refCount 事前フィルタを有効化。
   * 有効時、CandidateSet 上の refCount が閾値未満の候補を探索対象から除外する。
   * root ノードでは適用しない。
   */
  ENABLE_REFCOUNT_PREFILTER: false,

  /** refCount 事前フィルタの閾値。この値未満の refCount を持つ候補を除外する */
  REFCOUNT_PREFILTER_MIN: 2,
} as const;

// ============================================================
// LMR / PVS 設定
// ============================================================

export const LMR_CONFIG = {
  MIN_DEPTH: 3,
  MIN_MOVE_INDEX: 3,
  MAX_REDUCTION: 2,
  DEEP_REDUCTION_DEPTH: 6,
  DEEP_REDUCTION_MOVE_INDEX: 6,
  /** ルートノードでの LMR を許可するか（v2.0.0 固定） */
  ALLOW_ROOT: false,
} as const;

export const PVS_CONFIG = {
  /**
   * ルートノードでの PVS を許可するか。
   * 既定では最善手安定性を重視して OFF（v2.0.0 固定）。
   */
  ENABLE_ROOT_PVS: false,
} as const;

// ============================================================
// 探索チューニング Flags
// ============================================================

/**
 * 探索効率・時間制御・Aspiration / PVS 調整などのチューニング群。
 *
 * 分類:
 * - Production: cache / candidate generation / time prediction（v2.0.0 固定）
 * - Inactive: Aspiration 関連（master flag AI_FEATURES.ENABLE_ASPIRATION_WINDOW = false に依存）
 * - Experimental: PVS policy / conditional root PVS（OFF / v2.0.0 固定）
 */
export const SEARCH_TUNING_FEATURES = {
  // --- Production: cache / generation ---

  /** 候補手 tier 分類を bucket 方式で行う */
  ENABLE_TIER_BUCKET_GENERATION: true,

  /** 葉評価の Static Eval Cache */
  ENABLE_STATIC_EVAL_CACHE: true,

  /** 時間予測による反復深化の打ち切り */
  ENABLE_TIME_PREDICTION: true,

  // --- Inactive: Aspiration related ---
  // master flag AI_FEATURES.ENABLE_ASPIRATION_WINDOW = false のため、以下は現在 inactive。
  // v2.0.0 では固定扱い。

  /** Aspiration Window 幅の再調整（inactive / master flag 依存） */
  ENABLE_ASPIRATION_WINDOW_TUNING: true,

  /** Aspiration Window の adaptive 拡張（inactive / master flag 依存） */
  ENABLE_ASPIRATION_ADAPTIVE_EXPANSION: true,

  /** Aspiration Window を静かな局面でのみ使う（inactive / master flag 依存） */
  ENABLE_ASPIRATION_QUIET_ONLY: true,

  // --- Experimental: PVS policy ---

  /**
   * PVS null-window 抑制ポリシーを有効化する。
   * false の場合は baseline 挙動（experimental / OFF / v2.0.0 固定）。
   */
  ENABLE_PVS_NULL_MODE_POLICY: false,

  /**
   * 条件付き root PVS。
   * 現在 OFF の実験機能（experimental / OFF / v2.0.0 固定）。
   */
  ENABLE_CONDITIONAL_ROOT_PVS: false,
} as const;

export type PvsNullMode = 'baseline' | 'quiet_only' | 'off';

/**
 * Search tuning 用の詳細設定。
 * inactive / experimental flag に依存する項目はコメントで明示する。
 */
export const SEARCH_TUNING_CONFIG: {
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
  /**
   * Static Eval Cache の世代。
   * 評価関数変更時はこの値を増やす。
   */
  STATIC_EVAL_VERSION: 4n,

  // Aspiration 関連は master flag OFF のため inactive。
  ASPIRATION_WINDOW_OVERRIDE: 200,
  ASPIRATION_ADAPTIVE_MAX_WINDOW: 800,
  ASPIRATION_QUIET_THRESHOLD: AI_SCORES.CLOSED_FOUR,

  // PVS null-mode policy が有効な場合のみ使用（experimental / 既定 OFF）。
  PVS_NULL_MODE: 'quiet_only',

  TIME_PREDICTION_SAFETY: 1.6,
  TIME_PREDICTION_MIN_DEPTH: 3,

  // Conditional root PVS が有効な場合のみ使用（experimental / 既定 OFF）。
  ROOT_PVS_MIN_DEPTH: 3,
};

/**
 * StaticEvalCache の固定テーブルサイズ（2^16 = 65,536）。
 * 最大 50,000 エントリを保持できる 2 の累乗として設定している。
 * 直接マッピング方式のハッシュテーブルとして使用する。
 */
export const SEC_TABLE_SIZE = 65_536;

// ============================================================
// Threat Model / Forbidden Flags
// ============================================================

/**
 * Threat Model / forced move list / 動的禁手の機能群。
 *
 * 分類:
 * - Production: v2.0.0 固定
 * - Experimental / Inactive: OFF / v2.0.0 固定
 * - Debug flag（ENABLE_STATE_AUDIT）は diagnosticsFlags.ts へ移動済み
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
   * 現在 OFF（experimental / v2.0.0 固定）。
   */
  ENABLE_FORCED_ORDERING: false,

  /**
   * internal node で forced move list 生成。
   * 現在 OFF（experimental / v2.0.0 固定）。
   */
  ENABLE_INTERNAL_FORCED_LIST: false,

  /**
   * OPEN_THREE_DEFENSE を forced move list に含める。
   * 現在 OFF（experimental / v2.0.0 固定）。
   */
  ENABLE_OPEN_THREE_DEFENSE: false,

  /**
   * internal node で動的禁手を適用。
   * 現在 OFF（experimental / v2.0.0 固定）。
   */
  ENABLE_DYNAMIC_FORBIDDEN_INTERNAL: false,
} as const;

/**
 * Threat Model / forbidden 用の詳細設定。
 * v2.0.0 では固定扱い。
 */
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
   * v2.0.0 では固定扱い。
   */
  REQUIRE_EXPLICIT_FORBIDDEN_RULE: false,
} as const;

// ============================================================
// VCF Flags
// ============================================================

/**
 * Root VCF 専用。
 * Production flag は v2.0.0 固定。
 * Debug flag（ENABLE_VCF_STATE_AUDIT / ENABLE_VCF_VERBOSE_LOG）は
 * diagnosticsFlags.ts へ移動済み。
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

  /** 即時勝ちマスが 2 箇所以上の場合を受け不可として終端 */
  VCF_ALLOW_OPEN_FOUR_TERMINAL: true,

  /** VCF で勝ち証明できた場合、通常探索より優先して着手を返す */
  ENABLE_VCF_RETURN_ON_WIN: true,
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
// Quiescence Flags
// ============================================================

/**
 * 戦術 Quiescence 専用。
 * Production flag は v2.0.0 固定。
 * Debug flag（ENABLE_QSEARCH_STATE_AUDIT / ENABLE_QSEARCH_VERBOSE_LOG）は
 * diagnosticsFlags.ts へ移動済み。
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
// 評価 Feature Flags
// ============================================================

/**
 * 評価関数そのものに影響する Feature Flag。
 * AI の強さに影響するため、変更は慎重に行う。
 */
export const EVALUATION_FEATURES = {
  /**
   * 形状ボーナスを有効化。
   * 通常評価分支でのみ使用し、即時戦術スコアには影響しない。
   */
  ENABLE_SHAPE_BONUS: true,

  /**
   * 中央近接ボーナスの強化を有効化。
   * 有効時、EVAL_CONFIG.POSITION_BONUS_MAX を最大値とする二次減衰を適用する。
   * 無効時、POSITION_BONUS_EPSILON を最大値とする線形減衰を維持する。
   * move ordering（evaluatePosition / evaluatePositionWithCache）のみに適用し、
   * 葉評価（scoreFromLineCache）には影響しない。
   */
  ENABLE_ENHANCED_POSITION_BONUS: true,

  /**
   * 形状ボーナスの距離別重みを有効化。
   * 有効時、距離1（隣接）と距離2（1マス空き）で異なる重みを適用し、
   * 上限を EVAL_CONFIG.SHAPE_MAX_BONUS_ENHANCED に引き上げる。
   * 無効時、距離一律の EVAL_CONFIG.SHAPE_BONUS_PER_STONE と
   * EVAL_CONFIG.SHAPE_MAX_BONUS を維持する。
   * ENABLE_SHAPE_BONUS が false の場合は本 flag の値に関わらず無効。
   */
  ENABLE_ENHANCED_SHAPE_BONUS: false,

  /**
   * 盤面集約の Top-K 拡大を有効化。
   * 有効時、K=5・減衰係数 0.25 で盤面集約を行う。
   * 無効時、K=3・減衰係数 0.3 の挙動を維持する。
   */
  ENABLE_ENHANCED_TOP_K: false,

  /**
   * 脅威密度ボーナスを有効化。
   * 有効時、Top-K に漏れる中小脅威の累積価値を補助項として最終スコアに加算する。
   * 無効時、脅威密度の集計を行わず現行挙動を維持する。
   */
  ENABLE_THREAT_DENSITY: true,

  /**
   * 攻守分離 Top-K 集約を有効化。
   * 有効時、攻撃スコアと防御スコアを分離して集約し、
   * 攻めと守りに異なる重み・減衰を適用可能にする。
   * 無効時、合成スコアの Top-K 集約を維持する。
   */
  ENABLE_BALANCED_AGGREGATION: false,
} as const;