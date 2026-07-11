// src/components/GameStatusPanel.tsx
// ゲームの状態を表示するコンポーネント

import React from 'react';
import StatusMessage from './StatusMessage';
import type { GameStatus, Player, GameMode } from '../types/game';

interface GameStatusPanelProps {
  forbiddenWarning: string | null;
  isAiThinking: boolean;
  gameStatus: GameStatus;
  currentPlayer: Player;
  gameMode: GameMode;
  playerColor: Player;
}

const GameStatusPanel: React.FC<GameStatusPanelProps> = ({
  forbiddenWarning,
  isAiThinking,
  gameStatus,
  currentPlayer,
  gameMode,
  playerColor,
}) => {
  return (
    <div className="relative z-10 mb-5 flex min-h-11 items-center justify-center rounded-full border border-board-frame/15 bg-white px-8 py-2 text-base font-bold text-ink shadow-[0_6px_16px_-4px_rgba(44,38,32,0.25)] sm:text-lg">
      {forbiddenWarning ? (
        <span className="flex items-center gap-2 text-rose-600 animate-in zoom-in duration-200">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          {forbiddenWarning}
        </span>
      ) : (
        <StatusMessage
          isAiThinking={isAiThinking}
          gameStatus={gameStatus}
          currentPlayer={currentPlayer}
          gameMode={gameMode}
          playerColor={playerColor}
        />
      )}
    </div>
  );
};

export default GameStatusPanel;