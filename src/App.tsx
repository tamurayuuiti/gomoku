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
    if (isAiThinking) return;

    if (gameMode === 'PvE' && currentPlayer !== playerColor && gameStatus === 'Playing') {
      setIsAiThinking(true);

      const timerId = setTimeout(() => {
        if (!isMounted) return;

        // ここで board を直接参照して計算する
        const nextMove = calculateNextMove(board);
        
        if (nextMove) {
          executeMove(nextMove.row, nextMove.col);
        }
        
        setIsAiThinking(false);
      }, 600); // 0.6秒くらいがテンポ良く快適です

      return () => {
        isMounted = false;
        clearTimeout(timerId);
      };
    }
    // 【重要】依存配列を最小限にする。これらが変わった時だけ「AIの番か？」をチェックする
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
      resetGame(); // 色を変更したら対局をリセット
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
            {gameMode === 'PvE' && (currentPlayer === playerColor ? ' (あなた)' : ' (CPU)')}
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

      <div className="flex flex-col gap-4 mb-8 items-center">
        {/* モード切替 */}
        <div className="flex rounded-full bg-slate-300/60 p-1 shadow-inner">
          {(['PvP', 'PvE'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => handleModeChange(mode)}
              className={`rounded-full px-6 py-2 text-sm font-bold transition-all ${
                gameMode === mode ? 'bg-white text-amber-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {mode === 'PvP' ? '対人戦' : 'CPU戦'}
            </button>
          ))}
        </div>

        {/* プレイヤーの色選択（PvEモード時のみ有効） */}
        {gameMode === 'PvE' && (
          <div className="flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Your Color:</span>
            <div className="flex rounded-lg bg-slate-300/60 p-1 shadow-inner">
              <button
                disabled={gameStatus !== 'Playing' || !isBoardEmpty}
                onClick={() => handleColorChange('Black')}
                className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-bold transition-all ${
                  playerColor === 'Black' ? 'bg-zinc-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <span className="h-3 w-3 rounded-full bg-zinc-900 border border-zinc-700" />
                先手
              </button>
              <button
                disabled={gameStatus !== 'Playing' || !isBoardEmpty}
                onClick={() => handleColorChange('White')}
                className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-bold transition-all ${
                  playerColor === 'White' ? 'bg-white text-zinc-900 shadow-md' : 'text-slate-500 hover:text-slate-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <span className="h-3 w-3 rounded-full bg-white border border-slate-300" />
                後手
              </button>
            </div>
          </div>
        )}
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