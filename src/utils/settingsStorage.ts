// src/utils/settingsStorage.ts
// 永続化ゲーム設定のスキーマ定義・検証・読み書きを担うモジュール。
//
// 責務:
//   - 永続化対象のゲーム設定スキーマ定義
//   - デフォルト値・フィールド単位の検証・フォールバック
//   - バージョン管理と読み書き
//
// 注意:
//   - localStorage の例外吸収は storage.ts に委譲する。
//   - 値検証は as によるキャストではなく、明示的なリテラル比較・型ガードで行う。

import type { GameMode, Player, AiLevel } from '../types/game';
import { DEFAULT_AI_LEVEL } from './ai/constants';
import { readItem, writeItem } from './storage';

// ============================================================
// 型定義
// ============================================================

/** 永続化対象のゲーム設定スキーマ */
export interface PersistedSettings {
  /** スキーマバージョン（マイグレーション用） */
  version: number;
  /** 対戦モード */
  gameMode: GameMode;
  /** PvE 時の人間プレイヤー色 */
  playerColor: Player;
  /** 禁じ手ルールの有効/無効 */
  useForbiddenRule: boolean;
  /** AI レベル */
  aiLevel: AiLevel;
}

// ============================================================
// 定数
// ============================================================

/** localStorage キー */
export const SETTINGS_STORAGE_KEY = 'gomoku-settings';

/** スキーマバージョン */
export const SETTINGS_SCHEMA_VERSION = 1;

/** デフォルト設定（ゲーム設定の初期値と一致） */
export const DEFAULT_SETTINGS: Omit<PersistedSettings, 'version'> = {
  gameMode: 'PvE',
  playerColor: 'Black',
  useForbiddenRule: true,
  aiLevel: DEFAULT_AI_LEVEL,
};

// ============================================================
// フィールド検証
// ============================================================

/** 対戦モードの検証。不正値はデフォルトへフォールバックする */
const validateGameMode = (value: unknown): GameMode => {
  if (value === 'PvP' || value === 'PvE') return value;
  return DEFAULT_SETTINGS.gameMode;
};

/** プレイヤー色の検証。不正値はデフォルトへフォールバックする */
const validatePlayerColor = (value: unknown): Player => {
  if (value === 'Black' || value === 'White') return value;
  return DEFAULT_SETTINGS.playerColor;
};

/** 禁じ手ルールの検証。非 boolean はデフォルトへフォールバックする */
const validateUseForbiddenRule = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  return DEFAULT_SETTINGS.useForbiddenRule;
};

/** AI レベルの検証。範囲外の値はデフォルトへフォールバックする */
const validateAiLevel = (value: unknown): AiLevel => {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  return DEFAULT_SETTINGS.aiLevel;
};

/** JSON パース結果がオブジェクト（連想配列）かどうかを判定する型ガード */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// ============================================================
// 公開 API
// ============================================================

/**
 * localStorage からゲーム設定を読み込み、検証済みのオブジェクトを返す。
 * パース失敗・型不一致・範囲外の値はフィールド単位でデフォルトにフォールバックする。
 * version 不一致の場合はマイグレーションを試みる（v1 ではデフォルト返却）。
 */
export const loadSettings = (): Omit<PersistedSettings, 'version'> => {
  const raw = readItem(SETTINGS_STORAGE_KEY);
  if (raw === null) {
    return { ...DEFAULT_SETTINGS };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }

  if (!isRecord(parsed)) {
    return { ...DEFAULT_SETTINGS };
  }

  // スキーマバージョン不一致はマイグレーションの分岐点。
  // v1 に対応するマイグレーション対象が存在しないためデフォルトを返す。
  if (parsed.version !== SETTINGS_SCHEMA_VERSION) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    gameMode: validateGameMode(parsed.gameMode),
    playerColor: validatePlayerColor(parsed.playerColor),
    useForbiddenRule: validateUseForbiddenRule(parsed.useForbiddenRule),
    aiLevel: validateAiLevel(parsed.aiLevel),
  };
};

/**
 * ゲーム設定を localStorage へ JSON として書き込む。
 * version は本関数内部で付与する。
 */
export const saveSettings = (
  settings: Omit<PersistedSettings, 'version'>
): void => {
  const payload: PersistedSettings = {
    ...settings,
    version: SETTINGS_SCHEMA_VERSION,
  };
  writeItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
};