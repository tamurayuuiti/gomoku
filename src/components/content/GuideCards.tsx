// src/components/content/GuideCards.tsx
// ホームのガイドカード一覧。content/registry.ts の登録簿から純粋に描画する。
//
// 責務:
//   - 登録簿エントリをカードグリッドとして表示(コンテンツ追加=登録簿追記のみで反映)
//
// 注意:
//   - ガイドは別ページ(同一ドメイン)のため新規タブで開く(盤面状態は非永続)。
//   - ゲームが主役の構成を壊さないよう、対局操作の下に静かなセクションとして配置する。

import { BookOpen, Swords } from 'lucide-react';
import { CATEGORY_LABEL, sortedContent } from '@/content/registry';
import type { ContentCategory } from '@/content/registry';

const CATEGORY_ICON: Record<ContentCategory, typeof BookOpen> = {
  rules: BookOpen,
  strategy: Swords,
};

const GuideCards = () => {
  const entries = sortedContent();

  return (
    <section
      aria-labelledby="guide-cards-label"
      className="mt-8 w-full max-w-[min(92vw,600px)]"
    >
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 id="guide-cards-label" className="section-label">
          ガイド
        </h2>
        <a
          href="/guide/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-bold text-slate-400 underline decoration-dotted underline-offset-4 transition-colors hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          一覧を見る
        </a>
      </div>
      {/* 表示は上位4件まで(それ以上はハブへ委譲=拡張時の散らかり防止) */}
      <div className="grid gap-3 sm:grid-cols-2">
        {entries.slice(0, 4).map((entry) => {
          const Icon = CATEGORY_ICON[entry.category];
          return (
            <a
              key={entry.id}
              href={entry.path}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${entry.title}(新規タブで開く)`}
              className="card group p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-12px_rgba(44,38,32,0.35)]"
            >
              <div className="flex items-center gap-2">
                <Icon
                  className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
                  strokeWidth={2.5}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink dark:text-zinc-100">
                  {entry.title}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
                {entry.description}
              </p>
              <span className="mt-2.5 inline-block rounded-full bg-board-frame/8 px-2 py-0.5 text-[10px] font-bold text-board-frame dark:bg-amber-200/10 dark:text-amber-200">
                {CATEGORY_LABEL[entry.category]}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
};

export default GuideCards;
