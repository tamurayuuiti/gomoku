// src/utils/ai/diagnosticsFlags.ts
// 診断・デバッグ専用設定を管理するファイル。
//
// 責務:
//   - ログレベル / 統計出力
//   - 診断用時間計測
//   - 状態監査 / verbose ログ
//
// 注意:
//   - AI の強さ・探索挙動・評価関数・UI・Worker 通信に影響しない設定のみを置く。
//   - 診断設定は探索の意思決定に使わない。
//   - constants.ts からは再 export しない。

import type { AiLogLevel } from '../../types/ai';

// ============================================================
// ログ・統計
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
// 時間計測
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
// デバッグ用 Flag
// ============================================================

/**
 * 開発用の状態監査・詳細ログ Flag。
 * すべて既定 OFF。本番挙動には影響しない。
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