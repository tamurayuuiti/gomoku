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
      className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold transition-all shadow-sm ${
        disabled
          ? 'opacity-50 cursor-not-allowed bg-slate-200 text-slate-400'
          : useForbiddenRule
          ? 'bg-rose-100 text-rose-700 border border-rose-200'
          : 'bg-slate-300/60 text-slate-500 border border-transparent hover:text-slate-700'
      }`}
    >
      <div
        className={`h-2 w-2 rounded-full ${
          useForbiddenRule ? 'bg-rose-500' : 'bg-slate-400'
        }`}
      />
      禁じ手ルール: {useForbiddenRule ? 'ON' : 'OFF'}
    </button>
  );
};

export default ForbiddenRuleToggle;