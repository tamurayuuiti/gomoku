// src/App.tsx
// アプリ全体の構成と主要な状態管理を担当するコンテナコンポーネント。

import { useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import { RotateCcw, Undo2 } from 'lucide-react';
import { getForbiddenReasonMessage, checkForbiddenMove } from '@/utils/gameLogic';
import { AI_LEVEL_TABLE } from '@/utils/ai/constants';
import { useAiPlayer } from '@/hooks/useAiPlayer';
import { useForbiddenMoves } from '@/hooks/useForbiddenMoves';
import { useGameLogic } from '@/hooks/useGameLogic';
import { useGameSettings } from '@/hooks/useGameSettings';
import { useTheme } from '@/hooks/useTheme';
import Board from '@/components/Board';
import SettingsPanel from '@/components/settings/SettingsPanel';
import GameHeader from '@/components/GameHeader';
import SettingChangeConfirmDialog from '@/components/SettingChangeConfirmDialog';
import GameResultDialog from '@/components/GameResultDialog';
import ThemeToggle from '@/components/ThemeToggle';
import './index.css';

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

  // テーマ管理（三態: light / dark / system）
  const { preference, resolvedTheme, cyclePreference } = useTheme();

  // --- UI固有の状態 ---
  const [forbiddenWarning, setForbiddenWarning] = useState<string | null>(null);

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

  // resetGame は useAiPlayer との循環依存を避けるため、ref 経由で resetAiTurnState を参照する。
  const resetAiTurnStateRef = useRef<() => void>(() => {});
  const resetGame = useCallback(() => {
    resetAiTurnStateRef.current();
    resetGameLogic();
    setForbiddenWarning(null);
  }, [resetGameLogic]);

  const {
    gameMode,
    playerColor,
    useForbiddenRule,
    aiLevel,
    isGameInProgress,
    requestGameModeChange,
    requestPlayerColorChange,
    requestForbiddenRuleToggle,
    requestAiLevelChange,
    pendingSettingChange,
    confirmSettingChange,
    cancelSettingChange,
  } = useGameSettings({ gameStatus, stoneCount, resetGame });

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

  // resetAiTurnState の参照を ref へ同期する（resetGame 経由で使用する）。
  useLayoutEffect(() => {
    resetAiTurnStateRef.current = resetAiTurnState;
  }, [resetAiTurnState]);

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

  return (
    <div className="flex min-h-screen flex-col items-center bg-transparent px-4 py-10 font-sans text-ink sm:py-14">
      {/* メインヘッダー: アプリタイトルとテーマ切替を統合する */}
      <header className="mb-6 flex w-full max-w-[min(92vw,600px)] items-center justify-between">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter text-board-frame dark:text-amber-200 sm:text-5xl">
            Gomoku
          </h1>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400 dark:text-zinc-500">
            五目並べ
          </p>
        </div>
        <ThemeToggle
          preference={preference}
          resolvedTheme={resolvedTheme}
          onCycle={cyclePreference}
        />
      </header>

      {/* 設定カード: モード・禁じ手・AIレベル・先後を 1 枚のカードに統合する */}
      <div className="mb-6 w-full max-w-[min(92vw,600px)]">
        <SettingsPanel
          gameMode={gameMode}
          useForbiddenRule={useForbiddenRule}
          aiLevel={aiLevel}
          playerColor={playerColor}
          onModeChange={requestGameModeChange}
          onForbiddenRuleToggle={requestForbiddenRuleToggle}
          onAiLevelChange={requestAiLevelChange}
          onPlayerColorChange={requestPlayerColorChange}
        />
      </div>

      {/* 対局エリア: ゲームヘッダーと盤面を一体化して視線を誘導 */}
      <div className="flex w-full max-w-[min(92vw,600px)] flex-col items-center">
        <GameHeader
          forbiddenWarning={forbiddenWarning}
          isAiThinking={isAiThinking}
          gameStatus={gameStatus}
          currentPlayer={currentPlayer}
          gameMode={gameMode}
          playerColor={playerColor}
          stoneCount={stoneCount}
        />
        <Board
          board={board}
          onCellClick={handleCellClick}
          lastMove={lastMove}
          forbiddenMoves={forbiddenMoves}
        />
      </div>

      {/* 対局操作: 待ったとリセットを盤面同幅の 2 列グリッドで並べる */}
      <div className="mt-4 grid w-full max-w-[min(92vw,600px)] grid-cols-2 gap-3">
        <button
          onClick={handleUndo}
          disabled={isAiThinking || !canUndo}
          className="btn-secondary flex items-center justify-center gap-2 px-3 py-3 text-sm font-bold transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-base"
        >
          <Undo2 className="h-5 w-5" strokeWidth={3} />
          待った
        </button>
        {/* リセットは対局中のみ danger 色で強調する（設定変更確認と同一の判定） */}
        <button
          onClick={resetGame}
          className={`group flex items-center justify-center gap-2 px-3 py-3 text-sm font-bold transition-all active:scale-95 sm:px-4 sm:text-base ${
            isGameInProgress ? 'btn-danger' : 'btn-primary'
          }`}
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
        pendingChange={pendingSettingChange}
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