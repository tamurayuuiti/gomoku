// src/components/GameStatusPanel.tsx
// ゲームの状態を表示するコンポーネント

import React from 'react';
import { AlertCircle } from 'lucide-react';
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
          <AlertCircle className="h-5 w-5 shrink-0" />
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