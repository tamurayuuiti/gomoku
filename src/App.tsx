// src/App.tsx
// アプリ全体の構成と主要な状態管理を担当するコンテナコンポーネント

import type { Player, GameMode } from './types/game';
import { useState, useCallback } from 'react';
import { checkForbiddenMove, getForbiddenReasonMessage } from './utils/gameLogic';
import { useForbiddenMoves } from './hooks/useForbiddenMoves';
import { useGameLogic } from './hooks/useGameLogic';
import { useAiPlayer } from './hooks/useAiPlayer';
import Board from './components/Board';
import ModeSelector from './components/ModeSelector';
import ColorSelector from './components/ColorSelector';
import ForbiddenRuleToggle from './components/ForbiddenRuleToggle';
import GameStatusPanel from './components/GameStatusPanel';
import './index.css';

const App = () => {
  const {
    board,
    currentPlayer,
    gameStatus,
    lastMove,
    executeMove: coreExecuteMove,
    resetGameLogic,
  } = useGameLogic();

  // --- UI固有の状態 ---
  const [gameMode, setGameMode] = useState<GameMode>('PvE');
  const [playerColor, setPlayerColor] = useState<Player>('Black');
  const [useForbiddenRule, setUseForbiddenRule] = useState<boolean>(true);
  const [forbiddenWarning, setForbiddenWarning] = useState<string | null>(null);

  const isBoardEmpty = board.flat().every(cell => cell === null);

  const forbiddenMoves = useForbiddenMoves(board, currentPlayer, gameStatus, useForbiddenRule);

  const executeMove = useCallback((row: number, col: number) => {
    setForbiddenWarning(null);
    coreExecuteMove(row, col);
  }, [coreExecuteMove]);

  const { isAiThinking } = useAiPlayer({
    board,
    currentPlayer,
    gameStatus,
    gameMode,
    playerColor,
    forbiddenMoves,
    onMove: executeMove,
  });

  const handleCellClick = useCallback((row: number, col: number) => {
    if (gameStatus !== 'Playing') return;
    if (board[row][col] !== null) return;
    
    // AI思考中または対戦相手の手番時はクリックを無効化
    if (isAiThinking || (gameMode === 'PvE' && currentPlayer !== playerColor)) {
      return;
    }

    // 禁じ手チェック（黒番のみ）
    if (useForbiddenRule && currentPlayer === 'Black') {
      const result = checkForbiddenMove(board, { row, col }, 'Black');
      if (result.isForbidden) {
        setForbiddenWarning(getForbiddenReasonMessage(result.reason));
        return;
      }
    }

    executeMove(row, col);
  }, [board, gameStatus, isAiThinking, gameMode, currentPlayer, playerColor, executeMove, useForbiddenRule]);

  const resetGame = useCallback(() => {
    resetGameLogic();
    setForbiddenWarning(null);
  }, [resetGameLogic]);

  const handleModeChange = (mode: GameMode) => {
    if (mode !== gameMode) {
      setGameMode(mode);
      resetGame();
    }
  };

  const handleColorChange = (color: Player) => {
    if (color !== playerColor) {
      setPlayerColor(color);
      resetGame();
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-transparent px-4 py-10 font-sans text-ink sm:py-14">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-black uppercase tracking-tighter text-board-frame sm:text-5xl">
          Gomoku
        </h1>
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
          五目並べ
        </p>
      </header>

      {/* 操作パネル：モード・禁じ手・色選択をひとつのツールバーとしてグルーピング */}
      <div className="mb-8 flex w-full max-w-[min(92vw,600px)] flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <ModeSelector
            gameMode={gameMode}
            onModeChange={handleModeChange}
          />

          <ForbiddenRuleToggle
            useForbiddenRule={useForbiddenRule}
            disabled={!isBoardEmpty}
            onToggle={() => setUseForbiddenRule(!useForbiddenRule)}
          />
        </div>

        <ColorSelector
          gameMode={gameMode}
          gameStatus={gameStatus}
          isBoardEmpty={isBoardEmpty}
          playerColor={playerColor}
          onColorChange={handleColorChange}
        />
      </div>

      {/* 対局エリア：ステータスプレートと盤面を一体化して視線を誘導 */}
      <div className="flex w-full max-w-[min(92vw,600px)] flex-col items-center">
        <GameStatusPanel
          forbiddenWarning={forbiddenWarning}
          isAiThinking={isAiThinking}
          gameStatus={gameStatus}
          currentPlayer={currentPlayer}
          gameMode={gameMode}
          playerColor={playerColor}
        />

        <Board
          board={board}
          onCellClick={handleCellClick}
          lastMove={lastMove}
          forbiddenMoves={forbiddenMoves}
        />
      </div>

      <button
        onClick={resetGame}
        className="group mt-8 flex items-center gap-2 rounded-full bg-board-frame px-7 py-3 font-bold text-amber-50 shadow-md transition-all hover:bg-board-frame-dark active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transition-transform duration-300 group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        対局をリセット
      </button>
    </div>
  );
};

export default App;