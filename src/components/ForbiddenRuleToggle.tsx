// src/components/ForbiddenRuleToggle.tsx
// 禁じ手ルールのON/OFFを切り替えるトグルボタンコンポーネント

import React from 'react';

interface ForbiddenRuleToggleProps {
  useForbiddenRule: boolean;
  onToggle: () => void;
}

const ForbiddenRuleToggle: React.FC<ForbiddenRuleToggleProps> = ({
  useForbiddenRule,
  onToggle,
}) => {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold shadow-sm ring-1 transition-all ${
        useForbiddenRule
          ? 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-800'
          : 'bg-white text-slate-500 ring-board-frame/10 hover:text-slate-700 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full transition-colors ${
          useForbiddenRule ? 'bg-rose-500' : 'bg-slate-400 dark:bg-zinc-500'
        }`}
      />
      禁じ手ルール: {useForbiddenRule ? 'ON' : 'OFF'}
    </button>
  );
};

export default ForbiddenRuleToggle;