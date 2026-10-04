// guide-src/components/blocks.tsx
// ガイドページ共通のブロック部品群。
// 責務: 図版ラッパー/注出し/練習問題/FAQ/CTA/コードブロックのマークアップ統一。
//
// 注意:
//   - クラス名は guide.css の既存定義を正典とする(新規スタイルは css 側へ追加)。
//   - 判定・計測等のロジックを持たない(純プレゼンテーション)。

import type { ReactElement, ReactNode } from 'react';

export const Figure = ({
  caption,
  strip = false,
  children,
}: {
  caption: string;
  strip?: boolean;
  children: ReactNode;
}): ReactElement => (
  <figure className={strip ? 'stripwrap' : 'boardwrap'}>
    <div className={strip ? 'boardfr sm' : 'boardfr'}>
      <div className="boardin">{children}</div>
    </div>
    <figcaption>{caption}</figcaption>
  </figure>
);

export const Legend = ({ children }: { children: ReactNode }): ReactElement => (
  <p className="legend">{children}</p>
);

export const Callout = ({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'ok';
  title: string;
  children: ReactNode;
}): ReactElement => (
  <div className={`callout${tone === 'info' ? '' : ` ${tone}`}`}>
    <span className="ct">{title}</span>
    {children}
  </div>
);

export const CodeBlock = ({ code }: { code: string }): ReactElement => (
  <pre>
    <code>{code}</code>
  </pre>
);

export interface QuizData {
  n: number;
  title: string;
  qtext: string;
  figure: ReactNode;
  verdict: string;
  ok: boolean;
  explanation: ReactNode;
}

export const Quiz = ({ q }: { q: QuizData }): ReactElement => (
  <div className="quiz" id={`q${q.n}`}>
    <h3>{`第${q.n}問:${q.title}`}</h3>
    <p className="qtext">{q.qtext}</p>
    {q.figure}
    <details className="qa">
      <summary>答えと解説を見る</summary>
      <div className="answer">
        <span className={`verdict ${q.ok ? 'ok' : 'ng'}`}>{q.verdict}</span>
        <p>{q.explanation}</p>
      </div>
    </details>
  </div>
);

export const FaqList = ({ items }: { items: { q: string; a: ReactNode }[] }): ReactElement => (
  <div className="faq">
    {items.map((it) => (
      <details className="qa" key={it.q}>
        <summary>{it.q}</summary>
        <div className="answer">
          <p>{it.a}</p>
        </div>
      </details>
    ))}
  </div>
);

export const Cta = ({
  title,
  desc,
  href,
  label,
  sub,
}: {
  title: string;
  desc: ReactNode;
  href: string;
  label: string;
  sub?: string;
}): ReactElement => (
  <div className="cta">
    <p className="t">{title}</p>
    <p className="d">{desc}</p>
    <a className="btn" href={href}>
      {label}
    </a>
    {sub ? <div className="sub">{sub}</div> : null}
  </div>
);

export const InlineCta = ({ href, label }: { href: string; label: string }): ReactElement => (
  <div className="inline-cta">
    <a className="btn" href={href}>
      {label}
    </a>
  </div>
);
