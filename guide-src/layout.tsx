// guide-src/layout.tsx
// ガイド静的ページの <html> 骨子生成。
// 責務:
//   - meta/OGP/canonical/JSON-LD/ファビコンの統一出力
//   - 共通 CSS(guide.css)のインライン埋め込み(単一ファイル性を維持)
//   - アプリ本体と共通の GA4 初期化モジュールスクリプトの埋め込み
//
// 注意:
//   - 出力は静的HTML(ビルド時渲染)。クライアント JS は計測モジュールのみ。
//   - JSON-LD はページ側のデータを受け取るだけ(生成ロジックは pages/ が持つ)。

import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import css from './guide.css?inline';

export const APP_URL = 'https://gomoku-pink.vercel.app/';

export interface PageMeta {
  /** 出力ファイル名(guide/ 直下) */
  file: string;
  title: string;
  description: string;
  canonical: string;
  jsonLd: unknown[];
  /** OGP 画像(URL)。省略時はアプリ共通 ogp.png */
  ogImage?: string;
}

const GA_MODULE_SNIPPET = `
  // アプリ本体(src/utils/analytics.ts)と GA4 初期化ロジックを共有する。
  // VITE_GA_MEASUREMENT_ID 未設定時は initializeAnalytics が何もしない(silent no-op)。
  import { initializeAnalytics } from '../src/utils/analytics';

  initializeAnalytics();

  // ガイド → アプリへの CTA クリック計測(guide_cta_click)。
  // 同一ドメインへの遷移は GA4 標準のアウトバウンドクリック計測に含まれないため、明示的に送信する。
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!a || !window.gtag) return;
    const href = a.getAttribute('href') || '';
    if (href.includes('gomoku-pink.vercel.app/') && !href.includes('/guide/')) {
      window.gtag('event', 'guide_cta_click', {
        link_url: href,
        link_text: (a.textContent || '').trim().slice(0, 50),
      });
    }
  });
`;

export const renderPage = (meta: PageMeta, body: ReactElement): string => {
  const ogImage = meta.ogImage ?? `${APP_URL}ogp.png`;
  const jsonLdScripts = meta.jsonLd
    .map((doc) => `<script type="application/ld+json">${JSON.stringify(doc)}</script>`)
    .join('\n');
  const bodyHtml = renderToStaticMarkup(body);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${meta.title}</title>
<meta name="description" content="${meta.description}">
<link rel="canonical" href="${meta.canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${meta.canonical}">
<meta property="og:image" content="${ogImage}">
<meta property="og:site_name" content="五目並べ - 無料で遊べるAI対戦">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${APP_URL}favicon.svg">
${jsonLdScripts}
<style>${css}</style>
<script type="module">${GA_MODULE_SNIPPET}</script>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
};

export interface GuidePage {
  meta: PageMeta;
  body: ReactElement;
}

export const appHref = (path = ''): string => `${APP_URL}${path}`;

export const guideHref = (file: string): string => `${APP_URL}guide/${file}`;

export type { ReactNode };
