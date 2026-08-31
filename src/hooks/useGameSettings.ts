// src/hooks/useGameSettings.ts
// ゲーム設定の状態管理・永続化・変更ガード・保留/確定を担うカスタムフック。
//
// 責務:
//   - 4設定値の状態所有と初期化（loadSettings）
//   - 変更時の即時永続化（saveSettings）
//   - 対局中ガード判定（hasHumanMoved / isGameInProgress）
//   - 変更リクエストの受付（same-check / guard / pending）
//   - 確認ダイアログの確定・キャンセル
//
// 注意:
//   - 探索ロジック・盤面操作には一切関与しない。
//   - resetGame は App 側から安定コールバックとして受け取る。
//   - 設定値の意味・検証ロジックは変更しない。

import { useState, useCallback, useEffect } from 'react';
import type {
  Player,
  GameMode,
  AiLevel,
  GameStatus,
  PendingSettingChange,
} from '@/types/game';
import { loadSettings, saveSettings } from '@/utils/settingsStorage';

// ============================================================
// 型定義
// ============================================================

interface UseGameSettingsParams {
  /** 現在のゲーム状態（useGameLogic 由来） */
  gameStatus: GameStatus;
  /** 現在の石数（useGameLogic 由来） */
  stoneCount: number;
  /** 設定変更適用時のリセット処理（App 側で定義された安定コールバック） */
  resetGame: () => void;
}

interface UseGameSettingsReturn {
  // --- 設定値 ---
  gameMode: GameMode;
  playerColor: Player;
  useForbiddenRule: boolean;
  aiLevel: AiLevel;
  // --- 派生値 ---
  /** 対局中かつ人間が着手済みかどうか（リセットボタンのスタイル切替にも使用） */
  isGameInProgress: boolean;
  // --- 変更リクエスト（UI → フック） ---
  requestGameModeChange: (mode: GameMode) => void;
  requestPlayerColorChange: (color: Player) => void;
  requestForbiddenRuleToggle: () => void;
  requestAiLevelChange: (level: AiLevel) => void;
  // --- 確認ダイアログ関連 ---
  pendingSettingChange: PendingSettingChange | null;
  confirmSettingChange: () => void;
  cancelSettingChange: () => void;
}

// ============================================================
// カスタムフック
// ============================================================

export const useGameSettings = ({
  gameStatus,
  stoneCount,
  resetGame,
}: UseGameSettingsParams): UseGameSettingsReturn => {
  // 永続化設定の初期読み込み（初回レンダリング時のみ実行）。
  // 個別のゲーム設定状態はここから初期値を供給する。
  const [initialSettings] = useState(loadSettings);
  const [gameMode, setGameMode] = useState<GameMode>(initialSettings.gameMode);
  const [playerColor, setPlayerColor] = useState<Player>(initialSettings.playerColor);
  const [useForbiddenRule, setUseForbiddenRule] = useState<boolean>(initialSettings.useForbiddenRule);
  const [aiLevel, setAiLevel] = useState<AiLevel>(initialSettings.aiLevel);

  // 対局中に変更しようとして確認ダイアログを表示している設定変更。
  const [pendingSettingChange, setPendingSettingChange] = useState<PendingSettingChange | null>(null);

  // ゲーム設定の変更を永続化する。
  // 4 値のいずれかが変化した時点で即時書き込む（設定変更は低頻度操作のためデバウンス不要）。
  // 書き込み失敗時は saveSettings 内部で吸収され、ゲーム進行に影響しない。
  useEffect(() => {
    saveSettings({ gameMode, playerColor, useForbiddenRule, aiLevel });
  }, [gameMode, playerColor, useForbiddenRule, aiLevel]);

  // 対局中かつ人間が着手済みであれば、設定変更に確認ダイアログを挟む。
  // PvE後手のAI初手（自動着手）は人間の着手に含まず、確認なしでのリセットを許可する。
  const hasHumanMoved =
    gameMode === 'PvE' && playerColor === 'White'
      ? stoneCount >= 2
      : stoneCount >= 1;
  const isGameInProgress = gameStatus === 'Playing' && hasHumanMoved;

  const applyForbiddenRuleToggle = useCallback(() => {
    setUseForbiddenRule(prev => !prev);
    resetGame();
  }, [resetGame]);

  const applyPlayerColorChange = useCallback((color: Player) => {
    setPlayerColor(color);
    resetGame();
  }, [resetGame]);

  const applyGameModeChange = useCallback((mode: GameMode) => {
    setGameMode(mode);
    resetGame();
  }, [resetGame]);

  const applyAiLevelChange = useCallback((level: AiLevel) => {
    setAiLevel(level);
    resetGame();
  }, [resetGame]);

  const requestForbiddenRuleToggle = useCallback(() => {
    if (isGameInProgress) {
      setPendingSettingChange({ kind: 'forbiddenRule' });
    } else {
      applyForbiddenRuleToggle();
    }
  }, [isGameInProgress, applyForbiddenRuleToggle]);

  const requestPlayerColorChange = useCallback((color: Player) => {
    if (color === playerColor) return;
    if (isGameInProgress) {
      setPendingSettingChange({ kind: 'playerColor', color });
    } else {
      applyPlayerColorChange(color);
    }
  }, [playerColor, isGameInProgress, applyPlayerColorChange]);

  const requestGameModeChange = useCallback((mode: GameMode) => {
    if (mode === gameMode) return;
    if (isGameInProgress) {
      setPendingSettingChange({ kind: 'gameMode', mode });
    } else {
      applyGameModeChange(mode);
    }
  }, [gameMode, isGameInProgress, applyGameModeChange]);

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

  return {
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
  };
};