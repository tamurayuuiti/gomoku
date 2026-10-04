// src/components/content/SiteFooter.tsx
// ホーム最下部のサイトフッター。登録簿からコンテンツリンクを自動列挙する。
//
// 責務:
//   - アプリ概要の1行とコンテンツリンクの静的提示(SEO 内部リンク兼用)
//
// 注意:
//   - リンクは登録簿順。コンテンツ追加時の追記作業は不要(登録簿が単一ソース)。

import { sortedContent } from '@/content/registry';

const SiteFooter = () => {
  const entries = sortedContent();

  return (
    <footer className="mt-10 w-full max-w-[min(92vw,600px)] border-t border-board-frame/10 pb-2 pt-5 text-center dark:border-zinc-800">
      <p className="text-xs font-semibold text-slate-400 dark:text-zinc-500">
        Gomoku — 無料で遊べるAI対戦のブラウザ五目並べ。対人戦・AI戦(4段階)・連珠ルール(禁じ手)対応
      </p>
      <nav aria-label="フッター" className="mt-1.5 text-[11px] text-slate-400/90 dark:text-zinc-600">
        {entries.map((entry, i) => (
          <span key={entry.id}>
            {i > 0 && <span className="mx-1.5 opacity-60">/</span>}
            <a
              href={entry.path}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-4 transition-colors hover:text-slate-600 dark:hover:text-zinc-400"
            >
              {entry.title}
            </a>
          </span>
        ))}
      </nav>
    </footer>
  );
};

export default SiteFooter;
