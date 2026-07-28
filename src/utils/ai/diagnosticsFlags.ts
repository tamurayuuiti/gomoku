// src/utils/ai/diagnosticsFlags.ts
// 診断・デバッグ専用設定を管理するファイル。
//
// 方針:
// - AIの強さ・探索挙動・評価関数・UI・Worker通信に影響しない設定のみを置く。
// - 診断設定は探索の意思決定に使わない。
// - 値は旧 constants.ts から v2.0.0 時点で完全に凍結移管する。
//
// 責務:
// - DIAGNOSTICS_CONFIG: ログレベル / 統計出力
// - TIMING_DIAGNOSTICS_CONFIG: 診断用時間計測
// - DIAGNOSTICS_DEBUG_FLAGS: 状態監査 / verbose ログ
//
// 注意:
// - constants.ts からは再exportしない。
// - 利用箇所は本ファイルを直接 import する。

import type { AiLogLevel } from '../../types/ai';

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
// Debug-only Flags (audit / verbose)
// ============================================================
/**
 * 開発用の状態監査・詳細ログFlag。
 * すべて既定OFF。本番挙動には影響しない。
 */
export const DIAGNOSTICS_DEBUG_FLAGS = {
  /** searchState の board undo 監査 */
  ENABLE_STATE_AUDIT: false,
  /** VCF 状態監査 */
  ENABLE_VCF_STATE_AUDIT: false,
  /** VCF 詳細ログ */
  ENABLE_VCF_VERBOSE_LOG: false,
  /** qsearch 状態監査 */
  ENABLE_QSEARCH_STATE_AUDIT: false,
  /** qsearch 詳細ログ */
  ENABLE_QSEARCH_VERBOSE_LOG: false,
} as const;