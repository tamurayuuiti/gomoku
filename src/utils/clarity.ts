// src/utils/clarity.ts
// Microsoft Clarity の初期化を担うモジュール。
//
// 責務:
//   - 環境変数からのプロジェクト ID 取得
//   - StrictMode / HMR による重複初期化の防止
//   - Clarity SDK の初期化実行
//
// 注意:
//   - プロジェクト ID 未設定・ブラウザ環境外では何もしない（サイレント no-op）。
//   - 重複検知は @microsoft/clarity が展開する window.clarity の存在確認で行う。

import Clarity from '@microsoft/clarity'

const CLARITY_PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID

export function initializeClarity(): void {
  // 1. 環境変数がない、またはブラウザ環境でない場合は終了
  if (!CLARITY_PROJECT_ID || typeof window === 'undefined') {
    return
  }

  // 2. StrictModeやHMRによる重複初期化を防止
  // @microsoft/clarity は初期化時に window.clarity をグローバルに展開するため、
  // それがすでに存在する場合はスキップする
  if ('clarity' in window) {
    return
  }

  // 3. Clarityの初期化実行
  Clarity.init(CLARITY_PROJECT_ID)
}