// src/components/ModeSelector.tsx
// ゲームモードを選択するためのコンポーネント。
// セクションラベルは親コンポーネントが付与し、選択状態は共通ボタンクラスで表現する。

import type { GameMode } from '@/types/game';

interface ModeSelectorProps {
  gameMode: GameMode;
  onModeChange: (mode: GameMode) => void;
}

const ModeSelector = ({ gameMode, onModeChange }: ModeSelectorProps) => {
  return (
    <div className="flex w-full rounded-full bg-surface p-1 shadow-sm ring-1 ring-board-frame/10 dark:ring-zinc-700">
      {(['PvP', 'PvE'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => onModeChange(mode)}
          className={`flex-1 rounded-full px-5 py-2 text-sm font-bold transition-all ${
            gameMode === mode
              ? 'btn-primary'
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