import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initializeAnalytics } from './utils/analytics'
import { initializeClarity } from './utils/clarity'

// アプリケーション描画前に各種Analyticsを初期化
initializeAnalytics()
initializeClarity()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)