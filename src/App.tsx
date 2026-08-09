// src/App.tsx
// アプリ全体の構成と主要な状態管理を担当するコンテナコンポーネント

import type { Player, GameMode } from './types/game';
import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import { getForbiddenReasonMessage, checkForbiddenMove } from './utils/gameLogic';
import { useForbiddenMoves } from './hooks/useForbiddenMoves';
import { useGameLogic } from './hooks/useGameLogic';
import { useAiPlayer } from './hooks/useAiPlayer';
import Board from './components/Board';
import ModeSelector from './components/ModeSelector';
import ColorSelector from './components/ColorSelector';
import ForbiddenRuleToggle from './components/ForbiddenRuleToggle';
import GameStatusPanel from './components/GameStatusPanel';
import { RotateCcw, Undo2 } from 'lucide-react';
import './index.css';

const App = () => {
  const {
    board,
    currentPlayer,
    gameStatus,
    lastMove,
    canUndoOne,
    executeMove,
    undoOne,
    undoToPlayerTurn,
    canUndoToPlayerTurn,
    resetGameLogic,
  } = useGameLogic();

  // --- UI固有の状態 ---
  const [gameMode, setGameMode] = useState<GameMode>('PvE');
  const [playerColor, setPlayerColor] = useState<Player>('Black');
  const [useForbiddenRule, setUseForbiddenRule] = useState<boolean>(true);
  const [forbiddenWarning, setForbiddenWarning] = useState<string | null>(null);

  const isBoardEmpty = board.flat().every(cell => cell === null);

  // 盤面全体の禁じ手座標は表示専用（ホバー時の赤バツ）。
  // 描画後に非同期計算されるため、着手受理の判定には使用しない。
  const forbiddenMoves = useForbiddenMoves(board, currentPlayer, gameStatus, useForbiddenRule);

  const { isAiThinking, resetAiTurnState } = useAiPlayer({
    board,
    currentPlayer,
    gameStatus,
    gameMode,
    playerColor,
    useForbiddenRule,
    onMove: executeMove,
  });

  // PvP は 1 手単位で戻す。
  // PvE は人間の手番へ戻るまで復元し、人間の着手と相手の応手をまとめて取り消す。
  const canUndo = gameMode === 'PvE'
    ? canUndoToPlayerTurn(playerColor)
    : canUndoOne;

  // latest-ref パターンで handleCellClick の identity を安定化し、
  // memo 化された Cell に安全に渡す（ref は useLayoutEffect で更新）。
  // 禁じ手判定は checkForbiddenMove を使用し、forbiddenMoves は表示専用。
  const clickCtxRef = useRef({
    board,
    gameStatus,
    isAiThinking,
    currentPlayer,
    useForbiddenRule,
    executeMove,
  });

  useLayoutEffect(() => {
    clickCtxRef.current = {
      board,
      gameStatus,
      isAiThinking,
      currentPlayer,
      useForbiddenRule,
      executeMove,
    };
  }, [board, gameStatus, isAiThinking, currentPlayer, useForbiddenRule, executeMove]);

  const handleCellClick = useCallback((row: number, col: number) => {
    const {
      board: currentBoard,
      gameStatus: status,
      isAiThinking: aiThinking,
      currentPlayer: player,
      useForbiddenRule: forbiddenRule,
      executeMove: applyMove,
    } = clickCtxRef.current;

    if (status !== 'Playing') return;
    if (currentBoard[row][col] !== null) return;

    // AI思考中または対戦相手の手番時はクリックを無効化
    if (aiThinking || (gameMode === 'PvE' && player !== playerColor)) {
      return;
    }

    // 禁じ手チェック（黒番のみ）: 単一マスの直接判定が権威あるゲート
    if (forbiddenRule && player === 'Black') {
      const result = checkForbiddenMove(currentBoard, { row, col }, 'Black');
      if (result.isForbidden) {
        setForbiddenWarning(getForbiddenReasonMessage(result.reason));
        return;
      }
    }

    setForbiddenWarning(null);
    applyMove(row, col);
  }, [gameMode, playerColor]);

  const handleUndo = useCallback(() => {
    if (isAiThinking || !canUndo) return;

    const undone = gameMode === 'PvE'
      ? undoToPlayerTurn(playerColor)
      : undoOne();

    if (!undone) return;

    // Undo 後の AI ターン管理状態を初期化し、次の AI 手番で正しく再思考されるようにする。
    resetAiTurnState();
    setForbiddenWarning(null);
  }, [
    isAiThinking,
    canUndo,
    gameMode,
    playerColor,
    resetAiTurnState,
    undoOne,
    undoToPlayerTurn,
  ]);

  const resetGame = useCallback(() => {
    resetAiTurnState();
    resetGameLogic();
    setForbiddenWarning(null);
  }, [resetAiTurnState, resetGameLogic]);

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

  const isUndoDisabled = !canUndo || isAiThinking;

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

      {/* 対局操作：待ったとリセットを同一領域に配置 */}
      <div className="mt-8 flex w-full max-w-[min(92vw,600px)] flex-wrap items-center justify-center gap-3">
        <button
          onClick={handleUndo}
          disabled={isUndoDisabled}
          className={`group flex items-center gap-2 rounded-full px-5 py-3 font-bold shadow-md transition-all ${
            isUndoDisabled
              ? 'cursor-not-allowed bg-white text-board-frame/40 opacity-50 ring-1 ring-board-frame/10'
              : 'bg-white text-board-frame ring-1 ring-board-frame/20 hover:bg-board-frame/5 active:scale-95'
          }`}
        >
          <Undo2 className="h-5 w-5" strokeWidth={3} />
          待った
        </button>
        <button
          onClick={resetGame}
          className="group flex items-center gap-2 rounded-full bg-board-frame px-7 py-3 font-bold text-amber-50 shadow-md transition-all hover:bg-board-frame-dark active:scale-95"
        >
          <RotateCcw
            className="h-5 w-5 transition-transform duration-300 group-hover:rotate-180"
            strokeWidth={3}
          />
          対局をリセット
        </button>
      </div>
    </div>
  );
};

export default App;