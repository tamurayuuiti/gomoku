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

  // 石を置く処理
  const handleCellClick = useCallback((row: number, col: number) => {
    // すでに石が置かれている場合や、ゲームが終了している場合は何もしない
    if (board[row][col] !== null || gameStatus !== 'Playing') {
      return;
    }

    // 新しい盤面状態を作成
    const newBoard = board.map((r, rIdx) =>
      rIdx === row ? r.map((c, cIdx) => (cIdx === col ? currentPlayer : c)) : r
    );

    setBoard(newBoard);

    // 勝利判定
    const move: Position = { row, col };
    if (checkWin(newBoard, move, currentPlayer)) {
      setGameStatus(currentPlayer === 'Black' ? 'BlackWins' : 'WhiteWins');
      return;
    }

    // 引き分け判定
    if (checkDraw(newBoard)) {
      setGameStatus('Draw');
      return;
    }

    // プレイヤーの交代
    setCurrentPlayer(prev => (prev === 'Black' ? 'White' : 'Black'));
  }, [board, currentPlayer, gameStatus]);

  // ゲームをリセットする処理
  const resetGame = () => {
    setBoard(createEmptyBoard());
    setCurrentPlayer('Black');
    setGameStatus('Playing');
  };

  // 状態に応じたメッセージ
  const getStatusMessage = () => {
    switch (gameStatus) {
      case 'Playing':
        return `現在の手番: ${currentPlayer === 'Black' ? '黒' : '白'}`;
      case 'BlackWins':
        return '黒の勝利！';
      case 'WhiteWins':
        return '白の勝利！';
      case 'Draw':
        return '引き分け';
      default:
        return '';
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 p-4 font-sans">
      <h1 className="mb-6 text-4xl font-bold tracking-wider text-slate-800">
        五目並べ
      </h1>

      <div className="mb-4 h-8 text-xl font-semibold text-slate-700">
        {getStatusMessage()}
      </div>

      {/* 盤面コンポーネントの呼び出し */}
      <Board board={board} onCellClick={handleCellClick} />

      <button
        onClick={resetGame}
        className="mt-8 rounded-lg bg-indigo-600 px-6 py-2 font-medium text-white shadow-md transition-colors hover:bg-indigo-700"
      >
        最初からやり直す
      </button>
    </div>
  );
};

export default App;