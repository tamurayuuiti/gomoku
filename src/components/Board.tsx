// src/components/Board.tsx
// 盤面を表示するコンポーネント

import Cell from './Cell';
import type { BoardState } from '../types/game';
import { BOARD_SIZE } from '../utils/gameLogic';

interface BoardProps {
  board: BoardState;
  onCellClick: (row: number, col: number) => void;
}

const Board = ({ board, onCellClick }: BoardProps) => {
  return (
    <div className="gomoku-board select-none rounded-sm border-4 border-amber-900 p-2 shadow-2xl">
      <div
        className="grid border border-amber-900"
        style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))` }}
      >
        {board.map((row, rowIndex) =>
          row.map((cell, colIndex) => (
            <Cell
              key={`${rowIndex}-${colIndex}`}
              value={cell}
              onClick={() => onCellClick(rowIndex, colIndex)}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default Board;