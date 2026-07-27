// src/utils/ai/constants.ts
// AIの評価ロジックや定数を定義するファイル
//
// 型定義（PatternType / PatternCount / SearchOptions）は複数ファイルから
// 共有されるため types/ai.ts に集約している。このファイルは定数のみを扱う。

import { DIRECTIONS as GAME_DIRECTIONS } from '../gameLogic';
import type { AiLogLevel } from '../../types/ai';

// --- スコア定数（攻撃基準に統一） ---

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

// --- AI探索設定 ---

// depth・timeLimitMs のデフォルト値をここに一元管理し、
// 呼び出し側が SearchOptions を明示しない限り常にこの値が使われる。

export const AI_CONFIG = {
  ATTACK_WEIGHT: 1.1,

  /** 候補手生成時の周辺探索距離 */
  SEARCH_RANGE: 2,

  /**
   * ミニマックス探索の基本深さ
   * - SearchOptions.timeLimitMs 未指定時: この深さで固定探索する
   * - SearchOptions.timeLimitMs 指定時  : 反復深化の上限深さとして使う
   *
   * 第2弾で LMR / PVS / 候補手生成改善により深度余地が増えるため、
   * 時間制御（DEFAULT_TIME_LIMIT_MS）を前提に 12 へ引き上げ済み。
   */
  MINIMAX_DEPTH: 12,

  /**
   * 反復深化のデフォルト時間制限 [ms]。
   * 今後 AI レベル（Easy/Normal/Hard 等）を導入する際は、
   * レベルごとの SearchOptions プリセットでこの値を上書きする想定。
   */
  DEFAULT_TIME_LIMIT_MS: 1200,

  /**
   * 各ノードで探索する候補手の上限数（move ordering 後に先頭から取得）
   *
   * 第2弾では candidateGenerator 側で局面依存の上限制御を行うため、
   * この値は feature flag OFF 時やフォールバック時の基準値として使う。
   */
  MAX_CANDIDATES: 15,
} as const;

// --- 全盤評価設定 ---

export const EVAL_CONFIG = {
  /**
   * evaluateBoard で集計する上位 K 手の数。
   * 単純な max 比較ではなく上位 K 手の重み付き和を取ることで、
   * 多重脅威の盤面を正確に評価できる。
   */
  TOP_K: 3,

  /**
   * 2 番手以降のスコアに掛ける減衰係数。
   * 0.3 = 2 番手は 30%、3 番手は 9% 寄与する。
   * 脅威の多重性を評価しつつ、支配的な 1 手の価値を損なわない。
   */
  TOP_K_DECAY: 0.3,
} as const;

// --- Transposition Table / Aspiration Window 設定 ---

export const TT_CONFIG = {
  /**
   * 置換表の最大エントリ数。
   * この値を超えたら全クリアする（簡易的なメモリ管理）。
   * 1エントリ ≈ 100byte として、200,000件 ≈ 20MB 程度を想定。
   *
   * 第3弾で oldest eviction を導入したため、全クリアはフォールバック。
   */
  MAX_ENTRIES: 200_000,

  /**
   * Aspiration Window の有効フラグ。
   *
   * 第3弾では search.ts 側の AI_FEATURES.ENABLE_SAFE_ASPIRATION を使用する。
   * このフラグは後方互換のため残すが、基本は使用しない。
   */
  ENABLE_ASPIRATION_WINDOW: false,

  /**
   * Aspiration Window の初期幅。
   * 反復深化の各ステップで、前回のスコアを中心に ±この幅のウィンドウを設定する。
   * Fail High/Low 時にウィンドウを拡大して再探索する。
   *
   * 第3弾では LMR/PVS によるスコア揺れを考慮し、50 → 100 へ拡大している。
   */
  ASPIRATION_WINDOW: 100,

  /**
   * TT oldest eviction 時に削除する割合。
   * 上限到達時、挿入順にこの割合だけ古いエントリを削除する。
   */
  EVICTION_RATIO: 0.2,
} as const;

// --- 第2弾 feature flags ---

