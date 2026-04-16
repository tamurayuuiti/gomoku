// src/App.tsx

import { useState, useCallback } from 'react';
import type { Player, BoardState, GameStatus, Position } from './types/game';
import { checkWin, checkDraw, createEmptyBoard } from './utils/gameLogic';
import Board from './components/Board';
import './index.css';

const App = () => {
  // 状態管理
  const [board, setBoard] = useState<BoardState>(createEmptyBoard());
  const [currentPlayer, setCurrentPlayer] = useState<Player>('Black');
  const [gameStatus, setGameStatus] = useState<GameStatus>('Playing');
  const [lastMove, setLastMove] = useState<Position | null>(null);

  // 石を置く処理
  const handleCellClick = useCallback((row: number, col: number) => {
    if (board[row][col] !== null || gameStatus !== 'Playing') {
      return;
    }

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
  }, [board, currentPlayer, gameStatus]);

  // ゲームをリセット
  const resetGame = () => {
    setBoard(createEmptyBoard());
    setCurrentPlayer('Black');
    setGameStatus('Playing');
    setLastMove(null);
  };

  const getStatusMessage = () => {
    switch (gameStatus) {
      case 'Playing':
        return (
          <span className="flex items-center gap-2">
            手番: 
            <span className={`inline-block h-4 w-4 rounded-full border border-gray-400 ${currentPlayer === 'Black' ? 'bg-zinc-900' : 'bg-white'}`} />
            {currentPlayer === 'Black' ? '黒' : '白'}
          </span>
        );
      case 'BlackWins': return '黒の勝利';
      case 'WhiteWins': return '白の勝利';
      case 'Draw': return '引き分け';
      default: return '';
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-200 p-4 font-sans text-slate-900">
      <header className="mb-8 text-center">
        <h1 className="mb-2 text-5xl font-black tracking-tighter text-amber-900 uppercase">
          Gomoku
        </h1>
        <div className="h-1 w-24 bg-amber-700 mx-auto rounded-full" />
      </header>

      <div className="mb-6 flex min-h-10 items-center justify-center px-6 py-2 bg-white/50 backdrop-blur-sm rounded-full shadow-sm text-lg font-bold">
        {getStatusMessage()}
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