// guide-src/main.tsx
// ガイド静的ページのビルドエントリー(vite --ssr build 後に node で実行)。
// 責務:
//   - 各ページ(meta+body)を静的HTMLへ渲染し guide/ へ書き出す
//
// 注意:
//   - 出力先はプロセス作業ディレクトリ(リポジトリルート)基準の guide/。
//   - 書き出し以外の副作用(ネットワーク・状態変更)を持たない。

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPage } from './layout';
import type { GuidePage } from './layout';
import { hubPage } from './pages/hub';
import { kinjitePage } from './pages/kinjite';
import { kachikataPage } from './pages/kachikata';

const outDir = join(process.cwd(), 'guide');
mkdirSync(outDir, { recursive: true });

const pages: GuidePage[] = [hubPage(), kinjitePage(), kachikataPage()];
for (const page of pages) {
  const html = renderPage(page.meta, page.body);
  writeFileSync(join(outDir, page.meta.file), html, 'utf-8');
  console.log(`guide/${page.meta.file}: ${html.length} chars`);
}
