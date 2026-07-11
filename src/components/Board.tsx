// src/components/Board.tsx
// 盤面全体を表すコンポーネント

import Cell from './Cell';
import type { BoardState, Position } from '../types/game';
import { BOARD_SIZE } from '../utils/gameLogic';

interface BoardProps {
  board: BoardState;
  onCellClick: (row: number, col: number) => void;
  lastMove: Position | null;
  forbiddenMoves: boolean[][];
}

const Board = ({ board, onCellClick, lastMove, forbiddenMoves }: BoardProps) => {
  // 星（Hoshi）の位置を判定（15x15、または19x19を想定した一般的な位置）
  const isHoshiPos = (r: number, c: number) => {
    const starIndices = [3, 7, 11]; // 0-indexed
    return starIndices.includes(r) && starIndices.includes(c);
  };

  return (
    <div className="w-full max-w-[min(92vw,600px)] rounded-md bg-board-frame p-0.75 shadow-[0_25px_60px_-15px_rgba(44,38,32,0.45)]">
      <div className="rounded-[3px] bg-board-frame-dark p-2 sm:p-3">
        <div className="gomoku-board rounded-sm p-2 shadow-[inset_0_2px_6px_rgba(0,0,0,0.25)] sm:p-3">
          <div
            className="grid select-none overflow-hidden rounded-xs"
            style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))` }}
          >
            {board.map((row, rowIndex) =>
              row.map((cell, colIndex) => (
                <Cell
                  key={`${rowIndex}-${colIndex}`}
                  value={cell}
                  row={rowIndex}
                  col={colIndex}
                  boardSize={BOARD_SIZE}
                  isHoshi={isHoshiPos(rowIndex, colIndex)}
                  isLastMove={lastMove?.row === rowIndex && lastMove?.col === colIndex}
                  isForbidden={forbiddenMoves[rowIndex][colIndex]}
                  onClick={() => onCellClick(rowIndex, colIndex)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Board;