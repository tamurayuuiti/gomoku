// guide-src/components/TopBar.tsx
// ガイド系ページ共通トップバー(ブランド+ガイド一覧+プレイCTA)。
// 責務: 全ガイドページで同一の航行を提供し、ページ側の実装揺れを防ぐ(テンプレート規約 = guide-src/README.md)。

import type { ReactElement } from 'react';
import { appHref, guideHref } from '../layout';

export const TopBar = (): ReactElement => (
  <div className="topbar">
    <a className="brand" href={appHref()}>
      Gomoku<small>五目並べ</small>
    </a>
    <div className="topbar-actions">
      <a className="toplink" href={guideHref('index.html')}>
        ガイド一覧
      </a>
      <a className="toplink" href={appHref()}>
        ▶ すぐ遊ぶ(無料)
      </a>
    </div>
  </div>
);