/**
 * 第2弾・第3弾の探索機能を個別に有効/無効化するフラグ。
 *
 * 各機能を独立して ON/OFF できるようにし、
 * 性能比較・デバッグ・段階的ロールアウトを容易にする。
 */
export const AI_FEATURES = {
  // --- 第2弾 ---

  /**
   * 戦術的候補手生成を有効化する。
   * - CRITICAL / Countermove / Killer / Quiet の tier 管理
   * - Quiet のマージン剪定
   * - 局面依存の候補手上限
   */
  ENABLE_TACTICAL_CANDIDATES: true,

  /** Countermove Heuristic を有効化する */
  ENABLE_COUNTERMOVE: true,

  /** Late Move Reduction を有効化する */
  ENABLE_LMR: true,

  /** PVS / NegaScout を有効化する */
  ENABLE_PVS: true,

  // --- 第3弾 ---

  /** 差分ラインキャッシュを有効化する */
  ENABLE_LINE_CACHE: true,

  /** 候補集合の増分管理を有効化する */
  ENABLE_INCREMENTAL_CANDIDATES: true,

  /**
   * Aspiration Window を安全な形で再有効化する。
   *
   * 第5.6.1:
   * 統計上 aspFailRate が極めて高かったため、既定では OFF にする。
   * 実装自体は search.ts / constants.ts に維持しており、
   * true にすれば再有効化できる。
   */
  ENABLE_SAFE_ASPIRATION: false,

  /** TT 上限到達時の oldest eviction を有効化する */
  ENABLE_TT_OLDEST_EVICTION: true,

  /** detectPattern のキャッシュを有効化する */
  ENABLE_PATTERN_CACHE: true,
} as const;

// --- 候補手生成設定 ---

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

  /**
   * Quiet 手のマージン剪定を有効化する。
   * 最善 Quiet 手より大きく劣る静かな手を枝刈りする。
   */
  ENABLE_MARGIN_PRUNING: true,

  /**
   * Quiet 手のマージン幅。
   * 最善 Quiet 手からこの値以上低い手は原則として捨てる。
   *
   * 戦術手・CRITICAL・Killer・Countermove・TT Move は対象外。
   */
  QUIET_SCORE_MARGIN: AI_SCORES.OPEN_THREE,
} as const;

// --- LMR 設定 ---

export const LMR_CONFIG = {
  /** LMR を適用する最小残り深度 */
  MIN_DEPTH: 3,

  /** LMR を適用する最小 move index（0始まり） */
  MIN_MOVE_INDEX: 3,

  /** 最大削減量 */
  MAX_REDUCTION: 2,

  /** より深い削減を使う残り深度 */
  DEEP_REDUCTION_DEPTH: 6,

  /** より深い削減を使う move index */
  DEEP_REDUCTION_MOVE_INDEX: 6,

  /**
   * ルートノードでの LMR を許可するか。
   * 最善手選択への影響を避けるため、デフォルトでは OFF。
   */
  ALLOW_ROOT: false,
} as const;

// --- PVS 設定 ---

export const PVS_CONFIG = {
  /**
   * ルートノードでの PVS を許可するか。
   *
   * 内部ノードの PVS は有効でも、ルートでは最善手安定性を重視して
   * デフォルト OFF とする。
   */
  ENABLE_ROOT_PVS: false,
} as const;

// --- 第4弾：診断用設定 ---

/**
 * 第4弾で追加する診断専用設定。
 * 探索挙動を変える feature flag ではない。
 */
