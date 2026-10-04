// src/content/registry.ts
// サイト全体で提供するコンテンツの登録簿(純粋データ=単一ソース)。
//
// 責務:
//   - ガイド及び将来のコンテンツのメタデータ(id/タイトル/説明/カテゴリ/パス/順序)を一括管理する
//   - ホームのガイドカード・ガイドハブ・ガイド間クロスリンクへ一覧データを提供する
//
// 注意:
//   - アプリ(クライアント)と guide-src(SSG)の双方から import されるため、
//     React / DOM / ブラウザ API への依存を持たない(純粋データとヘルパーのみ)。
//   - コンテンツ追加手順: ①この登録簿へエントリ追加 ②ガイドの場合は
//     guide-src/pages/ へページ追加+main.tsx 登録+public/sitemap.xml 追記
//     (手順の正典 = guide-src/README.md)。
//   - path はサイトルート相対で持つ(アプリ・ガイド双方が同一ドメインで配信されるため)。

/** コンテンツの種類。表示ラベルとアイコン選択に使用する */
export type ContentCategory = 'rules' | 'strategy';

export interface ContentEntry {
  /** 安定した識別子(クロスリンクの除外判定などに使用。変更しない) */
  id: string;
  title: string;
  description: string;
  category: ContentCategory;
  /** サイトルート相対パス */
  path: string;
  /** 表示順(昇番。10 間隔で将来挿入の余地を残す) */
  order: number;
}

export const CONTENT_REGISTRY: ContentEntry[] = [
  {
    id: 'kinjite',
    title: '五目並べの禁じ手 図解ガイド',
    description: '三三・四四・長連の判定基準と練習問題6選。禁じ手ポイントは実盤でホバーして確かめられます。',
    category: 'rules',
    path: '/guide/kinjite.html',
    order: 10,
  },
  {
    id: 'kachikata',
    title: '五目並べの勝ち方 図解ガイド',
    description: '四三と追い勝ちを図解。4段階AIを練習相手にとことん強くなる練習ラダー付き。',
    category: 'strategy',
    path: '/guide/kachikata.html',
    order: 20,
  },
];

export const CATEGORY_LABEL: Record<ContentCategory, string> = {
  rules: 'ルール',
  strategy: '戦略',
};

/** 表示順にソートした一覧(登録簿自体は変更しない) */
export const sortedContent = (): ContentEntry[] =>
  [...CONTENT_REGISTRY].sort((a, b) => a.order - b.order);
