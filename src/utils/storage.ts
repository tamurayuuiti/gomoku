// src/utils/storage.ts
// localStorage の安全な読み書きを提供する共通ユーティリティ。
//
// 責務:
//   - プライベートブラウジング・利用不可環境での例外吸収
//   - 読み・書き・削除の安全なアクセス提供
//
// 注意:
//   - 値の意味・検証・パースは行わない（呼び出し側の責務）。

/**
 * localStorage から文字列を安全に読み取る。
 * プライベートブラウジング・利用不可時は null を返す。
 */
export const readItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * localStorage へ文字列を安全に書き込む。
 * 書き込み失敗時は静かに無視する。
 */
export const writeItem = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage 利用不可の場合は何もしない
  }
};

/**
 * localStorage の指定キーを安全に削除する。
 * 削除失敗時は静かに無視する。
 */
export const removeItem = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // localStorage 利用不可の場合は何もしない
  }
};