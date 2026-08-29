// src/components/SettingChangeConfirmDialog.tsx
// 対局中の設定変更時に表示する確認ダイアログ。
// 変更を適用すると現在の対局がリセットされることを伝え、確定またはキャンセルを選ばせる。

import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { PendingSettingChange } from '../types/game';
import { AI_LEVEL_TABLE } from '../utils/ai/constants';

interface SettingChangeConfirmDialogProps {
  /** ダイアログを表示するかどうか */
  open: boolean;
  /** 保留中の設定変更。タイトル生成に使う */
  pendingChange: PendingSettingChange | null;
  /** 変更を確定し、対局をリセットして適用する */
  onConfirm: () => void;
  /** 変更を取り消し、ダイアログを閉じる */
  onCancel: () => void;
}

// kind と変更先の値からダイアログタイトルを生成する。
const buildTitle = (change: PendingSettingChange): string => {
  switch (change.kind) {
    case 'forbiddenRule':
      return '禁じ手ルールを変更しますか？';
    case 'playerColor':
      return `先後を${change.color === 'Black' ? '先手' : '後手'}に変更しますか？`;
    case 'gameMode':
      return `対戦モードを${change.mode === 'PvP' ? '対人戦' : 'AI戦'}に変更しますか？`;
    case 'aiLevel':
      return `AIレベルを${AI_LEVEL_TABLE[change.level].label}に変更しますか？`;
  }
};

const SettingChangeConfirmDialog: React.FC<SettingChangeConfirmDialogProps> = ({
  open,
  pendingChange,
  onConfirm,
  onCancel,
}) => {
  // 表示中のみ Escape キーでキャンセルできるようにする。
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open || !pendingChange) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 dark:bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setting-change-confirm-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow-board animate-in zoom-in-95 duration-150 dark:bg-zinc-800"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 中央揃えゾーン: GameResultDialog と同一リズム（アイコン→mt-4タイトル→mt-2本文） */}
        <div className="flex flex-col items-center text-center">
          {/* 警告アイコンバッジ: 破壊的操作であることを一目で伝える */}
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <h2
            id="setting-change-confirm-title"
            className="mt-4 text-lg font-black text-ink dark:text-zinc-100"
          >
            {buildTitle(pendingChange)}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/70 dark:text-zinc-400">
            対局中に変更を適用すると、現在の対局はリセットされます。
          </p>
        </div>

        {/* ボタン: メイン画面の「待った／リセット」と同じ等幅2列グリッド */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            autoFocus
            className="btn-secondary flex items-center justify-center px-3 py-2.5 text-sm font-bold transition-all active:scale-95"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className="btn-danger flex items-center justify-center px-3 py-2.5 text-sm font-bold transition-all active:scale-95"
          >
            変更する
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingChangeConfirmDialog;