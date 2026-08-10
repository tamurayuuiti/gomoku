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