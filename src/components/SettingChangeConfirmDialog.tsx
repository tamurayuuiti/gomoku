// src/components/SettingChangeConfirmDialog.tsx
// 対局中の設定変更時に表示する確認ダイアログ。
// 変更を適用すると現在の対局がリセットされることを伝え、確定またはキャンセルを選ばせる。

import React, { useEffect } from 'react';

interface SettingChangeConfirmDialogProps {
  /** ダイアログを表示するかどうか */
  open: boolean;
  /** 変更を確定し、対局をリセットして適用する */
  onConfirm: () => void;
  /** 変更を取り消し、ダイアログを閉じる */
  onCancel: () => void;
}

const SettingChangeConfirmDialog: React.FC<SettingChangeConfirmDialogProps> = ({
  open,
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setting-change-confirm-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow-[0_25px_60px_-15px_rgba(44,38,32,0.45)] animate-in zoom-in-95 duration-150"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="setting-change-confirm-title"
          className="text-lg font-black text-ink"
        >
          設定を変更しますか？
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink/70">
          対局中に変更を適用すると、現在の対局はリセットされます。
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-board-frame ring-1 ring-board-frame/20 transition-all hover:bg-board-frame/5 active:scale-95"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className="rounded-full bg-board-frame px-5 py-2.5 text-sm font-bold text-amber-50 shadow-md transition-all hover:bg-board-frame-dark active:scale-95"
          >
            変更する
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingChangeConfirmDialog;