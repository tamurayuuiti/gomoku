// src/utils/ai/evaluator.ts
// AIが盤面を評価するロジックを定義するファイル
//
// 責務:
//   - パターン検出 (getLineString / detectPattern)
//   - 位置評価   (evaluatePosition)
//   - 全盤評価   (evaluateBoard) … 葉ノード向け多重脅威評価
//   - 共有ユーティリティ (opponentOf / hasStoneNearby)

import type { BoardState, Player } from '../../types/game';
import type { PatternType, PatternCount } from './constants';
import { BOARD_SIZE } from '../gameLogic';
import { AI_SCORES, AI_CONFIG, DIRECTIONS, EVAL_CONFIG } from './constants';


// ============================================================
// 共有ユーティリティ
// ============================================================

/** 相手プレイヤーを返す */
export const opponentOf = (player: Player): Player =>
  player === 'Black' ? 'White' : 'Black';

/**
 * 指定セルの周辺（SEARCH_RANGE 以内）に石があるか判定。
 * 候補手生成・全盤評価での空セルフィルタリングに使用する。
 */
export const hasStoneNearby = (
  board: BoardState,
  row: number,
  col: number
): boolean => {
  const range = AI_CONFIG.SEARCH_RANGE;
  for (
    let r = Math.max(0, row - range);
    r <= Math.min(BOARD_SIZE - 1, row + range);
    r++
  ) {
    for (
      let c = Math.max(0, col - range);
      c <= Math.min(BOARD_SIZE - 1, col + range);
      c++
    ) {
      if (board[r][c] !== null) return true;
    }
  }
  return false;
};


// ============================================================
// パターン検出
// ============================================================

/**
 * 指定位置を中心とした 1 方向 9 セルの文字列を返す。
 *
 * 文字変換:
 *   '1' = color の石（または center = '1'）
 *   '0' = 空マス
 *   '2' = 盤外 / 相手石（壁扱い）
 *
 * centerChar を '2' にすると「ここに相手石が置かれた場合」の
 * after-state パターンとして利用できる。
 */
export const getLineString = (
  board: BoardState,
  row: number,
  col: number,
  dx: number,
  dy: number,
  color: Player,
  centerChar: string = '1'
): string => {
  let s = '';
  for (let i = -4; i <= 4; i++) {
    if (i === 0) {
      s += centerChar;
      continue;
    }
    const r = row + i * dx;
    const c = col + i * dy;

    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
      s += '2';
    } else if (board[r][c] === color) {
      s += '1';
    } else if (board[r][c] === null) {
      s += '0';
    } else {
      s += '2';
    }
  }
  return s;
};

/** 9 文字のライン文字列からパターン種別を判定する */
export const detectPattern = (s: string): PatternType => {
  if (s.includes('11111')) return 'WIN';

  if (s.includes('011110')) return 'OPEN_FOUR';

  if (
    s.includes('011112') || s.includes('211110') ||
    s.includes('10111') || s.includes('11011') || s.includes('11101')
  ) return 'CLOSED_FOUR';

  if (
    s.includes('011100') || s.includes('001110') ||
    s.includes('010110') || s.includes('011010')
  ) return 'OPEN_THREE';

  if (
    s.includes('001112') || s.includes('211100') ||
    s.includes('010112') || s.includes('211010') ||
    s.includes('011012') || s.includes('210110') ||
    s.includes('10011') || s.includes('11001') || s.includes('10101')
  ) return 'CLOSED_THREE';

  if (
    s.includes('001100') || s.includes('011000') || s.includes('000110') ||
    s.includes('010100') || s.includes('001010') || s.includes('010010')
  ) return 'OPEN_TWO';

  if (
    s.includes('000112') || s.includes('211000') ||
    s.includes('001012') || s.includes('210100') ||
    s.includes('010012') || s.includes('210010') ||
    s.includes('10001')
  ) return 'CLOSED_TWO';

  return 'SINGLE';
};


// ============================================================
// 位置評価
// ============================================================

/**
 * 指定位置への着手価値を playerColor の視点で返す。
 *
 * 評価フロー:
 *   1. 攻撃パターン（自分が置いた後）
 *   2. 相手 before パターン（相手の現在の脅威）
 *   3. 相手 after パターン（自分が置いた後の相手の脅威）
 *   → 即時評価 → 通常スコア加算
 */
