// src/components/ColorSelector.tsx
// プレイヤーが先手・後手を選択するためのコンポーネント。
// セクションラベルは親コンポーネントが付与する。
// 選択状態は石の色そのもので意味を表すため、石色ベースのスタイルを維持する。

import type { Player, GameMode } from '../types/game';

interface ColorSelectorProps {
  gameMode: GameMode;
  playerColor: Player;
  onColorChange: (color: Player) => void;
}

const ColorSelector = ({
  gameMode,
  playerColor,
  onColorChange,
}: ColorSelectorProps) => {
  if (gameMode !== 'PvE') return null;

  return (
    <div className="flex w-full rounded-full bg-surface p-1 shadow-sm ring-1 ring-board-frame/10 dark:ring-zinc-700">
      <button
        onClick={() => onColorChange('Black')}
        className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
          playerColor === 'Black'
            ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-700'
            : 'text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200'
        }`}
      >
        <span className="h-3 w-3 rounded-full border border-zinc-700 bg-zinc-900" />
        先手
      </button>
      <button
        onClick={() => onColorChange('White')}
        className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
          playerColor === 'White'
            ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-slate-200 dark:bg-zinc-200 dark:text-zinc-900 dark:ring-zinc-300'
            : 'text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200'
        }`}
      >
        <span className="h-3 w-3 rounded-full border border-slate-300 bg-white" />
        後手
      </button>
    </div>
  );
};

export default ColorSelector;