// src/components/ModeSelector.tsx
// ゲームモードを選択するためのコンポーネント

import type { GameMode } from '../types/game';

interface ModeSelectorProps {
  gameMode: GameMode;
  onModeChange: (mode: GameMode) => void;
}

const ModeSelector = ({ gameMode, onModeChange }: ModeSelectorProps) => {
  return (
    <div className="flex rounded-full bg-slate-300/60 p-1 shadow-inner">
      {(['PvP', 'PvE'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => onModeChange(mode)}
          className={`rounded-full px-6 py-2 text-sm font-bold transition-all ${
            gameMode === mode ? 'bg-white text-amber-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {mode === 'PvP' ? '対人戦' : 'CPU戦'}
        </button>
      ))}
    </div>
  );
};

export default ModeSelector;