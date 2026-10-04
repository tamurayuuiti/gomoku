// guide-src/components/BoardDiagram.tsx
// ガイド用 SVG 盤面図コンポーネント。
// 責務:
//   - 部分盤面(BoardDiagram)と 1 行ライン図(StripDiagram)の描画
//   - 石・注目点(赤リング)・禁じ手ポイント(赤×)・星の描画
//
// 注意:
//   - 描画意味(木目グラデーション/石のスペキュラ/マーカー形状)はアプリの
//     デザイントークン(index.css の board 色系)と視覚整合を保つ。
//   - グラデーション ID はモジュールカウンタで一意化し、1 ページ複数实例で衝突させない。
//   - 純粋描画のみ。判定ロジックを持たない(判定の正典は src/utils/gameLogic.ts)。

import type { ReactElement } from 'react';

export type StoneColor = 'B' | 'W';

/** 盤面セル位置 [row, col] */
export type CellPos = [number, number];

/** stones のキーは "row,col" 形式 */
export type StoneMap = Record<string, StoneColor>;

const WOOD_LIGHT = '#dfa85a';
const WOOD_DARK = '#c98f3f';
const LINE_COLOR = 'rgba(69,26,3,0.55)';
const HOSHI_COLOR = 'rgba(69,26,3,0.40)';
const ROSE = '#e11d48';
const ROSE_SOFT = 'rgba(244,63,94,0.18)';

let uidCounter = 0;
const nextUid = (prefix: string): string => {
  uidCounter += 1;
  return `${prefix}${uidCounter}`;
};

const posKey = (r: number, c: number): string => `${r},${c}`;

interface DefsProps {
  uid: string;
}

const Defs = ({ uid }: DefsProps): ReactElement => (
  <defs>
    <linearGradient id={`${uid}wood`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor={WOOD_LIGHT} />
      <stop offset="1" stopColor={WOOD_DARK} />
    </linearGradient>
    <radialGradient id={`${uid}black`} cx="0.35" cy="0.32" r="0.85">
      <stop offset="0" stopColor="#52525b" />
      <stop offset="0.55" stopColor="#27272a" />
      <stop offset="1" stopColor="#09090b" />
    </radialGradient>
    <radialGradient id={`${uid}white`} cx="0.35" cy="0.32" r="0.85">
      <stop offset="0" stopColor="#ffffff" />
      <stop offset="0.7" stopColor="#f1f5f9" />
      <stop offset="1" stopColor="#cbd5e1" />
    </radialGradient>
  </defs>
);

interface StoneProps {
  uid: string;
  x: number;
  y: number;
  r: number;
  color: StoneColor;
}

const Stone = ({ uid, x, y, r, color }: StoneProps): ReactElement => {
  const hx = x - r * 0.3;
  const hy = y - r * 0.35;
  if (color === 'B') {
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={`url(#${uid}black)`} stroke="rgba(0,0,0,0.35)" strokeWidth="0.5" />
        <ellipse
          cx={hx}
          cy={hy}
          rx={r * 0.32}
          ry={r * 0.2}
          fill="rgba(255,255,255,0.18)"
          transform={`rotate(-24 ${hx} ${hy})`}
        />
      </g>
    );
  }
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={`url(#${uid}white)`} stroke="#94a3b8" strokeWidth="0.8" />
      <ellipse
        cx={hx}
        cy={hy}
        rx={r * 0.3}
        ry={r * 0.18}
        fill="rgba(255,255,255,0.85)"
        transform={`rotate(-24 ${hx} ${hy})`}
      />
    </g>
  );
};

/** 注目点(次の着手候補): 赤いリング+中心ドット */
const StarMarker = ({ x, y, r }: { x: number; y: number; r: number }): ReactElement => (
  <g>
    <circle cx={x} cy={y} r={r * 0.72} fill={ROSE_SOFT} stroke={ROSE} strokeWidth="2.2" />
    <circle cx={x} cy={y} r={r * 0.18} fill={ROSE} />
  </g>
);

/** 禁じ手ポイント: アプリのホバー表示を模した赤× */
const ForbiddenMarker = ({ x, y, r }: { x: number; y: number; r: number }): ReactElement => {
  const s = r * 0.78;
  const k = s * 0.5;
  return (
    <g>
      <circle cx={x} cy={y} r={s} fill={ROSE_SOFT} stroke={ROSE} strokeWidth="1.6" opacity="0.95" />
      <g stroke={ROSE} strokeWidth="2.6" strokeLinecap="round">
        <line x1={x - k} y1={y - k} x2={x + k} y2={y + k} />
        <line x1={x + k} y1={y - k} x2={x - k} y2={y + k} />
      </g>
    </g>
  );
};

