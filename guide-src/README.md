# guide-src/ — ガイド静的ページの生成源(SSG)

ビルド: `npm run build:guide`(=`vite build --ssr` → `node .guide-build/main.js`)。
出力: `guide/*.html`(gitignore 対象=生成物。`npm run build` の連鎖で常に再生成される)。

## テンプレート規約(コンテンツ追加手順)

1. **登録簿へ追加**: `src/content/registry.ts` の `CONTENT_REGISTRY` にエントリ追加
   (id/title/description/category/path/order)。アプリのホームカード・ガイドハブ・
   各ガイドのクロスリンク・サイトフッターへ**自動的に反映**される(単一ソース)
2. **ページ作成**: `pages/<id>.tsx` を新設し、`GuidePage { meta, body }` を返す関数を export する
   - body は `<TopBar />` で始め、`<GuideFooter currentId="<id>" />` で終わる(共通航行の強制)
   - 見出し階層は h1(ページ)→ h2(セクション)→ h3。セクション id は `#s1…` 形式で安定させる(外部からの deep link 参照先になり得る)
   - 図版は `components/BoardDiagram.tsx`(BoardDiagram/StripDiagram)のみを使用する
     (石配置の意味=検証ハーネス `knowledge/gomoku/tools/verify_rules.py` で機械検証すること)
   - meta.jsonLd は Article/FAQPage/Breadcrumb/CollectionPage から該当するものを付与する
3. **エントリー登録**: `main.tsx` の pages 配列へ追加
4. **sitemap**: `public/sitemap.xml` へ URL 追加(lastmod 更新)
5. **検証**: `npm run build` 緑 / 検証ハーネス全 PASS / 新規ページの構造チェック
   (meta・OGP・JSON-LD・TopBar/GuideFooter 存在)

## 構成

| パス | 役割 |
|---|---|
| `main.tsx` | ビルドエントリー(全ページ渲染→guide/ へ書出) |
| `layout.tsx` | `<html>` 骨子(meta/OGP/JSON-LD/共通CSS/GAモジュール)と `renderPage` |
| `guide.css` | ガイド共通スタイル(アプリのデザイントークンと視覚整合) |
| `components/BoardDiagram.tsx` | 盤面図/ライン図 SVG コンポーネント |
| `components/blocks.tsx` | Figure/Callout/Quiz/FaqList/Cta 等のブロック部品 |
| `components/TopBar.tsx` / `GuideFooter.tsx` | 全ページ共通の航行(登録簿駆動) |
| `pages/*.tsx` | ページ本体(hub=一覧、kinjite=禁じ手、kachikata=勝ち方) |

## 拡張時の表示ポリシー(散らかり防止)

- ホームのガイドカードは**上位4件まで**+「一覧を見る」(ハブへ)。5件目以降はハブが受け皿
- ガイドハブは**カテゴリ見出しごとにグループ化**(登録簿の category 駆動)
- 各ガイドのフッタークロスリンクは**他ガイド4件まで**。超過後は「ガイド一覧ですべて見る」1本に集約
- トップバーのナビは「ガイド一覧」1入口を維持(エントリ数によらず非拡散)。ドロップダウンメニューは
  静的HTMLでの焦点管理/a11y/SEO のコストに対し利得が薄いため不採用(検討記録 = work/home-content-hub.md)

## 注意

- `src/content/registry.ts` はアプリ(クライアント)と本 SSG(サーバー渲染)の**共有モジュール**。
  ブラウザ API への依存を禁止する(純粋データのみ)
- ガイド本文の事実記述はアプリ実装(`src/utils/gameLogic.ts` 等)と突合すること
- 生成物 `guide/*.html` を手編集しない(次回ビルドで消失する)
