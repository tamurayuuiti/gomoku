// src/components/GameResultDialog.tsx
// 対局終了（勝敗または引き分け確定）時に結果を表示するダイアログ。
// 結果を明示し、次のアクション（再対局・盤面確認）へ誘導する。

import React, { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import type { GameStatus, GameMode, Player, AiLevel } from '../types/game';
import { AI_LEVEL_TABLE } from '../utils/ai/constants';

interface GameResultDialogProps {
  /** ダイアログを表示するかどうか */
  open: boolean;
  /** 現在のゲーム状態。open=true 時は 'Playing' 以外であることを呼び出し元が保証する */
  gameStatus: GameStatus;
  gameMode: GameMode;
  /** PvE における人間プレイヤーの色 */
  playerColor: Player;
  /** 対局終了時点の総手数 */
  stoneCount: number;
  /** PvE 時の AI レベル（サブテキスト表示用） */
  aiLevel: AiLevel;
  /** 「もう一度対局する」: 対局をリセットする */
  onRematch: () => void;
  /** 「盤面を確認する」/ 背景クリック / Escape: ダイアログを閉じる */
  onDismiss: () => void;
}

const GameResultDialog: React.FC<GameResultDialogProps> = ({
  open,
  gameStatus,
  gameMode,
  playerColor,
  stoneCount,
  aiLevel,
  onRematch,
  onDismiss,
}) => {
  // 表示中のみ Escape キーで閉じられるようにする。
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onDismiss]);

  if (!open) return null;

  // 勝者をゲーム状態から導出する。引き分けは null。
  const winner: Player | null =
    gameStatus === 'BlackWins'
      ? 'Black'
      : gameStatus === 'WhiteWins'
        ? 'White'
        : null;

  // 見出しはモード別に出し分ける。PvE はプレイヤー視点の勝敗表現とする。
  const title = winner === null
    ? '引き分け'
    : gameMode === 'PvE'
      ? winner === playerColor
        ? 'あなたの勝利！'
        : 'AIの勝利'
      : winner === 'Black'
        ? '黒の勝利'
        : '白の勝利';

  // サブテキストは総手数＋PvE のみ AI レベルを併記する。
  const subText = gameMode === 'PvE'
    ? `全 ${stoneCount} 手 ｜ AIレベル: ${AI_LEVEL_TABLE[aiLevel].label}`
    : `全 ${stoneCount} 手`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 dark:bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-result-dialog-title"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow-board animate-in zoom-in-95 duration-150 dark:bg-zinc-800"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center">
          {/* 石アイコン：勝利時は勝者色の石、引き分けは黒白石を並べて表示 */}
          {winner === null ? (
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-zinc-900 bg-linear-to-br from-zinc-700 to-black shadow-[0_2px_4px_rgba(0,0,0,0.35)]" />
              <div className="h-6 w-6 rounded-full border border-gray-300 bg-white bg-linear-to-br from-white to-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.35)]" />
            </div>
          ) : (
            <div
              className={`h-12 w-12 rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.35)] ${
                winner === 'Black'
                  ? 'bg-zinc-900 bg-linear-to-br from-zinc-700 to-black'
                  : 'border border-gray-300 bg-white bg-linear-to-br from-white to-slate-200'
              }`}
            />
          )}
          <h2
            id="game-result-dialog-title"
            className="mt-4 text-2xl font-black text-ink dark:text-zinc-100"
          >
            {title}
          </h2>
          <p className="mt-2 text-sm text-ink/60 dark:text-zinc-400">{subText}</p>
        </div>
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={onRematch}
            autoFocus
            className="flex w-full items-center justify-center gap-2 rounded-full bg-board-frame px-5 py-3 font-bold text-amber-50 shadow-md transition-all hover:bg-board-frame-dark active:scale-95 dark:bg-amber-800 dark:text-amber-100"
          >
            <RotateCcw className="h-5 w-5" strokeWidth={3} />
            もう一度対局する
          </button>
          <button
            onClick={onDismiss}
            className="flex w-full items-center justify-center rounded-full bg-white px-5 py-3 font-bold text-board-frame ring-1 ring-board-frame/20 transition-all hover:bg-board-frame/5 active:scale-95 dark:bg-zinc-700 dark:text-zinc-200 dark:ring-zinc-600"
          >
            盤面を確認する
          </button>
        </div>
      </div>
    </div>
  );
};

export default GameResultDialog;