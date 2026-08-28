// src/components/ModeSelector.tsx
// ゲームモードを選択するためのコンポーネント

import type { GameMode } from '../types/game';

interface ModeSelectorProps {
  gameMode: GameMode;
  onModeChange: (mode: GameMode) => void;
}

const ModeSelector = ({ gameMode, onModeChange }: ModeSelectorProps) => {
  return (
    <div className="flex rounded-full bg-white p-1 shadow-sm ring-1 ring-board-frame/10 dark:bg-zinc-800 dark:ring-zinc-700">
      {(['PvP', 'PvE'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => onModeChange(mode)}
          className={`rounded-full px-5 py-2 text-sm font-bold transition-all ${
            gameMode === mode
              ? 'bg-board-frame text-amber-50 shadow-sm dark:bg-amber-800 dark:text-amber-100'
              : 'text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          {mode === 'PvP' ? '対人戦' : 'AI戦'}
        </button>
      ))}
    </div>
  );
};

export default ModeSelector;