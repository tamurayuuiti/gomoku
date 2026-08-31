// src/components/GameHeader.tsx
// 盤面直上で対局状態を一体表示するヘッダーコンポーネント。
//
// 責務:
//   - 左ゾーン: 手番（石色＋自分/AI 識別）または対局結果の表示
//   - 中ゾーン: 一時的ステータス（禁じ手警告＞AI思考中）の表示
//   - 右ゾーン: 手数の表示
//
// 注意:
//   - 警告＞思考中の一時ステータス表示優先順位を維持するため、
//     中ゾーンは警告と思考中のみを扱い、左ゾーンの結果表示を上書きしない。

import { AlertCircle } from 'lucide-react';
import type { GameStatus, Player, GameMode } from '@/types/game';

interface GameHeaderProps {
  forbiddenWarning: string | null;
  isAiThinking: boolean;
  gameStatus: GameStatus;
  currentPlayer: Player;
  gameMode: GameMode;
  /** PvE における人間プレイヤーの色 */
  playerColor: Player;
  /** 着手済みの石数（= 手数） */
  stoneCount: number;
}

// 黒白石を示す石ドット。手番表示と勝者表示で共用する。
const StoneDot = ({ player }: { player: Player }) => (
  <span
    className={`inline-block h-4 w-4 shrink-0 rounded-full border border-gray-400 shadow-sm ${
      player === 'Black' ? 'bg-zinc-900' : 'bg-white'
    }`}
  />
);

const GameHeader = ({
  forbiddenWarning,
  isAiThinking,
  gameStatus,
  currentPlayer,
  gameMode,
  playerColor,
  stoneCount,
}: GameHeaderProps) => {
  // 手数表示: 対局中は「第 N 手」（初手前は「第 – 手」）、
  // 終局時は「全 N 手」（結果ダイアログと文言を揃える）。
  const moveCountLabel =
    gameStatus === 'Playing'
      ? stoneCount === 0
        ? '第 – 手'
        : `第 ${stoneCount} 手`
      : `全 ${stoneCount} 手`;

  return (
    <div className="relative z-10 mb-4 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-board-frame/15 bg-white px-4 py-2 text-sm font-bold text-ink shadow-[0_6px_16px_-4px_rgba(44,38,32,0.25)] sm:px-6 sm:text-base dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
      {/* 左ゾーン: 手番または対局結果 */}
      <div className="flex shrink-0 items-center gap-2">
        {gameStatus === 'Playing' && (
          <>
            <StoneDot player={currentPlayer} />
            <span>{currentPlayer === 'Black' ? '黒' : '白'}</span>
            {gameMode === 'PvE' && (
              <span className="hidden text-xs font-semibold text-slate-400 sm:inline dark:text-zinc-500 sm:text-sm">
                {currentPlayer === playerColor ? '（あなた）' : '（AI）'}
              </span>
            )}
          </>
        )}
        {gameStatus === 'BlackWins' && (
          <>
            <StoneDot player="Black" />
            <span>黒の勝利</span>
          </>
        )}
        {gameStatus === 'WhiteWins' && (
          <>
            <StoneDot player="White" />
            <span>白の勝利</span>
          </>
        )}
        {gameStatus === 'Draw' && <span>引き分け</span>}
      </div>

      {/* 中ゾーン: 一時ステータス（警告＞思考中）。状態切替時に盤面が上下へ揺れないよう領域を常に確保する */}
      <div
        className="flex min-w-0 flex-1 items-center justify-center text-center"
        role="status"
        aria-live="polite"
      >
        {forbiddenWarning ? (
          <span className="flex items-center gap-2 text-rose-600 animate-in zoom-in duration-200 dark:text-rose-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {forbiddenWarning}
          </span>
        ) : isAiThinking ? (
          <span className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <svg
              className="h-5 w-5 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            AIが思考中...
          </span>
        ) : null}
      </div>

      {/* 右ゾーン: 手数 */}
      <div className="shrink-0 tabular-nums text-slate-500 dark:text-zinc-400">
        {moveCountLabel}
      </div>
    </div>
  );
};

export default GameHeader;