export const evaluatePosition = (
  board: BoardState,
  row: number,
  col: number,
  playerColor: Player
): number => {
  const opponentColor = opponentOf(playerColor);

  const attackCounts: PatternCount = {
    WIN: 0, OPEN_FOUR: 0, CLOSED_FOUR: 0, OPEN_THREE: 0,
    CLOSED_THREE: 0, OPEN_TWO: 0, CLOSED_TWO: 0, SINGLE: 0,
  };
  const oppBeforeCounts: PatternCount = {
    WIN: 0, OPEN_FOUR: 0, CLOSED_FOUR: 0, OPEN_THREE: 0,
    CLOSED_THREE: 0, OPEN_TWO: 0, CLOSED_TWO: 0, SINGLE: 0,
  };
  const oppAfterCounts: PatternCount = {
    WIN: 0, OPEN_FOUR: 0, CLOSED_FOUR: 0, OPEN_THREE: 0,
    CLOSED_THREE: 0, OPEN_TWO: 0, CLOSED_TWO: 0, SINGLE: 0,
  };

  for (const [dx, dy] of DIRECTIONS) {
    const attackPtn = detectPattern(getLineString(board, row, col, dx, dy, playerColor, '1'));
    attackCounts[attackPtn]++;

    const beforePtn = detectPattern(getLineString(board, row, col, dx, dy, opponentColor, '1'));
    oppBeforeCounts[beforePtn]++;

    const afterPtn = detectPattern(getLineString(board, row, col, dx, dy, opponentColor, '2'));
    oppAfterCounts[afterPtn]++;
  }

  // --- 即時評価 ---
  if (attackCounts.WIN > 0) return AI_SCORES.WIN;

  if (oppBeforeCounts.WIN > 0 && oppAfterCounts.WIN === 0)
    return AI_SCORES.DEFEND_WIN;

  if (attackCounts.OPEN_FOUR > 0) return AI_SCORES.OPEN_FOUR;
  if (attackCounts.CLOSED_FOUR >= 2) return AI_SCORES.DOUBLE_FOUR;
  if (attackCounts.CLOSED_FOUR >= 1 && attackCounts.OPEN_THREE >= 1)
    return AI_SCORES.FOUR_THREE;

  if (
    oppBeforeCounts.OPEN_FOUR > 0 &&
    oppAfterCounts.OPEN_FOUR < oppBeforeCounts.OPEN_FOUR
  ) return AI_SCORES.OPEN_FOUR;

  if (oppBeforeCounts.CLOSED_FOUR >= 2 && oppAfterCounts.CLOSED_FOUR < 2)
    return AI_SCORES.DOUBLE_FOUR;

  if (
    oppBeforeCounts.CLOSED_FOUR >= 1 && oppBeforeCounts.OPEN_THREE >= 1 &&
    !(oppAfterCounts.CLOSED_FOUR >= 1 && oppAfterCounts.OPEN_THREE >= 1)
  ) return AI_SCORES.FOUR_THREE;

  if (attackCounts.OPEN_THREE >= 2) return AI_SCORES.DOUBLE_THREE;

  if (oppBeforeCounts.OPEN_THREE >= 2 && oppAfterCounts.OPEN_THREE < 2)
    return AI_SCORES.DOUBLE_THREE;

  // --- 通常評価 ---
  let attackScore = 0;
  attackScore += attackCounts.CLOSED_FOUR * AI_SCORES.CLOSED_FOUR;
  attackScore += attackCounts.OPEN_THREE * AI_SCORES.OPEN_THREE;
  attackScore += attackCounts.CLOSED_THREE * AI_SCORES.CLOSED_THREE;
  attackScore += attackCounts.OPEN_TWO * AI_SCORES.OPEN_TWO;
  attackScore += attackCounts.CLOSED_TWO * AI_SCORES.CLOSED_TWO;
  attackScore += attackCounts.SINGLE * AI_SCORES.SINGLE;

  const calcTotalOppScore = (counts: PatternCount): number => {
    let score = 0;
    score += counts.CLOSED_FOUR * AI_SCORES.CLOSED_FOUR;
    score += counts.OPEN_THREE * AI_SCORES.OPEN_THREE;
    score += counts.CLOSED_THREE * AI_SCORES.CLOSED_THREE;
    score += counts.OPEN_TWO * AI_SCORES.OPEN_TWO;
    score += counts.CLOSED_TWO * AI_SCORES.CLOSED_TWO;
    return score;
  };

  const defenseScore = Math.max(
    0,
    calcTotalOppScore(oppBeforeCounts) - calcTotalOppScore(oppAfterCounts)
  );

  return attackScore * AI_CONFIG.ATTACK_WEIGHT + defenseScore;
};


// ============================================================
// 全盤評価（葉ノード向け）
// ============================================================

/**
 * 盤面全体を aiPlayer 視点で評価し、スカラースコアを返す。
 *
 * 【旧 evaluateLeaf との違い】
 * 旧実装: `aiMax - oppMax`（各プレイヤーの"1 手だけ"の最善差分）
 * 新実装: 上位 K 手の重み付き和差分
 *
 *   score = Σ_i(aiTopK[i] × decay^i) - Σ_i(oppTopK[i] × decay^i)
 *
 * decay < 1 で 2・3 番手の寄与を逓減させることで:
 *   - 「1 箇所だけ強い」盤面より「複数箇所に脅威がある」盤面を高評価
 *   - 多重脅威のある局面（例: 四三・双三）を正確に反映
 *
 * 【将来の差し替え口】
 * 全ライン走査型の専用評価関数（例: ラインスキャン O(n)）が
 * 用意された場合は、この関数をそちらに置き換えるだけでよい。
 */
export const evaluateBoard = (
  board: BoardState,
  aiPlayer: Player,
  forbiddenMoves: boolean[][]
): number => {
  const opp = opponentOf(aiPlayer);
  const topK = EVAL_CONFIG.TOP_K;
  const decay = EVAL_CONFIG.TOP_K_DECAY;

  // 上位 K 要素のみを保持するソート済み降順配列へ挿入
  const insertTopK = (arr: number[], val: number, k: number): void => {
    // 線形挿入: K が小さい（≤ 3）ため O(K) で十分
    let i = arr.length;
    while (i > 0 && arr[i - 1] < val) i--;
    arr.splice(i, 0, val);
    if (arr.length > k) arr.length = k;
  };

  const aiTopK: number[] = [];
  const oppTopK: number[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      insertTopK(aiTopK, evaluatePosition(board, r, c, aiPlayer), topK);
      insertTopK(oppTopK, evaluatePosition(board, r, c, opp), topK);
    }
  }

  if (aiTopK.length === 0 && oppTopK.length === 0) return 0;

  let aiTotal = 0;
  let oppTotal = 0;
  for (let i = 0; i < aiTopK.length; i++) aiTotal += aiTopK[i] * Math.pow(decay, i);
  for (let i = 0; i < oppTopK.length; i++) oppTotal += oppTopK[i] * Math.pow(decay, i);

  return aiTotal - oppTotal;
};