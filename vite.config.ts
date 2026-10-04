import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'

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
    // MPA 構成: アプリ本体(index.html)に加え、guide/ 配下の静的HTMLを
    // ビルドエントリーとして出力する。guide/*.html は build:guide(SSG)の生成物であり、
    // この設定評価時点でディスクに存在する分を自動列挙する(手動登録は不要)。
    // クリーン checkout 直後(guide/ 未生成)は ENOENT を避けて空集合とする。
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        ...Object.fromEntries(
          existsSync(fileURLToPath(new URL('./guide', import.meta.url)))
            ? readdirSync(fileURLToPath(new URL('./guide', import.meta.url)))
                .filter((f) => f.endsWith('.html'))
                .map((f) => [
                  `guide/${f.slice(0, -'.html'.length)}`,
                  fileURLToPath(new URL(`./guide/${f}`, import.meta.url)),
                ])
            : [],
        ),
      },
    },
  },
})
