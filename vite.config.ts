import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    // MPA 構成: アプリ本体(index.html)に加え、禁じ手ガイド(guide/kinjite.html)を
    // ビルドエントリーとして出力する。guide/ 以下の HTML は public/(そのままコピー)と違い、
    // Vite による環境変数注入・モジュールバンドルの対象になる。
    // ガイドページを追加する際は、ここにエントリーを 1 行ずつ増やす。
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        kinjiteGuide: fileURLToPath(new URL('./guide/kinjite.html', import.meta.url)),
      },
    },
  },
})
