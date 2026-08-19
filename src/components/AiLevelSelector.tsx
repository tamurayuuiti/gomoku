// src/components/AiLevelSelector.tsx
// AI の強さレベルを選択するためのコンポーネント

import type { AiLevel } from '../types/game';
import { AI_LEVELS, AI_LEVEL_TABLE } from '../utils/ai/constants';

interface AiLevelSelectorProps {
  aiLevel: AiLevel;
  onLevelChange: (level: AiLevel) => void;
}

const AiLevelSelector = ({ aiLevel, onLevelChange }: AiLevelSelectorProps) => {
  return (
    <div className="flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
        AIレベル
      </span>
      <div className="flex rounded-full bg-white p-1 shadow-sm ring-1 ring-board-frame/10">
        {AI_LEVELS.map((level) => (
          <button
            key={level}
            onClick={() => onLevelChange(level)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
              aiLevel === level
                ? 'bg-board-frame text-amber-50 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {AI_LEVEL_TABLE[level].label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default AiLevelSelector;