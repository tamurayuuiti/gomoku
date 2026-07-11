// src/App.tsx
// アプリ全体の構成と主要な状態管理を担当するコンテナコンポーネント

import type { Player, GameMode } from './types/game';
import { useState, useCallback } from 'react';
import { getForbiddenReasonMessage, checkForbiddenMove } from './utils/gameLogic';
import { useForbiddenMoves } from './hooks/useForbiddenMoves';
import { useGameLogic } from './hooks/useGameLogic';
import { useAiPlayer } from './hooks/useAiPlayer';
import Board from './components/Board';
import ModeSelector from './components/ModeSelector';
import ColorSelector from './components/ColorSelector';
import ForbiddenRuleToggle from './components/ForbiddenRuleToggle';
import GameStatusPanel from './components/GameStatusPanel';
import { RotateCcw } from 'lucide-react';
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

  // 盤面全体の禁じ手座標はここで一度だけ計算し、クリック時の判定にもそのまま利用する
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

    // 禁じ手チェック（黒番のみ）：useForbiddenMovesで事前計算済みの結果を参照
    if (useForbiddenRule && currentPlayer === 'Black' && forbiddenMoves[row][col]) {
      const result = checkForbiddenMove(board, { row, col }, 'Black');
      setForbiddenWarning(getForbiddenReasonMessage(result.reason));
      return;
    }

    executeMove(row, col);
  }, [board, gameStatus, isAiThinking, gameMode, currentPlayer, playerColor, executeMove, useForbiddenRule, forbiddenMoves]);

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
        <RotateCcw
          className="h-5 w-5 transition-transform duration-300 group-hover:rotate-180"
          strokeWidth={3}
        />
        対局をリセット
      </button>
    </div>
  );
};

export default App;