export const AI_DEBUG_CONFIG: {
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

// --- 第5弾：feature flags / config ---

/**
 * 第5弾で追加した探索効率・診断強化の機能フラグ。
 *
 * 第5.5弾では、統計分析を踏まえて以下を既定化した。
 * - Aspiration tuning / adaptive を ON
 * - time prediction を保守的に ON
 * - checkWin timing を検証用に ON
 *
 * 第5.5.1弾では、Aspiration fail 率が極端に高かったため、
 * quiet-only Aspiration を追加した。
 *
 * 第5.6.1では、Aspiration Window 自体を既定 OFF にする。
 * ただし、Aspiration 関連実装と flag は維持する。
 */
export const PHASE5_FEATURES = {
  /** 中心文字差し替え済みパターンキャッシュを有効化する */
  ENABLE_CENTER_PATTERN_CACHE: true,

  /** 候補手 tier 分類を bucket 方式で行う */
  ENABLE_TIER_BUCKET_GENERATION: true,

  /** TopK 挿入を固定長配列向け最適化に切り替える */
  ENABLE_TOPK_FIXED_ARRAY: true,

  /** 葉評価の Static Eval Cache を有効化する */
  ENABLE_STATIC_EVAL_CACHE: true,

  /**
   * Aspiration Window 幅の再調整を有効化する。
   *
   * 注意:
   * 実際の Aspiration 有効可否は AI_FEATURES.ENABLE_SAFE_ASPIRATION が最優先する。
   * 第5.6.1では ENABLE_SAFE_ASPIRATION が false のため、この flag は inactive。
   */
  ENABLE_ASPIRATION_TUNING: true,

  /**
   * Aspiration Window の adaptive 拡張を有効化する。
   *
   * 注意:
   * ENABLE_SAFE_ASPIRATION が false の場合は inactive。
   */
  ENABLE_ADAPTIVE_ASPIRATION: true,

  /**
   * Aspiration Window を静かな局面でのみ使う。
   *
   * 注意:
   * ENABLE_SAFE_ASPIRATION が false の場合は inactive。
   */
  ENABLE_ASPIRATION_QUIET_ONLY: true,

  /** PVS null-window の抑制モードを有効化する */
  ENABLE_PVS_NULL_MODE: false,

  /** 時間予測による反復深化の打ち切りを有効化する */
  ENABLE_TIME_PREDICTION: true,

  /** ルート PVS の条件付き実験を有効化する */
  ENABLE_ROOT_PVS_EXPERIMENT: false,
} as const;

export type Phase5PvsNullMode = 'baseline' | 'quiet_only' | 'off';

export const PHASE5_CONFIG: {
  CENTER_PATTERN_CACHE_LIMIT: number;
  STATIC_EVAL_CACHE_LIMIT: number;
  STATIC_EVAL_CACHE_EVICTION_RATIO: number;
  STATIC_EVAL_VERSION: bigint;
  ASPIRATION_WINDOW_OVERRIDE: number;
  ASPIRATION_ADAPTIVE_MAX_WINDOW: number;
  ASPIRATION_QUIET_THRESHOLD: number;
  PVS_NULL_MODE: Phase5PvsNullMode;
  TIME_PREDICTION_SAFETY: number;
  TIME_PREDICTION_MIN_DEPTH: number;
  ROOT_PVS_MIN_DEPTH: number;
} = {
  CENTER_PATTERN_CACHE_LIMIT: 20_000,

  /**
   * 第5.5弾:
   * 長期戦・中盤の葉評価重複を考慮し、20k から 50k へ拡大する。
   */
  STATIC_EVAL_CACHE_LIMIT: 50_000,
  STATIC_EVAL_CACHE_EVICTION_RATIO: 0.2,

  /**
   * Static Eval Cache の世代。
   * 評価関数変更時はこの値を増やし、古いキャッシュが混ざらないようにする。
   */
  STATIC_EVAL_VERSION: 1n,

  /**
   * 第5.5弾:
   * Aspiration fail 率が高かったため、まず 200 へ引き上げる。
   *
   * 注意:
   * 第5.6.1では Aspiration 自体が既定 OFF のため、この値は inactive。
   */
  ASPIRATION_WINDOW_OVERRIDE: 200,

  /**
   * 第5.5弾:
   * adaptive 拡張の上限。広げすぎを避けつつ、fail 続きの局面に対応する。
   *
   * 注意:
   * 第5.6.1では Aspiration 自体が既定 OFF のため、この値は inactive。
   */
  ASPIRATION_ADAPTIVE_MAX_WINDOW: 800,

  /**
   * 第5.5.1弾:
   * Aspiration を使う上限スコア。
   * この値以上の戦術的スコアでは full window を使う。
   *
   * 注意:
   * 第5.6.1では Aspiration 自体が既定 OFF のため、この値は inactive。
   */
  ASPIRATION_QUIET_THRESHOLD: AI_SCORES.CLOSED_FOUR,

  /** PVS null-window 抑制モード */
  PVS_NULL_MODE: 'quiet_only',

  /**
   * 第5.5弾:
   * 時間予測は保守的にするため、安全係数を 1.6 へ引き上げる。
   */
  TIME_PREDICTION_SAFETY: 1.6,

  /**
   * 第5.5弾:
   * 浅い深度での早期打ち切りを避け、depth >= 3 から適用する。
   */
  TIME_PREDICTION_MIN_DEPTH: 3,

  /** ルート PVS 実験を許可する最小深度 */
  ROOT_PVS_MIN_DEPTH: 3,
};

/**
 * 第5弾の診断専用設定。
 * 探索挙動そのものは変更しない。
 *
 * 第5.5弾では、checkWin コスト可視化を優先するため
 * ENABLE_CHECKWIN_TIMING を既定で true にする。
 */
export const PHASE5_DEBUG = {
  /** checkWin の時間計測を行うか（検証フェーズのため既定 ON） */
  ENABLE_CHECKWIN_TIMING: true,

  /** 葉評価の時間計測を行うか */
  ENABLE_LEAF_TIMING: true,

  /** 第5弾設定ログを出力するか */
  ENABLE_PHASE5_CONFIG_LOG: false,
} as const;

// --- 第6.1弾：feature flags / config ---

/**
 * 第6.1弾で追加する Threat Model / forced move list 関連の機能フラグ。
 *
 * 第6.2弾の動的禁手・状態管理共通化は含まない。
 * 既存の評価値・tier・LMR / PVS の意味は変更しない。
 */
export const PHASE6_FEATURES = {
  /** Threat Model を有効化する */
  ENABLE_THREAT_MODEL: true,

  /** forced move list 生成を有効化する */
  ENABLE_FORCED_MOVE_LIST: true,

  /**
   * root で必須 forced move が候補から欠落している場合、
   * 既存候補の末尾へ追加して保護する。
   *
   * 既定では既存候補の並び順を変更しない。
   */
  ENABLE_ROOT_FORCED_PROTECTION: true,

  /**
   * forced move に基づく並び順変更を有効化する。
   *
   * 探索挙動が変わるため、第6.1弾では既定 OFF。
   */
  ENABLE_FORCED_ORDERING: false,

  /**
   * internal node で forced move list 生成を有効化する。
   *
   * 性能影響を分離するため、第6.1弾では既定 OFF。
   */
  ENABLE_INTERNAL_FORCED_LIST: false,

  /**
   * OPEN_THREE_DEFENSE を forced move list に含める。
   *
   * 過剰な強制手判定を避けるため、第6.1弾では既定 OFF。
   */
  ENABLE_OPEN_THREE_DEFENSE: false,

  // --- 第6.2弾 ---

  /**
   * 限定動的禁手を有効化する。
   *
   * Black 手番時のみ、root / shallow node で候補手生成時に禁手を再判定する。
   * 完全増分禁手ではなく、静的 forbiddenMoves を補完する限定対応。
   */
  ENABLE_DYNAMIC_FORBIDDEN: true,

  /** root node で動的禁手を適用するか */
  ENABLE_DYNAMIC_FORBIDDEN_ROOT: true,

  /**
   * internal node で動的禁手を適用するか。
   *
   * 性能影響を分離するため、第6.2弾では既定 OFF。
   * 有効化する場合も DYNAMIC_FORBIDDEN_INTERNAL_MAX_DEPTH で shallow 限定にする。
   */
  ENABLE_DYNAMIC_FORBIDDEN_INTERNAL: false,

  /** 動的禁手判定結果のキャッシュを有効化する */
  ENABLE_FORBIDDEN_CACHE: true,

  /**
   * 状態管理共通化のデバッグ監査を有効化する。
   *
   * undo 後の board 状態などを検査する。
   * 探索挙動は変更しないが、開発時以外は OFF を推奨。
   */
  ENABLE_STATE_AUDIT: false,
} as const;

/**
 * 第6.1弾の設定値。
 * 探索挙動そのものではなく、forced move list の生成範囲・保護容量を制御する。
 */
export const PHASE6_CONFIG = {
  /** Threat Model / forced move list の世代（診断・将来キャッシュ用） */
  THREAT_MODEL_VERSION: 1n,

  /**
   * root で必須 forced move を追加するための追加容量。
   * 既存の ROOT_MAX_CANDIDATES に加えて、この件数まで追加を許容する。
   */
  ROOT_FORCED_EXTRA_CAPACITY: 2,

  /**
   * internal forced move list を有効化した場合の最大残り深度。
   * ENABLE_INTERNAL_FORCED_LIST が false の場合は使用しない。
   */
  INTERNAL_FORCED_MAX_DEPTH: 4,

  /**
   * internal forced move list 生成時に走査する候補手の上限。
   * ENABLE_INTERNAL_FORCED_LIST が false の場合は使用しない。
   */
  INTERNAL_FORCED_MAX_CANDIDATES: 32,

  /**
   * OPEN_THREE_DEFENSE を有効化した場合の最大追加件数。
   * ENABLE_OPEN_THREE_DEFENSE が false の場合は使用しない。
   */
  OPEN_THREE_DEFENSE_MAX_MOVES: 4,

  // --- 第6.2弾 ---

  /**
   * internal 動的禁手を有効化した場合の最大残り深度。
   * ENABLE_DYNAMIC_FORBIDDEN_INTERNAL が false の場合は使用しない。
   */
  DYNAMIC_FORBIDDEN_INTERNAL_MAX_DEPTH: 2,

  /** 禁手キャッシュの最大エントリ数 */
  FORBIDDEN_CACHE_LIMIT: 20_000,

  /** 禁手キャッシュ上限到達時の eviction 割合 */
  FORBIDDEN_CACHE_EVICTION_RATIO: 0.2,

  /** 禁手キャッシュ世代。禁手判定ロジック変更時に bump する */
  FORBIDDEN_CACHE_VERSION: 1n,

  /**
   * true の場合、SearchOptions.forbiddenRuleEnabled === true が明示されたときだけ
   * 動的禁手を有効化する。
   *
   * false の場合、undefined を禁手有効として扱う。
   * 既存 UI との後方互換を重視する場合は false、
   * 禁手 OFF 設定との誤整合を完全に避けたい場合は true を推奨。
   */
  REQUIRE_EXPLICIT_FORBIDDEN_RULE: false,
} as const;

// --- 第7.1弾：feature flags / config ---

/**
 * 第7.1弾で追加する Root VCF 関連の機能フラグ。
 *
 * 第7.1弾は root VCF のみ。
 * Internal VCF は第7.2弾で扱うため、ここでは実装しない。
 */
export const PHASE7_FEATURES = {
  /** VCF 全体 master */
  ENABLE_VCF: true,

  /** Root VCF を有効化する */
  ENABLE_ROOT_VCF: true,

  /** VCF 内で LineCache を使用する */
  VCF_USE_LINE_CACHE: true,

  /** VCF 内で禁手キャッシュを使用する */
  VCF_USE_FORBIDDEN_CACHE: true,

  /** 防御側の即時勝ち反撃を確認する */
  VCF_CHECK_DEFENDER_COUNTER_WIN: true,

  /** 即時勝ちマスが 2 箇所以上の場合を受け不可として終端する */
  VCF_ALLOW_OPEN_FOUR_TERMINAL: true,

  /** VCF で勝ち証明できた場合、通常探索より優先して着手を返す */
  ENABLE_VCF_RETURN_ON_WIN: true,

  /** VCF 状態監査（undo 後 stone count 確認） */
  ENABLE_VCF_STATE_AUDIT: false,

  /** VCF 詳細ログ */
  ENABLE_VCF_VERBOSE_LOG: false,
} as const;

/**
 * 第7.1弾の設定値。
 * Root VCF の時間・ノード・ply・skip 条件を制御する。
 */
export const PHASE7_CONFIG = {
  /** VCF 世代（診断・禁手キャッシュ用） */
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

// --- 方向定数 ---

export const DIRECTIONS = GAME_DIRECTIONS;