export interface BoardDiagramProps {
  size?: number;
  stones?: StoneMap;
  star?: CellPos | null;
  forbidden?: CellPos[];
  hoshi?: CellPos[];
  cell?: number;
  pad?: number;
  stoneScale?: number;
}

export const BoardDiagram = ({
  size = 9,
  stones = {},
  star = null,
  forbidden = [],
  hoshi = [],
  cell = 34,
  pad = 20,
  stoneScale = 0.8,
}: BoardDiagramProps): ReactElement => {
  const uid = nextUid('g');
  const w = pad * 2 + cell * (size - 1);
  const rStone = (cell * stoneScale) / 2;
  const at = (r: number, c: number): [number, number] => [pad + c * cell, pad + r * cell];

  const grid: ReactElement[] = [];
  for (let i = 0; i < size; i += 1) {
    const p = pad + i * cell;
    grid.push(<line key={`h${i}`} x1={pad} y1={p} x2={pad + cell * (size - 1)} y2={p} stroke={LINE_COLOR} strokeWidth="1" />);
    grid.push(<line key={`v${i}`} x1={p} y1={pad} x2={p} y2={pad + cell * (size - 1)} stroke={LINE_COLOR} strokeWidth="1" />);
  }

  return (
    <svg
      viewBox={`0 0 ${w} ${w}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      style={{ width: '100%', height: 'auto', display: 'block', borderRadius: '4px' }}
    >
      <Defs uid={uid} />
      <rect x="0" y="0" width={w} height={w} rx="4" fill={`url(#${uid}wood)`} />
      {grid}
      {hoshi.map(([r, c]) => {
        if (stones[posKey(r, c)]) return null;
        const [x, y] = at(r, c);
        return <circle key={`hs${r}-${c}`} cx={x} cy={y} r="2.4" fill={HOSHI_COLOR} />;
      })}
      {Object.entries(stones).map(([key, color]) => {
        const [r, c] = key.split(',').map(Number);
        const [x, y] = at(r, c);
        return <Stone key={`s${key}`} uid={uid} x={x} y={y} r={rStone} color={color} />;
      })}
      {star
        ? (() => {
            const [x, y] = at(star[0], star[1]);
            return <StarMarker x={x} y={y} r={rStone} />;
          })()
        : null}
      {forbidden.map(([r, c]) => {
        const [x, y] = at(r, c);
        return <ForbiddenMarker key={`f${r}-${c}`} x={x} y={y} r={rStone} />;
      })}
    </svg>
  );
};

/** 1 行ライン図のセル種別: null=空 / B / W / S=注目石 / T=急所マーカー / X=禁点 */
export type StripCell = null | 'B' | 'W' | 'S' | 'T' | 'X';

export interface StripDiagramProps {
  cells: StripCell[];
  cell?: number;
  pad?: number;
  stoneScale?: number;
}

export const StripDiagram = ({
  cells,
  cell = 34,
  pad = 14,
  stoneScale = 0.8,
}: StripDiagramProps): ReactElement => {
  const uid = nextUid('s');
  const n = cells.length;
  const w = pad * 2 + cell * (n - 1);
  const h = pad * 2 + cell;
  const rStone = (cell * stoneScale) / 2;
  const mid = h / 2;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      style={{ width: '100%', maxWidth: `${w}px`, height: 'auto', display: 'block', margin: '0 auto', borderRadius: '4px' }}
    >
      <Defs uid={uid} />
      <rect x="0" y="0" width={w} height={h} rx="4" fill={`url(#${uid}wood)`} />
      <line x1={pad} y1={mid} x2={pad + cell * (n - 1)} y2={mid} stroke={LINE_COLOR} strokeWidth="1" />
      {cells.map((c, i) => {
        const x = pad + i * cell;
        if (c === 'B' || c === 'W') return <Stone key={i} uid={uid} x={x} y={mid} r={rStone} color={c} />;
        if (c === 'S')
          return (
            <g key={i}>
              <Stone uid={uid} x={x} y={mid} r={rStone} color="B" />
              <circle cx={x} cy={mid} r={rStone * 0.72} fill="none" stroke={ROSE} strokeWidth="2.2" />
            </g>
          );
        if (c === 'T') return <StarMarker key={i} x={x} y={mid} r={rStone} />;
        if (c === 'X') return <ForbiddenMarker key={i} x={x} y={mid} r={rStone} />;
        return null;
      })}
    </svg>
  );
};
