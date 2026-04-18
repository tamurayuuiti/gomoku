// src/components/StatusMessage.tsx
// ゲームの状態を表示するコンポーネント

import type { Player, GameStatus, GameMode } from '../types/game';

interface StatusMessageProps {
  isAiThinking: boolean;
  gameStatus: GameStatus;
  currentPlayer: Player;
  gameMode: GameMode;
  playerColor: Player;
}

const StatusMessage = ({
  isAiThinking,
  gameStatus,
  currentPlayer,
  gameMode,
  playerColor,
}: StatusMessageProps) => {
  if (isAiThinking) {
    return (
      <span className="flex items-center gap-2 text-amber-700">
        <svg className="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        CPUが思考中...
      </span>
    );
  }

  switch (gameStatus) {
    case 'Playing':
      return (
        <span className="flex items-center gap-2">
          手番: 
          <span className={`inline-block h-4 w-4 rounded-full border border-gray-400 ${currentPlayer === 'Black' ? 'bg-zinc-900' : 'bg-white'}`} />
          {currentPlayer === 'Black' ? '黒' : '白'}
          {gameMode === 'PvE' && (currentPlayer === playerColor ? ' (あなた)' : ' (CPU)')}
        </span>
      );
    case 'BlackWins': return '黒の勝利';
    case 'WhiteWins': return '白の勝利';
    case 'Draw': return '引き分け';
    default: return null;
  }
};

export default StatusMessage;