// src/hooks/useTheme.ts
// テーマ状態の管理・永続化・DOM 反映を担うカスタムフック。
//
// 責務:
//   - テーマ設定値（'light' | 'dark' | 'system'）の初期化と永続化
//   - localStorage からの復元（キー: 'gomoku-theme'）
//   - 'system' 選択時の prefers-color-scheme リアルタイム追従
//   - 解決済みテーマ（'light' | 'dark'）の導出
//   - document.documentElement への .dark クラスの同期
//   - テーマ変更時の localStorage 書き込み
//   - cyclePreference コールバックの提供（useCallback で identity 安定化）

import { useState, useEffect, useCallback } from 'react';

// ============================================================
// 型定義
// ============================================================

/** ユーザーが選択するテーマ設定（永続化対象） */
export type ThemePreference = 'light' | 'dark' | 'system';

/** 実際の表示テーマ（解決済み。DOM に適用される値） */
export type ResolvedTheme = 'light' | 'dark';

// ============================================================
// 定数・ヘルパー
// ============================================================

const STORAGE_KEY = 'gomoku-theme';

/**
 * localStorage から保存されたテーマ設定を読み取る。
 * プライベートブラウジング等で localStorage が利用不可の場合は
 * try-catch で安全にフォールバックする。
 */
const readStoredPreference = (): ThemePreference | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * テーマ設定を localStorage へ書き込む。
 * 書き込み失敗時は静かに無視する。
 */
const writeStoredPreference = (preference: ThemePreference): void => {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // localStorage 利用不可の場合は何もしない
  }
};

/**
 * システムの配色設定（prefers-color-scheme）を検出する。
 * matchMedia 非対応の環境では 'light' をデフォルトとする。
 */
const getSystemTheme = (): ResolvedTheme => {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
};

/**
 * 初期テーマ設定を決定する。
 * 優先順: localStorage > 'system'（デフォルト）
 *
 * 'system' がデフォルトのため、初回訪問時は OS 設定に追従する。
 * ユーザーが明示的に light / dark を選択した場合はその値が復元される。
 */
const getInitialPreference = (): ThemePreference => {
  const stored = readStoredPreference();
  if (stored !== null) return stored;
  return 'system';
};

// ============================================================
// カスタムフック
// ============================================================

export const useTheme = (): {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  cyclePreference: () => void;
} => {
  // lazy initializer で初回レンダリング時点で正しい設定値を確定させる（FOUC 対策）。
  const [preference, setPreference] = useState<ThemePreference>(getInitialPreference);

  // システムテーマの現在値。'system' 選択時のみ resolvedTheme に反映される。
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  // prefers-color-scheme の変化をリアルタイムで監視する。
  // 'system' 選択中は OS 側のテーマ変更が即座にアプリへ反映される。
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // 実際の表示テーマを導出する。
  // 'system' の場合はシステムテーマを、それ以外は設定値をそのまま使う。
  const resolvedTheme: ResolvedTheme =
    preference === 'system' ? systemTheme : preference;

  // resolvedTheme / preference が変化するたび、<html> 要素の .dark クラスと
  // localStorage を同期する。
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    writeStoredPreference(preference);
  }, [resolvedTheme, preference]);

  // テーマ設定を循環的に切り替える: system → light → dark → system。
  // identity を安定化し、子コンポーネントの不要な再レンダーを防ぐ。
  const cyclePreference = useCallback(() => {
    setPreference(prev => {
      if (prev === 'system') return 'light';
      if (prev === 'light') return 'dark';
      return 'system';
    });
  }, []);

  return { preference, resolvedTheme, cyclePreference };
};