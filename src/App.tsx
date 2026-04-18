// src/App.tsx

import { useState, useCallback, useEffect } from 'react';
import type { Player, BoardState, GameStatus, Position } from './types/game';
import { checkWin, checkDraw, createEmptyBoard } from './utils/gameLogic';
import { calculateNextMove } from './utils/aiLogic';
import Board from './components/Board';
import './index.css';

type GameMode = 'PvP' | 'PvE';

const App = () => {
  // --- 状態管理 ---
  const [board, setBoard] = useState<BoardState>(createEmptyBoard());
  const [currentPlayer, setCurrentPlayer] = useState<Player>('Black');
  const [gameStatus, setGameStatus] = useState<GameStatus>('Playing');
  const [lastMove, setLastMove] = useState<Position | null>(null);

  // 新規追加: モード管理とCPU思考状態
  const [gameMode, setGameMode] = useState<GameMode>('PvE'); // デフォルトをPvEに設定
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);

  // --- ロジック ---
  // 石を置くコア処理（人間もCPUも共通で使用し、ロジックを再利用）
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

  // ユーザーのクリックハンドラ（排他制御を追加）
  const handleCellClick = useCallback((row: number, col: number) => {
    if (gameStatus !== 'Playing') return;
    if (board[row][col] !== null) return;

    // CPU思考中、またはPvEモードでのCPU手番（白）はユーザー入力を完全にブロック
    if (isAiThinking || (gameMode === 'PvE' && currentPlayer === 'White')) {
      return;
    }

    executeMove(row, col);
  }, [board, gameStatus, isAiThinking, gameMode, currentPlayer, executeMove]);

  // --- CPU自動実行パイプライン ---
  useEffect(() => {
    let isMounted = true;
    if (isAiThinking) return;

    if (gameMode === 'PvE' && currentPlayer === 'White' && gameStatus === 'Playing') {
      setIsAiThinking(true);

      const timerId = setTimeout(() => {
        if (!isMounted) return;

        const nextMove = calculateNextMove(board);
        
        if (nextMove) {
          console.log(`CPU Move: row ${nextMove.row}, col ${nextMove.col}`);
          executeMove(nextMove.row, nextMove.col);
        }
        
        setIsAiThinking(false);
      }, 1000);

      return () => {
        isMounted = false;
        clearTimeout(timerId);
      };
    }
  }, [currentPlayer, gameMode, gameStatus, board, executeMove]);

  // --- UIヘルパー ---
  const resetGame = () => {
    setBoard(createEmptyBoard());
    setCurrentPlayer('Black');
    setGameStatus('Playing');
    setLastMove(null);
    setIsAiThinking(false);
  };

  const handleModeChange = (mode: GameMode) => {
    if (mode !== gameMode) {
      setGameMode(mode);
      resetGame(); // モード切替時は整合性を保つためリセット
    }
  };

  const getStatusMessage = () => {
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
      <header className="mb-6 text-center">
        <h1 className="mb-2 text-5xl font-black tracking-tighter text-amber-900 uppercase">
          Gomoku
        </h1>
        <div className="mx-auto h-1 w-24 rounded-full bg-amber-700" />
      </header>

      {/* モード切替UI */}
      <div className="mb-6 flex rounded-full bg-slate-300/60 p-1 shadow-inner">
        <button
          onClick={() => handleModeChange('PvP')}
          className={`rounded-full px-6 py-2 text-sm font-bold transition-all ${
            gameMode === 'PvP' ? 'bg-white text-amber-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          対人戦 (PvP)
        </button>
        <button
          onClick={() => handleModeChange('PvE')}
          className={`rounded-full px-6 py-2 text-sm font-bold transition-all ${
            gameMode === 'PvE' ? 'bg-white text-amber-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          CPU戦 (PvE)
        </button>
      </div>

      <div className="mb-6 flex min-h-12 items-center justify-center rounded-full bg-white/50 px-8 py-2 text-lg font-bold shadow-sm backdrop-blur-sm">
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