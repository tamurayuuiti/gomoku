// src/App.tsx

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { Player, BoardState, GameStatus, Position, GameMode } from './types/game';
import { BOARD_SIZE, checkWin, checkDraw, createEmptyBoard, checkForbiddenMove, getForbiddenReasonMessage } from './utils/gameLogic';
import { calculateNextMove } from './utils/aiLogic';
import Board from './components/Board';
import ModeSelector from './components/ModeSelector';
import ColorSelector from './components/ColorSelector';
import ForbiddenRuleToggle from './components/ForbiddenRuleToggle';
import GameStatusPanel from './components/GameStatusPanel';
import './index.css';

const App = () => {
  // --- 状態管理 ---
  const [board, setBoard] = useState<BoardState>(createEmptyBoard());
  const [currentPlayer, setCurrentPlayer] = useState<Player>('Black');
  const [gameStatus, setGameStatus] = useState<GameStatus>('Playing');
  const [lastMove, setLastMove] = useState<Position | null>(null);

  const [gameMode, setGameMode] = useState<GameMode>('PvE');
  const [playerColor, setPlayerColor] = useState<Player>('Black');
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);

  // 禁じ手設定と警告メッセージ
  const [useForbiddenRule, setUseForbiddenRule] = useState<boolean>(true);
  const [forbiddenWarning, setForbiddenWarning] = useState<string | null>(null);

  const isBoardEmpty = board.flat().every(cell => cell === null);

  // --- 禁じ手リストの事前計算 ---
  const forbiddenMoves = useMemo(() => {
    const matrix = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));

    // ルールがOFF、または現在の手番が白（禁じ手なし）の場合は計算不要
    if (gameStatus !== 'Playing' || !useForbiddenRule || currentPlayer !== 'Black') {
      return matrix;
    }

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === null) {
          const result = checkForbiddenMove(board, { row: r, col: c }, 'Black');
          if (result.isForbidden) {
            matrix[r][c] = true;
          }
        }
      }
    }
    return matrix;
  }, [board, currentPlayer, gameStatus, useForbiddenRule]);

  // --- ロジック ---
  const executeMove = useCallback((row: number, col: number) => {
    setForbiddenWarning(null);

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
  useEffect(() => {
    let isMounted = true;

    // 1. AIの番かどうかを判定
    const isAiTurn = 
      gameMode === 'PvE' &&
      currentPlayer !== playerColor &&
      gameStatus === 'Playing';

    // 2. AIの番、かつ、まだ考えていない（isAiThinking === false）ときだけ実行
    if (isAiTurn && !isAiThinking) {
      setIsAiThinking(true);

      const timerId = setTimeout(() => {
        if (!isMounted) return;

        const nextMove = calculateNextMove(board, forbiddenMoves, currentPlayer);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    board,
    currentPlayer,
    gameMode,
    playerColor,
    gameStatus,
    forbiddenMoves,
    executeMove
    // isAiThinking を外すことで、setIsAiThinking(true) による再実行を防ぐ
  ]);

  // --- UIヘルパー ---
  const resetGame = useCallback(() => {
    setBoard(createEmptyBoard());
    setCurrentPlayer('Black');
    setGameStatus('Playing');
    setLastMove(null);
    setIsAiThinking(false);
    setForbiddenWarning(null);
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