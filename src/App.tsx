// src/App.tsx

import { useState, useCallback, useEffect } from 'react';
import type { Player, BoardState, GameStatus, Position, GameMode } from './types/game';
import { checkWin, checkDraw, createEmptyBoard } from './utils/gameLogic';
import { calculateNextMove } from './utils/aiLogic';
import Board from './components/Board';
import StatusMessage from './components/StatusMessage';
import ModeSelector from './components/ModeSelector';
import ColorSelector from './components/ColorSelector';
import './index.css';

const App = () => {
  // --- 状態管理 ---
  const [board, setBoard] = useState<BoardState>(createEmptyBoard());
  const [currentPlayer, setCurrentPlayer] = useState<Player>('Black');
  const [gameStatus, setGameStatus] = useState<GameStatus>('Playing');
  const [lastMove, setLastMove] = useState<Position | null>(null);

  const [gameMode, setGameMode] = useState<GameMode>('PvE');
  const [playerColor, setPlayerColor] = useState<Player>('Black'); // プレイヤーの色（先手/後手）
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);

  // 盤面が空かどうか（色変更の許可判定などに使用）
  const isBoardEmpty = board.flat().every(cell => cell === null);

  // --- ロジック ---
  const executeMove = useCallback((row: number, col: number) => {
    const newBoard = board.map((r, rIdx) =>
      rIdx === row ? r.map((c, cIdx) => (cIdx === col ? currentPlayer : c)) : r
    );

    setBoard(newBoard);
    setLastMove({ row, col });

    const move: Position = { row, col };
    if (checkWin(newBoard, move, currentPlayer)) {
      setGameStatus(currentPlayer === 'Black' ? 'BlackWins' : 'WhiteWins');
      return;
    }

    if (checkDraw(newBoard)) {
      setGameStatus('Draw');
      return;
    }

    setCurrentPlayer(prev => (prev === 'Black' ? 'White' : 'Black'));
  }, [board, currentPlayer]);

  const handleCellClick = useCallback((row: number, col: number) => {
    if (gameStatus !== 'Playing') return;
    if (board[row][col] !== null) return;

    // CPU思考中、またはPvEモードで「自分の番ではない」時はクリックを無効化
    if (isAiThinking || (gameMode === 'PvE' && currentPlayer !== playerColor)) {
      return;
    }

    executeMove(row, col);
  }, [board, gameStatus, isAiThinking, gameMode, currentPlayer, playerColor, executeMove]);

  // --- CPU自動実行パイプライン ---
  useEffect(() => {
    let isMounted = true;
    
    // すでに思考中なら何もしない（ガード）
    if (isAiThinking) return;

    if (gameMode === 'PvE' && currentPlayer !== playerColor && gameStatus === 'Playing') {
      setIsAiThinking(true);

      const timerId = setTimeout(() => {
        if (!isMounted) return;

        const nextMove = calculateNextMove(board);
        
        if (nextMove) {
          executeMove(nextMove.row, nextMove.col);
        }
        
        setIsAiThinking(false);
      }, 600);

      return () => {
        isMounted = false;
        clearTimeout(timerId);
      };
    }
    // 【修正】isAiThinking を依存配列から削除
  }, [currentPlayer, gameMode, playerColor, gameStatus]);

  // --- UIヘルパー ---
  const resetGame = useCallback(() => {
    setBoard(createEmptyBoard());
    setCurrentPlayer('Black');
    setGameStatus('Playing');
    setLastMove(null);
    setIsAiThinking(false);
  }, []);

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
        <ModeSelector 
          gameMode={gameMode} 
          onModeChange={handleModeChange} 
        />
        
        <ColorSelector
          gameMode={gameMode}
          gameStatus={gameStatus}
          isBoardEmpty={isBoardEmpty}
          playerColor={playerColor}
          onColorChange={handleColorChange}
        />
      </div>

      <div className="mb-6 flex min-h-12 items-center justify-center rounded-full bg-white/50 px-8 py-2 text-lg font-bold shadow-sm backdrop-blur-sm">
        <StatusMessage
          isAiThinking={isAiThinking}
          gameStatus={gameStatus}
          currentPlayer={currentPlayer}
          gameMode={gameMode}
          playerColor={playerColor}
        />
      </div>

      <Board 
        board={board} 
        onCellClick={handleCellClick} 
        lastMove={lastMove} 
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