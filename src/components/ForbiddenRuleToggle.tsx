// src/components/ForbiddenRuleToggle.tsx
// 禁じ手ルールのON/OFFを切り替えるトグルボタンコンポーネント

import React from 'react';

interface ForbiddenRuleToggleProps {
  useForbiddenRule: boolean;
  disabled: boolean;
  onToggle: () => void;
}

const ForbiddenRuleToggle: React.FC<ForbiddenRuleToggleProps> = ({
  useForbiddenRule,
  disabled,
  onToggle,
}) => {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold shadow-sm ring-1 transition-all ${
        disabled
          ? 'cursor-not-allowed bg-white text-slate-300 ring-board-frame/10'
          : useForbiddenRule
          ? 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100'
          : 'bg-white text-slate-500 ring-board-frame/10 hover:text-slate-700'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full transition-colors ${
          disabled ? 'bg-slate-300' : useForbiddenRule ? 'bg-rose-500' : 'bg-slate-400'
        }`}
      />
      禁じ手ルール: {useForbiddenRule ? 'ON' : 'OFF'}
    </button>
  );
};

export default ForbiddenRuleToggle;