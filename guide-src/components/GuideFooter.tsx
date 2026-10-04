// guide-src/components/GuideFooter.tsx
// ガイド系ページ共通フッター。クロスリンクはアプリ側登録簿(src/content/registry.ts)から自動生成する。
//
// 責務:
//   - アプリ概要行と「他ガイドへのクロスリンク」「ガイド一覧への導線」を全ページ統一で提供する
//
// 注意:
//   - currentId に自分自身の id を渡す(自分へのセルフリンクを出さないため)。
//     ハブページは 'index' を渡す(カード一覧が本体のためクロスリンクは出さない)。

import { sortedContent } from '../../src/content/registry';
import type { ReactElement } from 'react';
import { appHref, guideHref } from '../layout';

export const GuideFooter = ({ currentId }: { currentId: string }): ReactElement => {
  const others = currentId === 'index' ? [] : sortedContent().filter((e) => e.id !== currentId);
  // クロスリンクは4件まで。それを超える場合はハブへ委譲し、フッターの散らかりを防ぐ(規約 = guide-src/README.md)
  const showList = others.length <= 4;

  return (
    <footer>
      <p>
        <a href={appHref()}>
          <b>Gomoku — 無料で遊べるAI対戦の五目並べ</b>
        </a>
        <br />
        対人戦・AI戦(4段階)/ 連珠ルール(禁じ手)対応 / 登録・インストール不要
      </p>
      {showList && others.length > 0 && (
        <nav aria-label="その他のガイド" className="footer-links">
          {others.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ' / '}
              <a href={e.path}>{e.title}</a>
            </span>
          ))}
        </nav>
      )}
      {currentId !== 'index' && (!showList || others.length > 0) && (
        <p className="footer-links">
          <a href={guideHref('index.html')}>ガイド一覧ですべて見る</a>
        </p>
      )}
    </footer>
  );
};
