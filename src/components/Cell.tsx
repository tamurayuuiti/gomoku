// src/components/Cell.tsx
// 盤面の各マスを表すコンポーネント

import type { Player } from '../types/game';

interface CellProps {
  value: Player | null;
  onClick: () => void;
  isLastMove: boolean;
  isHoshi: boolean;
  row: number;
  col: number;
  boardSize: number;
  isForbidden: boolean;
}

const Cell = ({ value, onClick, isLastMove, isHoshi, row, col, boardSize, isForbidden }: CellProps) => {
  const isTop = row === 0;
  const isBottom = row === boardSize - 1;
  const isLeft = col === 0;
  const isRight = col === boardSize - 1;

  return (
    <div
      className={`relative flex aspect-square items-center justify-center sm:h-auto group ${
        isForbidden ? 'cursor-not-allowed' : 'cursor-pointer'
      }`}
      onClick={onClick}
    >
      {/* マスホバー時の視覚フィードバック（石が置かれていない場合のみ） */}
      {!value && (
        <div className="pointer-events-none absolute inset-[8%] rounded-full bg-amber-950/0 transition-colors duration-150 group-hover:bg-amber-950/10" />
      )}

      {/* 十字線の描画（端は半分だけ伸ばして盤の枠に揃える） */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div 
          className={`absolute h-px bg-amber-950/70 
            ${isLeft ? 'left-1/2 right-0' : isRight ? 'left-0 right-1/2' : 'left-0 right-0'}`} 
        />
        <div 
          className={`absolute w-px bg-amber-950/70 
            ${isTop ? 'top-1/2 bottom-0' : isBottom ? 'top-0 bottom-1/2' : 'top-0 bottom-0'}`} 
        />
      </div>

      {/* 星（目印） */}
      {isHoshi && !value && (
        <div className="z-0 h-1.5 w-1.5 rounded-full bg-amber-950/40" />
      )}

      {/* 禁じ手の視覚的エフェクト（ホバー時に赤いバツ印を表示） */}
      {isForbidden && !value && (
        <div className="absolute z-20 flex h-1/2 w-1/2 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex h-full w-full items-center justify-center rounded-full bg-rose-500/20 backdrop-blur-xs">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="h-3/4 w-3/4 text-rose-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        </div>
      )}

      {/* 石の描画 */}
      {value && (
        <div
        className={`z-10 flex h-[86%] w-[86%] items-center justify-center rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.35)] transition-transform duration-200 
            ${value === 'Black' 
            ? 'bg-zinc-900 bg-linear-to-br from-zinc-700 to-black'
            : 'border border-gray-300 bg-white bg-linear-to-br from-white to-slate-200'
            }`}
        >
          {/* 最後の一手の印 */}
          {isLastMove && (
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.9)]" />
          )}
        </div>
      )}
    </div>
  );
};

export default Cell;