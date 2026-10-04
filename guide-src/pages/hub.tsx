// guide-src/pages/hub.tsx
// ガイド一覧ハブページ(guide/index.html)。
// 責務:
//   - 登録簿(src/content/registry.ts)駆動で全ガイドの一覧カードを提供する
//   - 将来コンテンツが増えた際の「自然な着地先」として機能する(テンプレート規約 = guide-src/README.md)
//
// 注意:
//   - カード内容は登録簿が単一ソース。このファイルはレイアウトのみを持つ。

import { Cta } from '../components/blocks';
import { GuideFooter } from '../components/GuideFooter';
import { TopBar } from '../components/TopBar';
import { APP_URL, appHref } from '../layout';
import type { GuidePage } from '../layout';
import { CATEGORY_LABEL, sortedContent } from '../../src/content/registry';

const CANONICAL = `${APP_URL}guide/`;
const TITLE = '五目並べガイド一覧|ルールと勝ち方の図解まとめ';
const DESCRIPTION =
  '五目並べ(連珠)の図解ガイドを一覧で。ルール(禁じ手:三三・四四・長連)と勝ち方(四三・追い勝ち・練習ラダー)を、' +
  'すべて無料で読め、ブラウザ五目並べの実盤で確かめられます。';

const jsonLd = (): unknown[] => [
  {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: TITLE,
    description: DESCRIPTION,
    inLanguage: 'ja',
    url: CANONICAL,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: sortedContent().map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: e.title,
        url: `${APP_URL}${e.path.replace(/^\//, '')}`,
      })),
    },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '五目並べ', item: APP_URL },
      { '@type': 'ListItem', position: 2, name: 'ガイド一覧', item: CANONICAL },
    ],
  },
];

export const hubPage = (): GuidePage => ({
  meta: { file: 'index.html', title: TITLE, description: DESCRIPTION, canonical: CANONICAL, jsonLd: jsonLd() },
  body: (
    <div className="wrap">
      <TopBar />

      <div className="hero">
        <span className="kicker">ガイドハブ</span>
        <h1>
          五目並べ、
          <br />
          ガイド一覧。
          <span className="h1sub">ルールと勝ち方 —— 図解で読んで、実盤で確かめる</span>
        </h1>
        <p className="lead">
          このハブは、<b>無料で遊べるブラウザ五目並べ「Gomoku」</b>の解説コンテンツの入り口です。
          ルール(連珠の禁じ手)と勝ち方(四三・追い勝ち)の図解ガイドを公開中。
          すべてのガイドは、<b>読んだそのままを実盤で検証できる</b>のが特徴です。
        </p>
      </div>

      <div className="hubgrid">
        {sortedContent().map((e) => (
          <a key={e.id} className="hubcard" href={e.path}>
            <span className="cat">{CATEGORY_LABEL[e.category]}</span>
            <span className="t">{e.title}</span>
            <span className="d">{e.description}</span>
            <span className="go">読む →</span>
          </a>
        ))}
      </div>

      <Cta
        title="読んだら、そのまま実盤で。"
        desc={<>登録不要・無料のブラウザ五目並べ。<br />連珠ルール(禁じ手ON)・AI戦4段階がすぐ遊べます。</>}
        href={appHref()}
        label="五目並べを今すぐ遊ぶ"
        sub="インストール不要 / スマホ・PC対応"
      />

      <GuideFooter currentId="index" />
    </div>
  ),
});
