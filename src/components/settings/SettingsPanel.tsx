// src/components/settings/SettingsPanel.tsx
// ゲーム設定（対戦モード・禁じ手・AIレベル・先手後手）を 1 つのカードに統合するパネル。
// カード全体がアコーディオン構造で、折りたたみ時は現在設定のサマリーを表示し、
// 展開時は各項目をセクションラベル付きで整列する。開閉状態はユーザーごとに永続化する。

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import type { GameMode, AiLevel, Player } from '@/types/game';
import { readItem, writeItem } from '@/utils/storage';
import { AI_LEVEL_TABLE } from '@/utils/ai/constants';
import ModeSelector from './ModeSelector';
import ForbiddenRuleToggle from './ForbiddenRuleToggle';
import AiLevelSelector from './AiLevelSelector';
import ColorSelector from './ColorSelector';

/** 開閉状態の localStorage キー */
const STORAGE_KEY = 'gomoku-settings-open';

/**
 * localStorage から保存された開閉状態を読み取る。
 * 値の検証のみを行い、例外吸収は readItem に委譲する。
 */
const readStoredOpenState = (): boolean | null => {
  const stored = readItem(STORAGE_KEY);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return null;
};

/**
 * 開閉状態を localStorage へ書き込む。
 * 例外吸収は writeItem に委譲する。
 */
const writeStoredOpenState = (open: boolean): void => {
  writeItem(STORAGE_KEY, String(open));
};

interface SettingsPanelProps {
  gameMode: GameMode;
  useForbiddenRule: boolean;
  aiLevel: AiLevel;
  playerColor: Player;
  onModeChange: (mode: GameMode) => void;
  onForbiddenRuleToggle: () => void;
  onAiLevelChange: (level: AiLevel) => void;
  onPlayerColorChange: (color: Player) => void;
}

const SettingsPanel = ({
  gameMode,
  useForbiddenRule,
  aiLevel,
  playerColor,
  onModeChange,
  onForbiddenRuleToggle,
  onAiLevelChange,
  onPlayerColorChange,
}: SettingsPanelProps) => {
  // 初期状態は折りたたみ。保存された状態がある場合のみ展開する。
  const [isOpen, setIsOpen] = useState<boolean>(() => readStoredOpenState() ?? false);

  // 開閉状態の変化を永続化する。
  useEffect(() => {
    writeStoredOpenState(isOpen);
  }, [isOpen]);

  const toggleOpen = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  // 折りたたみ時に表示する現在設定のサマリー。
  const summary = useMemo(() => {
    const forbiddenLabel = `禁じ手${useForbiddenRule ? 'ON' : 'OFF'}`;
    if (gameMode === 'PvP') {
      return `対人戦 ・ ${forbiddenLabel}`;
    }
    const levelLabel = AI_LEVEL_TABLE[aiLevel].label;
    const colorLabel = playerColor === 'Black' ? '先手' : '後手';
    return `AI戦 ・ ${levelLabel} ・ ${colorLabel} ・ ${forbiddenLabel}`;
  }, [gameMode, useForbiddenRule, aiLevel, playerColor]);

  return (
    <section className="card p-5">
      <h2>
        <button
          id="settings-panel-title"
          type="button"
          onClick={toggleOpen}
          aria-expanded={isOpen}
          aria-controls="settings-panel-content"
          className="flex w-full items-center gap-3 py-1 text-left"
        >
          <span className="section-label shrink-0">ゲーム設定</span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink/45 dark:text-zinc-500">
            {summary}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-ink/45 transition-transform duration-300 dark:text-zinc-500 ${
              isOpen ? 'rotate-180' : ''
            }`}
            strokeWidth={2.5}
          />
        </button>
      </h2>

      {/* grid-template-rows の 0fr / 1fr で開閉アニメーションを行う。
          内容高さの変化（PvE 専用項目の増減を含む）にも追従する */}
      <div
        id="settings-panel-content"
        role="region"
        aria-labelledby="settings-panel-title"
        inert={!isOpen}
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        {/* 折りたたみ用のクリップ領域。-mx-1 / px-1 でレイアウト位置は変えずに
            クリップ境界のみ左右 4px 外へ広げ、フル幅セレクタのリングや影が
            境界で切り落とされるのを防ぐ */}
        <div className="-mx-1 overflow-hidden px-1">
          {/* pb-1 で末尾項目の下端の影の逃げを確保する（折りたたみ時は一緒に畳まれる） */}
          <div className="space-y-4 pt-3 pb-1">
            {/* 対戦モード */}
            <div className="space-y-2">
              <p className="section-label">対戦モード</p>
              <ModeSelector gameMode={gameMode} onModeChange={onModeChange} />
            </div>

            {/* 禁じ手ルール（トグルスイッチ自体がラベルを兼ねる） */}
            <ForbiddenRuleToggle
              useForbiddenRule={useForbiddenRule}
              onToggle={onForbiddenRuleToggle}
            />

            {/* AI レベル（PvE モードのみ表示） */}
            {gameMode === 'PvE' && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <p className="section-label">AIレベル</p>
                <AiLevelSelector aiLevel={aiLevel} onLevelChange={onAiLevelChange} />
              </div>
            )}

            {/* 先手／後手（PvE モードのみ表示） */}
            {gameMode === 'PvE' && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <p className="section-label">先手／後手</p>
                <ColorSelector
                  gameMode={gameMode}
                  playerColor={playerColor}
                  onColorChange={onPlayerColorChange}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default SettingsPanel;