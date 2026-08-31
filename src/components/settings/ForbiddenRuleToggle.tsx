// src/components/ForbiddenRuleToggle.tsx
// 禁じ手ルールのON/OFFを切り替えるトグルスイッチコンポーネント。
// スイッチ行自体がラベルを兼ねるため、親コンポーネントは別途ラベルを付与しない。

interface ForbiddenRuleToggleProps {
  useForbiddenRule: boolean;
  onToggle: () => void;
}

const ForbiddenRuleToggle = ({ useForbiddenRule, onToggle }: ForbiddenRuleToggleProps) => {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={useForbiddenRule}
      aria-label={`禁じ手ルール: ${useForbiddenRule ? 'ON' : 'OFF'}`}
      className="flex w-full items-center justify-between py-2"
    >
      <span className="text-sm font-medium text-ink dark:text-zinc-200">
        禁じ手ルール
      </span>
      {/* スイッチ本体: ON 時は rose 系、OFF 時はグレー系で状態を示す */}
      <div
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          useForbiddenRule ? 'bg-rose-500' : 'bg-slate-300 dark:bg-zinc-600'
        }`}
      >
        <div
          className={`absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            useForbiddenRule ? 'translate-x-5.5' : 'translate-x-0.5'
          }`}
        />
      </div>
    </button>
  );
};

export default ForbiddenRuleToggle;