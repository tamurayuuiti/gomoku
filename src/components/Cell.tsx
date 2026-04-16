// src/components/Cell.tsx
// 盤面の各マスを表示するコンポーネント

import type { Player } from '../types/game';

interface CellProps {
  value: Player | null;
  onClick: () => void;
}

const Cell = ({ value, onClick }: CellProps) => {
  return (
    <div
      className="relative flex h-7 w-7 cursor-pointer items-center justify-center border border-amber-900/30 sm:h-10 sm:w-10"
      onClick={onClick}
    >
      {/* 交点の十字線 */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-px w-full bg-amber-900/60" />
        <div className="absolute h-full w-px bg-amber-900/60" />
      </div>

      {/* 石の描画 */}
      {value && (
        <div
          className={`z-10 h-5 w-5 rounded-full shadow-md sm:h-8 sm:w-8 ${
            value === 'Black'
              ? 'bg-zinc-900'
              : 'border border-gray-300 bg-slate-50'
          }`}
        />
      )}
    </div>
  );
};

export default Cell;