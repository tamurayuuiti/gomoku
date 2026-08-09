// src/hooks/useGameLogic.ts
// ゲームのコア進行ロジックを管理するカスタムフック。
//
// 責務:
//   - 盤面・手番・勝敗・直前手の管理
//   - 着手履歴の管理と局面復元
//   - 石数カウンターの管理（全盤走査の排除）
//   - executeMove / undoOne / undoToPlayerTurn の安定した identity 提供
//
// 注意:
//   - state の分割・勝敗・引き分け判定ロジックは変更しない。
//   - latest-ref はコミット後に更新し、イベントコールバック内でのみ読み出す。

import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import type { Player, BoardState, GameStatus, Position } from '../types/game';
import { BOARD_SIZE, checkWin, createEmptyBoard } from '../utils/gameLogic';

/**
 * 着手前の局面を保持するスナップショット。
 * Undo 時はこの単位で盤面・手番・ゲーム状態・直前手・石数を復元する。
 */
interface GameSnapshot {
  board: BoardState;
  currentPlayer: Player;
  gameStatus: GameStatus;
  lastMove: Position | null;
  stoneCount: number;
}

export const useGameLogic = () => {
  const [board, setBoard] = useState<BoardState>(createEmptyBoard());
  const [currentPlayer, setCurrentPlayer] = useState<Player>('Black');
  const [gameStatus, setGameStatus] = useState<GameStatus>('Playing');
  const [lastMove, setLastMove] = useState<Position | null>(null);
  const [stoneCount, setStoneCount] = useState<number>(0);
  const [history, setHistory] = useState<GameSnapshot[]>([]);

  // latest-ref: イベントコールバック内でのみ読み出す。
  // レンダー中ではなくコミット後に更新する。
  const stateRef = useRef({ board, currentPlayer, gameStatus, lastMove, stoneCount });
  const historyRef = useRef<GameSnapshot[]>([]);

  useLayoutEffect(() => {
    stateRef.current = { board, currentPlayer, gameStatus, lastMove, stoneCount };
  }, [board, currentPlayer, gameStatus, lastMove, stoneCount]);

  const applySnapshot = useCallback((snapshot: GameSnapshot) => {
    // ref の即時更新: Undo 直後の着手処理が復元済み状態から始まるようにする。
    stateRef.current = {
      board: snapshot.board,
      currentPlayer: snapshot.currentPlayer,
      gameStatus: snapshot.gameStatus,
      lastMove: snapshot.lastMove,
      stoneCount: snapshot.stoneCount,
    };
    setBoard(snapshot.board);
    setCurrentPlayer(snapshot.currentPlayer);
    setGameStatus(snapshot.gameStatus);
    setLastMove(snapshot.lastMove);
    setStoneCount(snapshot.stoneCount);
  }, []);

  const executeMove = useCallback((row: number, col: number) => {
    const {
      board: currentBoard,
      currentPlayer: player,
      gameStatus: currentStatus,
      lastMove: currentLastMove,
      stoneCount: currentStoneCount,
    } = stateRef.current;

    // ゲーム終了後の着手は受け付けない。
    if (currentStatus !== 'Playing') return;
    // 防御ガード: 埋まったマスへの着手（同一タスク内の二重適用など）を無視する。
    if (currentBoard[row][col] !== null) return;

    // 着手直前の局面を履歴として保存する。
    const snapshot: GameSnapshot = {
      board: currentBoard,
      currentPlayer: player,
      gameStatus: currentStatus,
      lastMove: currentLastMove,
      stoneCount: currentStoneCount,
    };

    const nextHistory = [...historyRef.current, snapshot];
    historyRef.current = nextHistory;
    setHistory(nextHistory);

    const newBoard = currentBoard.map((r, rIdx) =>
      rIdx === row ? r.map((c, cIdx) => (cIdx === col ? player : c)) : r
    );

    const move: Position = { row, col };
    const nextStoneCount = currentStoneCount + 1;

    let nextStatus: GameStatus | null = null;
    if (checkWin(newBoard, move, player)) {
      nextStatus = player === 'Black' ? 'BlackWins' : 'WhiteWins';
    } else if (nextStoneCount === BOARD_SIZE * BOARD_SIZE) {
      nextStatus = 'Draw';
    }

    const nextPlayer: Player = player === 'Black' ? 'White' : 'Black';

    // ref の即時更新: 再レンダー前に再度呼び出されても整合状態を保つ。
    stateRef.current = {
      board: newBoard,
      currentPlayer: nextStatus ? player : nextPlayer,
      gameStatus: nextStatus ?? 'Playing',
      lastMove: move,
      stoneCount: nextStoneCount,
    };

    setBoard(newBoard);
    setLastMove(move);
    setStoneCount(nextStoneCount);
    if (nextStatus) {
      setGameStatus(nextStatus);
    } else {
      setCurrentPlayer(nextPlayer);
    }
  }, []);

  const undoOne = useCallback((): boolean => {
    if (historyRef.current.length === 0) return false;
    const snapshot = historyRef.current[historyRef.current.length - 1];
    const nextHistory = historyRef.current.slice(0, -1);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    applySnapshot(snapshot);
    return true;
  }, [applySnapshot]);

  /**
   * 指定した手番の直前局面まで復元する。
   * PvE の人間側 Undo で、人間の着手と相手の応手をまとめて取り消すために使う。
   */
  const undoToPlayerTurn = useCallback((targetPlayer: Player): boolean => {
    const currentHistory = historyRef.current;
    for (let i = currentHistory.length - 1; i >= 0; i--) {
      const snapshot = currentHistory[i];
      if (
        snapshot.currentPlayer === targetPlayer &&
        snapshot.gameStatus === 'Playing'
      ) {
        const nextHistory = currentHistory.slice(0, i);
        historyRef.current = nextHistory;
        setHistory(nextHistory);
        applySnapshot(snapshot);
        return true;
      }
    }
    return false;
  }, [applySnapshot]);

  const canUndoToPlayerTurn = useCallback(
    (targetPlayer: Player): boolean =>
      history.some(
        snapshot =>
          snapshot.currentPlayer === targetPlayer &&
          snapshot.gameStatus === 'Playing'
      ),
    [history]
  );

  const resetGameLogic = useCallback(() => {
    const emptyBoard = createEmptyBoard();
    historyRef.current = [];
    setHistory([]);
    stateRef.current = {
      board: emptyBoard,
      currentPlayer: 'Black',
      gameStatus: 'Playing',
      lastMove: null,
      stoneCount: 0,
    };
    setBoard(emptyBoard);
    setCurrentPlayer('Black');
    setGameStatus('Playing');
    setLastMove(null);
    setStoneCount(0);
  }, []);

  return {
    board,
    currentPlayer,
    gameStatus,
    lastMove,
    stoneCount,
    canUndoOne: history.length > 0,
    executeMove,
    undoOne,
    undoToPlayerTurn,
    canUndoToPlayerTurn,
    resetGameLogic,
  };
};