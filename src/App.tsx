// src/App.tsx
// アプリ全体の構成と主要な状態管理を担当するコンテナコンポーネント

import type { Player, GameMode, AiLevel } from './types/game';
import { useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import { getForbiddenReasonMessage, checkForbiddenMove } from './utils/gameLogic';
import { AI_LEVEL_TABLE } from './utils/ai/constants';
import { loadSettings, saveSettings } from './utils/settingsStorage';
import { useForbiddenMoves } from './hooks/useForbiddenMoves';
import { useGameLogic } from './hooks/useGameLogic';
import { useAiPlayer } from './hooks/useAiPlayer';
import { useTheme } from './hooks/useTheme';
import Board from './components/Board';
import SettingsPanel from './components/SettingsPanel';
import GameHeader from './components/GameHeader';
import SettingChangeConfirmDialog from './components/SettingChangeConfirmDialog';
import GameResultDialog from './components/GameResultDialog';
import ThemeToggle from './components/ThemeToggle';
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

  // テーマ管理（三態: light / dark / system）
  const { preference, resolvedTheme, cyclePreference } = useTheme();

  // --- UI固有の状態 ---
  // 永続化設定の初期読み込み（初回レンダリング時のみ実行）。
  // 個別のゲーム設定状態はここから初期値を供給する。
  const [initialSettings] = useState(loadSettings);
  const [gameMode, setGameMode] = useState<GameMode>(initialSettings.gameMode);
  const [playerColor, setPlayerColor] = useState<Player>(initialSettings.playerColor);
  const [useForbiddenRule, setUseForbiddenRule] = useState<boolean>(initialSettings.useForbiddenRule);
  const [aiLevel, setAiLevel] = useState<AiLevel>(initialSettings.aiLevel);
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

  // ゲーム設定の変更を永続化する。
  // 4 値のいずれかが変化した時点で即時書き込む（設定変更は低频操作のためデバウンス不要）。
  // 書き込み失敗時は saveSettings 内部で吸収され、ゲーム進行に影響しない。
  useEffect(() => {
    saveSettings({ gameMode, playerColor, useForbiddenRule, aiLevel });
  }, [gameMode, playerColor, useForbiddenRule, aiLevel]);

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
  // 設定変更の確認判定とリセットボタンの danger 表示判定で共用する。
  const isGameInProgress = gameStatus === 'Playing' && !isBoardEmpty;

  const applyForbiddenRuleToggle = useCallback(() => {
    setUseForbiddenRule(prev => !prev);
    resetGame();
  }, [resetGame]);

  const requestForbiddenRuleToggle = useCallback(() => {
    if (isGameInProgress) {
      setPendingSettingChange({ kind: 'forbiddenRule' });
    } else {
      applyForbiddenRuleToggle();
    }
  }, [isGameInProgress, applyForbiddenRuleToggle]);

  const applyPlayerColorChange = useCallback((color: Player) => {
    setPlayerColor(color);
    resetGame();
  }, [resetGame]);

  const requestPlayerColorChange = useCallback((color: Player) => {
    if (color === playerColor) return;
    if (isGameInProgress) {
      setPendingSettingChange({ kind: 'playerColor', color });
    } else {
      applyPlayerColorChange(color);
    }
  }, [playerColor, isGameInProgress, applyPlayerColorChange]);

  const applyGameModeChange = useCallback((mode: GameMode) => {
    setGameMode(mode);
    resetGame();
  }, [resetGame]);

  const requestGameModeChange = useCallback((mode: GameMode) => {
    if (mode === gameMode) return;
    if (isGameInProgress) {
      setPendingSettingChange({ kind: 'gameMode', mode });
    } else {
      applyGameModeChange(mode);
    }
  }, [gameMode, isGameInProgress, applyGameModeChange]);

  const applyAiLevelChange = useCallback((level: AiLevel) => {
    setAiLevel(level);
    resetGame();
  }, [resetGame]);

  const requestAiLevelChange = useCallback((level: AiLevel) => {
    if (level === aiLevel) return;
    if (isGameInProgress) {
      setPendingSettingChange({ kind: 'aiLevel', level });
    } else {
      applyAiLevelChange(level);
    }
  }, [aiLevel, isGameInProgress, applyAiLevelChange]);

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