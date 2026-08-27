// src/App.tsx
// アプリ全体の構成と主要な状態管理を担当するコンテナコンポーネント

import type { Player, GameMode, AiLevel } from './types/game';
import { useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import { getForbiddenReasonMessage, checkForbiddenMove } from './utils/gameLogic';
import { AI_LEVEL_TABLE, DEFAULT_AI_LEVEL } from './utils/ai/constants';
import { useForbiddenMoves } from './hooks/useForbiddenMoves';
import { useGameLogic } from './hooks/useGameLogic';
import { useAiPlayer } from './hooks/useAiPlayer';
import Board from './components/Board';
import ModeSelector from './components/ModeSelector';
import ColorSelector from './components/ColorSelector';
import AiLevelSelector from './components/AiLevelSelector';
import ForbiddenRuleToggle from './components/ForbiddenRuleToggle';
import GameStatusPanel from './components/GameStatusPanel';
import SettingChangeConfirmDialog from './components/SettingChangeConfirmDialog';
import GameResultDialog from './components/GameResultDialog';
import { RotateCcw, Undo2 } from 'lucide-react';
import './index.css';

// 対局中に変更しようとして、確認待ちになっている設定変更の内容。
type PendingSettingChange =
  | { kind: 'forbiddenRule' }
  | { kind: 'playerColor'; color: Player }
  | { kind: 'gameMode'; mode: GameMode }
  | { kind: 'aiLevel'; level: AiLevel };

// 対局終了から結果ダイアログ表示までの遅延 [ms]。
const RESULT_DIALOG_DELAY_HUMAN_MS = 150;
const RESULT_DIALOG_DELAY_AI_MS = 250;

const App = () => {
  const {
    board,
    currentPlayer,
    gameStatus,
    lastMove,
    stoneCount,
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
  const [aiLevel, setAiLevel] = useState<AiLevel>(DEFAULT_AI_LEVEL);
  const [forbiddenWarning, setForbiddenWarning] = useState<string | null>(null);
  // 対局中に変更しようとして確認ダイアログを表示している設定変更。
  const [pendingSettingChange, setPendingSettingChange] = useState<PendingSettingChange | null>(null);
  
  // 結果ダイアログの表示制御状態。
  const [resultDialogVisible, setResultDialogVisible] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);

  // gameStatus の変化を検知して、Playing に戻った際にフラグをリセットする。
  // Effect 内での同期的な setState を避けるため、レンダー中に state を同期させる（React 推奨パターン）。
  const [prevGameStatus, setPrevGameStatus] = useState(gameStatus);
  if (gameStatus !== prevGameStatus) {
    setPrevGameStatus(gameStatus);
    if (gameStatus === 'Playing') {
      setResultDialogVisible(false);
      setResultDismissed(false);
    }
  }

  // 盤面が空かどうかは石数カウンターで O(1) 判定する。
  const isBoardEmpty = stoneCount === 0;

  // 盤面全体の禁じ手座標は表示専用（ホバー時の赤バツ）。
  // 描画後に非同期計算されるため、着手受理の判定には使用しない。
  const forbiddenMoves = useForbiddenMoves(board, currentPlayer, gameStatus, useForbiddenRule);

  const { isAiThinking, resetAiTurnState } = useAiPlayer({
    board,
    currentPlayer,
    gameStatus,
    gameMode,
    playerColor,
    aiLevel,
    useForbiddenRule,
    onMove: executeMove,
    minThinkDisplayMs: AI_LEVEL_TABLE[aiLevel].minThinkDisplayMs,
  });

  // 結果ダイアログの表示タイマー管理。
  // Playing 以外の状態になったら遅延後に自動表示する。
  useEffect(() => {
    if (gameStatus === 'Playing') return;

    // 最後の手が人間かどうかを判定
    // PvP の場合は両方人間なので常に HUMAN_MS を適用
    const isLastMoveByHuman = gameMode === 'PvP' || currentPlayer === playerColor;
    const delay = isLastMoveByHuman
      ? RESULT_DIALOG_DELAY_HUMAN_MS
      : RESULT_DIALOG_DELAY_AI_MS;

    const timer = setTimeout(() => {
      setResultDialogVisible(true);
    }, delay);
    return () => clearTimeout(timer);
  }, [gameStatus, gameMode, currentPlayer, playerColor]);

  // 結果ダイアログは、表示タイマー発火済み・未 dismiss・終局状態のときのみ開く。
  const isResultDialogOpen =
    resultDialogVisible && !resultDismissed && gameStatus !== 'Playing';

  // 結果ダイアログを閉じる。同一終局状態での再表示を防ぐため dismissed を記録する。
  const handleResultDismiss = useCallback(() => {
    setResultDismissed(true);
  }, []);

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

  // --- 設定変更（リセットして適用。対局中のみ確認ダイアログを挟む） ---
  // 対局中（石が置かれていて、かつ勝敗が決まっていない）の変更は確認を必要とする。
  // 対局前（盤面が空）や対局終了後は、そのまま即座にリセット適用する。
  const needsSettingChangeConfirm = gameStatus === 'Playing' && !isBoardEmpty;

  const applyForbiddenRuleToggle = useCallback(() => {
    setUseForbiddenRule(prev => !prev);
    resetGame();
  }, [resetGame]);

  const requestForbiddenRuleToggle = useCallback(() => {
    if (needsSettingChangeConfirm) {
      setPendingSettingChange({ kind: 'forbiddenRule' });
    } else {
      applyForbiddenRuleToggle();
    }
  }, [needsSettingChangeConfirm, applyForbiddenRuleToggle]);

  const applyPlayerColorChange = useCallback((color: Player) => {
    setPlayerColor(color);
    resetGame();
  }, [resetGame]);

  const requestPlayerColorChange = useCallback((color: Player) => {
    if (color === playerColor) return;
    if (needsSettingChangeConfirm) {
      setPendingSettingChange({ kind: 'playerColor', color });
    } else {
      applyPlayerColorChange(color);
    }
  }, [playerColor, needsSettingChangeConfirm, applyPlayerColorChange]);

  const applyGameModeChange = useCallback((mode: GameMode) => {
    setGameMode(mode);
    resetGame();
  }, [resetGame]);

  const requestGameModeChange = useCallback((mode: GameMode) => {
    if (mode === gameMode) return;
    if (needsSettingChangeConfirm) {
      setPendingSettingChange({ kind: 'gameMode', mode });
    } else {
      applyGameModeChange(mode);
    }
  }, [gameMode, needsSettingChangeConfirm, applyGameModeChange]);

  const applyAiLevelChange = useCallback((level: AiLevel) => {
    setAiLevel(level);
    resetGame();
  }, [resetGame]);

  const requestAiLevelChange = useCallback((level: AiLevel) => {
    if (level === aiLevel) return;
    if (needsSettingChangeConfirm) {
      setPendingSettingChange({ kind: 'aiLevel', level });
    } else {
      applyAiLevelChange(level);
    }
  }, [aiLevel, needsSettingChangeConfirm, applyAiLevelChange]);

  // 確認ダイアログで確定された保留中の設定変更を適用する。
  const confirmSettingChange = useCallback(() => {
    if (!pendingSettingChange) return;
    if (pendingSettingChange.kind === 'forbiddenRule') {
      applyForbiddenRuleToggle();
    } else if (pendingSettingChange.kind === 'playerColor') {
      applyPlayerColorChange(pendingSettingChange.color);
    } else if (pendingSettingChange.kind === 'aiLevel') {
      applyAiLevelChange(pendingSettingChange.level);
    } else {
      applyGameModeChange(pendingSettingChange.mode);
    }
    setPendingSettingChange(null);
  }, [
    pendingSettingChange,
    applyForbiddenRuleToggle,
    applyPlayerColorChange,
    applyAiLevelChange,
    applyGameModeChange,
  ]);

  // 確認ダイアログをキャンセルし、保留中の設定変更を破棄する。
  const cancelSettingChange = useCallback(() => {
    setPendingSettingChange(null);
  }, []);

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

      {/* 操作パネル：モード・禁じ手・AI レベル・色選択をひとつのツールバーとしてグルーピング */}
      <div className="mb-8 flex w-full max-w-[min(92vw,600px)] flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <ModeSelector
            gameMode={gameMode}
            onModeChange={requestGameModeChange}
          />
          <ForbiddenRuleToggle
            useForbiddenRule={useForbiddenRule}
            onToggle={requestForbiddenRuleToggle}
          />
        </div>
        {/* AI レベル選択は PvE モードのみ表示する */}
        {gameMode === 'PvE' && (
          <AiLevelSelector
            aiLevel={aiLevel}
            onLevelChange={requestAiLevelChange}
          />
        )}
        <ColorSelector
          gameMode={gameMode}
          playerColor={playerColor}
          onColorChange={requestPlayerColorChange}
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
          disabled={isAiThinking || !canUndo}
          className={`group flex items-center gap-2 rounded-full px-5 py-3 font-bold shadow-md transition-all ${
            isAiThinking || !canUndo
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

      {/* 対局中の設定変更確認ダイアログ */}
      <SettingChangeConfirmDialog
        open={pendingSettingChange !== null}
        onConfirm={confirmSettingChange}
        onCancel={cancelSettingChange}
      />

      {/* 対局終了時の結果ダイアログ */}
      <GameResultDialog
        open={isResultDialogOpen}
        gameStatus={gameStatus}
        gameMode={gameMode}
        playerColor={playerColor}
        stoneCount={stoneCount}
        aiLevel={aiLevel}
        onRematch={resetGame}
        onDismiss={handleResultDismiss}
      />
    </div>
  );
};

export default App;