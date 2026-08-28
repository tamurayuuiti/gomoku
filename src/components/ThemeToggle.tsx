// src/components/ThemeToggle.tsx
// テーマ切り替えボタンコンポーネント。
//
// 三態循環（system → light → dark → system）でテーマ設定を切り替える。
// アイコンは現在の preference を示す:
//   - system: Monitor（OS 設定に追従中）
//   - light:  Sun（ライト固定）
//   - dark:   Moon（ダーク固定）

import { Sun, Moon, Monitor } from 'lucide-react';
import type { ThemePreference, ResolvedTheme } from '../hooks/useTheme';

interface ThemeToggleProps {
  /** 現在のテーマ設定（永続化対象） */
  preference: ThemePreference;
  /** 解決済みの表示テーマ（ボタンの配色に使用） */
  resolvedTheme: ResolvedTheme;
  /** クリック時に設定を循環的に切り替える */
  onCycle: () => void;
}

/** preference に対応する aria-label 文案 */
const ARIA_LABELS: Record<ThemePreference, string> = {
  system: 'テーマ: システム設定に追従中。クリックでライトモードに固定',
  light: 'テーマ: ライトモード。クリックでダークモードに固定',
  dark: 'テーマ: ダークモード。クリックでシステム設定に追従',
};

const ThemeToggle = ({ preference, resolvedTheme, onCycle }: ThemeToggleProps) => {
  return (
    <button
      onClick={onCycle}
      aria-label={ARIA_LABELS[preference]}
      title={ARIA_LABELS[preference]}
      className={`rounded-full p-2 shadow-sm ring-1 transition-all duration-200 ${
        resolvedTheme === 'dark'
          ? 'text-amber-300 ring-amber-300/20 hover:bg-amber-300/10'
          : 'text-slate-500 ring-board-frame/10 hover:bg-board-frame/5'
      }`}
    >
      {preference === 'system' && (
        <Monitor className="h-5 w-5" strokeWidth={2} />
      )}
      {preference === 'light' && (
        <Sun className="h-5 w-5" strokeWidth={2} />
      )}
      {preference === 'dark' && (
        <Moon className="h-5 w-5" strokeWidth={2} />
      )}
    </button>
  );
};

export default ThemeToggle;