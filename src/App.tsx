import { useState, useCallback } from 'react';
import type { Player, BoardState, GameStatus, Position } from './types/game';
import { checkWin, checkDraw, createEmptyBoard, BOARD_SIZE } from './utils/gameLogic';
import './index.css';

const App = () => {
  // 状態管理
  const [board, setBoard] = useState<BoardState>(createEmptyBoard());
  const [currentPlayer, setCurrentPlayer] = useState<Player>('Black');
  const [gameStatus, setGameStatus] = useState<GameStatus>('Playing');

  // 石を置く処理（メモ化して不要な再レンダリングを防止）
  const handleCellClick = useCallback((row: number, col: number) => {
    // すでに石が置かれている場合や、ゲームが終了している場合は何もしない
    if (board[row][col] !== null || gameStatus !== 'Playing') {
      return;
    }

    // 新しい盤面状態を作成（イミュータビリティを保持）
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

  // 状態に応じたメッセージの表示
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
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4 font-sans">
      <h1 className="text-4xl font-bold mb-6 text-slate-800 tracking-wider">五目並べ</h1>

      <div className="mb-4 text-xl font-semibold text-slate-700 h-8">
        {getStatusMessage()}
      </div>

      {/* 盤面の描画 */}
      <div className="gomoku-board p-2 rounded-sm shadow-2xl border-4 border-amber-900 select-none">
        <div
          className="grid border border-amber-900"
          style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))` }}
        >
          {board.map((row, rowIndex) =>
            row.map((cell, colIndex) => (
              <div
                key={`${rowIndex}-${colIndex}`}
                className="w-7 h-7 sm:w-10 sm:h-10 border border-amber-900/30 flex items-center justify-center cursor-pointer relative"
                onClick={() => handleCellClick(rowIndex, colIndex)}
              >
                {/* 交点の十字線をCSSで表現 */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-full h-px bg-amber-900/60" />
                  <div className="absolute h-full w-px bg-amber-900/60" />
                </div>

                {/* 石の描画 */}
                {cell && (
                  <div
                    className={`w-5 h-5 sm:w-8 sm:h-8 rounded-full z-10 shadow-md ${
                      cell === 'Black'
                        ? 'bg-zinc-900'
                        : 'bg-slate-50 border border-gray-300'
                    }`}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <button
        onClick={resetGame}
        className="mt-8 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-md transition-colors"
      >
        最初からやり直す
      </button>
    </div>
  );
};

export default App;