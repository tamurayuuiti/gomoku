// src/components/ModeSelector.tsx
// ゲームモードを選択するためのコンポーネント

import type { GameMode } from '../types/game';

interface ModeSelectorProps {
  gameMode: GameMode;
  onModeChange: (mode: GameMode) => void;
}

const ModeSelector = ({ gameMode, onModeChange }: ModeSelectorProps) => {
  return (
    <div className="flex rounded-full bg-white p-1 shadow-sm ring-1 ring-board-frame/10">
      {(['PvP', 'PvE'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => onModeChange(mode)}
          className={`rounded-full px-5 py-2 text-sm font-bold transition-all ${
            gameMode === mode
              ? 'bg-board-frame text-amber-50 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {mode === 'PvP' ? '対人戦' : 'AI戦'}
        </button>
      ))}
    </div>
  );
};

export default ModeSelector;