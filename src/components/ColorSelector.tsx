// src/components/ColorSelector.tsx
// プレイヤーが先手・後手を選択するためのコンポーネント

import type { Player, GameStatus, GameMode } from '../types/game';

interface ColorSelectorProps {
  gameMode: GameMode;
  gameStatus: GameStatus;
  isBoardEmpty: boolean;
  playerColor: Player;
  onColorChange: (color: Player) => void;
}

const ColorSelector = ({
  gameMode,
  gameStatus,
  isBoardEmpty,
  playerColor,
  onColorChange,
}: ColorSelectorProps) => {
  if (gameMode !== 'PvE') return null;

  const isDisabled = gameStatus !== 'Playing' || !isBoardEmpty;

  return (
    <div className="flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">先手／後手</span>
      <div className="flex rounded-full bg-white p-1 shadow-sm ring-1 ring-board-frame/10">
        <button
          disabled={isDisabled}
          onClick={() => onColorChange('Black')}
          className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
            playerColor === 'Black' ? 'bg-zinc-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span className="h-3 w-3 rounded-full border border-zinc-700 bg-zinc-900" />
          先手
        </button>
        <button
          disabled={isDisabled}
          onClick={() => onColorChange('White')}
          className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
            playerColor === 'White' ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700'
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span className="h-3 w-3 rounded-full border border-slate-300 bg-white" />
          後手
        </button>
      </div>
    </div>
  );
};

export default ColorSelector;