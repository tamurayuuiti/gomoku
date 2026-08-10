const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID

declare global {
  interface Window {
    dataLayer: unknown[]
    // gtag.js が定義する関数シグネチャに合わせる
    gtag: (...args: unknown[]) => void
  }
}

export function initializeAnalytics(): void {
  // 1. 測定IDがない、またはブラウザ環境でない場合は終了
  if (!GA_MEASUREMENT_ID || typeof window === 'undefined') {
    return
  }

  // 2. StrictModeやHMRによる重複実行を防止
  if (document.querySelector('script[src*="googletagmanager"]')) {
    return
  }

  // 3. dataLayerの初期化
  window.dataLayer = window.dataLayer || []

  // 【修正点】公式スニペットと同じ function 定義と arguments を使用
  // アロー関数 (...) を使うと Array が push され、gtag.js がキューを消化しない原因になる
  window.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments)
  }

  // 4. スクリプトタグの動的挿入
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
  
  // 【追加】ロード失敗時のデバッグログ（AdBlockerなどでブロックされた場合に検知可能）
  script.onerror = () => {
    console.error('GA4: Failed to load gtag.js. Check AdBlocker or network.')
  }

  // head の先頭に挿入し、他のスクリプトより優先して読み込ませる
  document.head.insertBefore(script, document.head.firstElementChild)

  // 5. 初期化コマンドの実行
  // これらは dataLayer に "argumentsオブジェクト" として積まれ、gtag.js ロード後に正しく処理される
  window.gtag('js', new Date())
  window.gtag('config', GA_MEASUREMENT_ID)
}