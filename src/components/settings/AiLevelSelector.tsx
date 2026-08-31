// src/components/settings/AiLevelSelector.tsx
// AI の強さレベルを選択するためのコンポーネント。
// セクションラベルは親コンポーネントが付与し、選択状態は共通ボタンクラスで表現する。

import type { AiLevel } from '@/types/game';
import { AI_LEVELS, AI_LEVEL_TABLE } from '@/utils/ai/constants';

interface AiLevelSelectorProps {
  aiLevel: AiLevel;
  onLevelChange: (level: AiLevel) => void;
}

const AiLevelSelector = ({ aiLevel, onLevelChange }: AiLevelSelectorProps) => {
  return (
    <div className="flex w-full rounded-full bg-surface p-1 shadow-sm ring-1 ring-board-frame/10 dark:ring-zinc-700">
      {AI_LEVELS.map((level) => (
        <button
          key={level}
          onClick={() => onLevelChange(level)}
          className={`flex-1 rounded-full px-2 py-1.5 text-sm font-bold transition-all ${
            aiLevel === level
              ? 'btn-primary'
              : 'text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          {AI_LEVEL_TABLE[level].label}
        </button>
      ))}
    </div>
  );
};

export default AiLevelSelector;