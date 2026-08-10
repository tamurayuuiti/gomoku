const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID

// gtag.jsの型定義
declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: (...args: unknown[]) => void
  }
}

export function initializeAnalytics(): void {
  // 1. 測定IDがない、またはブラウザ環境でない場合は終了
  if (!GA_MEASUREMENT_ID || typeof window === 'undefined') {
    return
  }

  // 2. StrictModeやHMRによる重複実行を防止（すでにスクリプトがあれば終了）
  if (document.querySelector('script[src*="googletagmanager"]')) {
    return
  }

  // 3. dataLayerの初期化とgtag関数の定義
  window.dataLayer = window.dataLayer || []
  window.gtag = (...args: unknown[]) => {
    window.dataLayer.push(args)
  }

  // 4. スクリプトタグの動的挿入
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
  document.head.appendChild(script)

  // 5. 初期化コマンドの実行
  window.gtag('js', new Date())
  
  // 高度なSPA制御は行わずGA4の拡張計測機能に委ねる
  window.gtag('config', GA_MEASUREMENT_ID)
}