// src/App.tsx

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Player, GameMode } from './types/game';
import { checkForbiddenMove, getForbiddenReasonMessage } from './utils/gameLogic';
import { calculateNextMove } from './utils/ai/search';
import { useForbiddenMoves } from './hooks/useForbiddenMoves';
import { useGameLogic } from './hooks/useGameLogic'; // 追加
import Board from './components/Board';
import ModeSelector from './components/ModeSelector';
import ColorSelector from './components/ColorSelector';
import ForbiddenRuleToggle from './components/ForbiddenRuleToggle';
import GameStatusPanel from './components/GameStatusPanel';
import './index.css';

const App = () => {
  // --- コアロジックの導入 ---
  const {
    board,
    currentPlayer,
    gameStatus,
    lastMove,
    executeMove: coreExecuteMove,
    resetGameLogic,
  } = useGameLogic();

  // --- UI・インタラクション状態 ---
  const [gameMode, setGameMode] = useState<GameMode>('PvE');
  const [playerColor, setPlayerColor] = useState<Player>('Black');
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);

  // 禁じ手設定と警告メッセージ
  const [useForbiddenRule, setUseForbiddenRule] = useState<boolean>(true);
  const [forbiddenWarning, setForbiddenWarning] = useState<string | null>(null);

  const isBoardEmpty = board.flat().every(cell => cell === null);

  // --- 禁じ手リストの事前計算 ---
  const forbiddenMoves = useForbiddenMoves(board, currentPlayer, gameStatus, useForbiddenRule);

  // --- UI層のイベントハンドラ ---
  const executeMove = useCallback((row: number, col: number) => {
    // UI側の警告をクリアし、コアロジックを実行
    setForbiddenWarning(null);
    coreExecuteMove(row, col);
  }, [coreExecuteMove]);

  const handleCellClick = useCallback((row: number, col: number) => {
    if (gameStatus !== 'Playing') return;
    if (board[row][col] !== null) return;
    if (isAiThinking || (gameMode === 'PvE' && currentPlayer !== playerColor)) {
      return;
    }

    if (useForbiddenRule && currentPlayer === 'Black') {
      const result = checkForbiddenMove(board, { row, col }, 'Black');
      if (result.isForbidden) {
        setForbiddenWarning(getForbiddenReasonMessage(result.reason));
        return;
      }
    }

    executeMove(row, col);
  }, [board, gameStatus, isAiThinking, gameMode, currentPlayer, playerColor, executeMove, useForbiddenRule]);

  // --- CPU自動実行パイプライン ---
  const isComputingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const isAiTurn =
      gameMode === 'PvE' &&
      currentPlayer !== playerColor &&
      gameStatus === 'Playing';

    if (!isAiTurn || isComputingRef.current) {
      return;
    }

    isComputingRef.current = true;
    setIsAiThinking(true);

    const timerId = setTimeout(() => {
      if (!isMounted) return;

      const nextMove = calculateNextMove(board, forbiddenMoves, currentPlayer);

      if (nextMove) {
        executeMove(nextMove.row, nextMove.col);
      }

      isComputingRef.current = false;
      setIsAiThinking(false);
    }, 600);

    return () => {
      isMounted = false;
      clearTimeout(timerId);
    };
  }, [
    board,
    currentPlayer,
    gameMode,
    playerColor,
    gameStatus,
    forbiddenMoves,
    executeMove
  ]);

  // --- UIヘルパー ---
  const resetGame = useCallback(() => {
    resetGameLogic();
    setIsAiThinking(false);
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-200 p-4 font-sans text-slate-900">
      <header className="mb-6 text-center">
        <h1 className="mb-2 text-5xl font-black tracking-tighter text-amber-900 uppercase">
          Gomoku
        </h1>
        <div className="mx-auto h-1 w-24 rounded-full bg-amber-700" />
      </header>

      <div className="flex flex-col gap-4 mb-8 items-center">
        <div className="flex flex-wrap justify-center gap-4">
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

      <button
        onClick={resetGame}
        className="group mt-10 flex items-center gap-2 rounded-full bg-amber-900 px-8 py-3 font-bold text-amber-50 shadow-lg transition-all hover:bg-amber-800 active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transition-transform group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        対局をリセット
      </button>
    </div>
  );
};

export default App;