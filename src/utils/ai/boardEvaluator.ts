// src/utils/ai/boardEvaluator.ts
// 葉ノード盤面評価を担うモジュール（evaluateBoard: 全盤面の多重脅威スコア算出）
//
// evaluatePosition（位置評価）は evaluator.ts に残し、盤面全体を集約して
// スカラー値を返す層をここに配置する。
//
// 【ライン走査（Line Scan）化】
// 旧実装は空きマスごとに getLineString を都度呼び出し、同じ石を何度も読み直していた。
// 現実装は盤面の各方向ラインを 1 回だけ走査して 9 文字ウィンドウ文字列を事前計算（キャッシュ）し、
// 各セルのパターン判定はそのキャッシュを参照するだけにする。パターン判定ロジックとスコア計算式は
// evaluator.ts の evaluatePosition と同一のものを使うため、評価値の意味・優先順位は変えていない。
//
// 第3弾:
//   - evaluateBoardWithCache を追加し、LineCache を利用した葉評価を実装。
//   - CandidateSet があれば候補集合だけ走査し、なければ従来通り盤面走査する。

import type { BoardState, Player, Cell } from '../../types/game';
import type {
  PatternCount,
  LineCacheState,
  CandidateSetState,
} from '../../types/ai';
import { BOARD_SIZE } from '../gameLogic';
import { AI_SCORES, AI_CONFIG, EVAL_CONFIG, DIRECTIONS } from './constants';
import { detectPatternFast, hasStoneNearby, opponentOf } from './evaluator';

// ============================================================
// ライン走査キャッシュ（フォールバック用）
// ============================================================

/** セルの Player|null を getLineString と同じ文字コードへ変換する（'1'=color の石, '0'=空マス, '2'=相手石/盤外） */
const cellChar = (cell: Cell, color: Player): string =>
  cell === color ? '1' : cell === null ? '0' : '2';

/**
 * 指定方向 (dx, dy) について盤面全体を 1 回走査し、各セルを中心とする
 * 9 文字ウィンドウ文字列（getLineString と同一形式）を事前計算して返す。
 *
 * LineCache 無効時のフォールバックとして残す。
 */
const buildLineCache = (
  board: BoardState,
  dx: number,
  dy: number,
  color: Player
): string[][] => {
  const cache: string[][] = Array.from({ length: BOARD_SIZE }, () =>
    new Array<string>(BOARD_SIZE).fill('')
  );

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      let s = '';

      for (let i = -4; i <= 4; i++) {
        const rr = r + i * dx;
        const cc = c + i * dy;

        s += (rr < 0 || rr >= BOARD_SIZE || cc < 0 || cc >= BOARD_SIZE)
          ? '2'
          : cellChar(board[rr][cc], color);
      }

      cache[r][c] = s;
    }
  }

  return cache;
};

const createEmptyPatternCount = (): PatternCount => ({
  WIN: 0,
  OPEN_FOUR: 0,
  CLOSED_FOUR: 0,
  OPEN_THREE: 0,
  CLOSED_THREE: 0,
  OPEN_TWO: 0,
  CLOSED_TWO: 0,
  SINGLE: 0,
});

/**
 * キャッシュ済み 9 文字ウィンドウから (r, c) への着手価値を playerColor 視点で算出する。
 * ロジックは evaluator.ts の evaluatePosition と完全に同一で、違いは
 * 事前計算済みキャッシュからウィンドウ文字列を取得する点のみ。
 *
 * @param ownLineCaches 4 方向分の「playerColor 視点」ラインキャッシュ
 * @param oppLineCaches 4 方向分の「相手視点」ラインキャッシュ
 */
const scoreFromLineCache = (
  r: number,
  c: number,
  ownLineCaches: string[][][],
  oppLineCaches: string[][][]
): number => {
  const attackCounts = createEmptyPatternCount();
  const oppBeforeCounts = createEmptyPatternCount();
  const oppAfterCounts = createEmptyPatternCount();

  for (let d = 0; d < DIRECTIONS.length; d++) {
    // 中心セルは空マス前提（evaluateBoard は空きマスのみを対象に呼ぶ）のため、
    // キャッシュ済み文字列の中心文字だけを差し替えて各パターンを判定する。
    const ownLine = ownLineCaches[d][r][c];
    const attackLine = ownLine.slice(0, 4) + '1' + ownLine.slice(5);
    const attackPtn = detectPatternFast(attackLine);
    attackCounts[attackPtn]++;

    const oppLine = oppLineCaches[d][r][c];

    const beforeLine = oppLine.slice(0, 4) + '1' + oppLine.slice(5);
    const beforePtn = detectPatternFast(beforeLine);
    oppBeforeCounts[beforePtn]++;

    const afterLine = oppLine.slice(0, 4) + '2' + oppLine.slice(5);
    const afterPtn = detectPatternFast(afterLine);
    oppAfterCounts[afterPtn]++;
  }

  // --- 即時評価（evaluatePosition と同一の優先順位） ---
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

/**
 * 上位 K 要素のみを保持するソート済み降順配列へ挿入。
 * K が小さい（≤ 3）ため線形挿入 O(K) で十分。
 */
const insertTopK = (arr: number[], val: number, k: number): void => {
  let i = arr.length;
  while (i > 0 && arr[i - 1] < val) i--;

  arr.splice(i, 0, val);

  if (arr.length > k) arr.length = k;
};

// ============================================================
// 全盤評価（葉ノード向け）
// ============================================================

/**
 * 盤面全体を aiPlayer 視点で評価し、スカラースコアを返す。
 *
 * LineCache 無効時のフォールバック。
 * 評価方式・スコアの意味・優先順位は変更していない。
 */
export const evaluateBoard = (
  board: BoardState,
  aiPlayer: Player,
  forbiddenMoves: boolean[][]
): number => {
  const opp = opponentOf(aiPlayer);

  const topK = EVAL_CONFIG.TOP_K;
  const decay = EVAL_CONFIG.TOP_K_DECAY;

  const aiLineCaches = DIRECTIONS.map(([dx, dy]) =>
    buildLineCache(board, dx, dy, aiPlayer)
  );
  const oppLineCaches = DIRECTIONS.map(([dx, dy]) =>
    buildLineCache(board, dx, dy, opp)
  );

  const aiTopK: number[] = [];
  const oppTopK: number[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      insertTopK(
        aiTopK,
        scoreFromLineCache(r, c, aiLineCaches, oppLineCaches),
        topK
      );

      insertTopK(
        oppTopK,
        scoreFromLineCache(r, c, oppLineCaches, aiLineCaches),
        topK
      );
    }
  }

  if (aiTopK.length === 0 && oppTopK.length === 0) return 0;

  let aiTotal = 0;
  let oppTotal = 0;

  for (let i = 0; i < aiTopK.length; i++) {
    aiTotal += aiTopK[i] * Math.pow(decay, i);
  }

  for (let i = 0; i < oppTopK.length; i++) {
    oppTotal += oppTopK[i] * Math.pow(decay, i);
  }

  return aiTotal - oppTotal;
};

/**
 * LineCache を利用した全盤評価。
 *
 * CandidateSet が渡された場合は候補集合のみを走査し、
 * null の場合は従来通り盤面全体を走査する。
 *
 * 評価式・スコア体系は evaluateBoard と同一。
 */
export const evaluateBoardWithCache = (
  board: BoardState,
  lineCache: LineCacheState,
  aiPlayer: Player,
  forbiddenMoves: boolean[][],
  candidateSet: CandidateSetState | null = null
): number => {
  const opp = opponentOf(aiPlayer);

  const topK = EVAL_CONFIG.TOP_K;
  const decay = EVAL_CONFIG.TOP_K_DECAY;

  const aiLineCaches = lineCache.caches[aiPlayer];
  const oppLineCaches = lineCache.caches[opp];

  const aiTopK: number[] = [];
  const oppTopK: number[] = [];

  const scoreCell = (r: number, c: number): void => {
    insertTopK(
      aiTopK,
      scoreFromLineCache(r, c, aiLineCaches, oppLineCaches),
      topK
    );

    insertTopK(
      oppTopK,
      scoreFromLineCache(r, c, oppLineCaches, aiLineCaches),
      topK
    );
  };

  if (candidateSet) {
    for (const idx of candidateSet.candidates) {
      const r = Math.floor(idx / BOARD_SIZE);
      const c = idx % BOARD_SIZE;

      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;

      scoreCell(r, c);
    }
  } else {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
        if (!hasStoneNearby(board, r, c)) continue;

        scoreCell(r, c);
      }
    }
  }

  if (aiTopK.length === 0 && oppTopK.length === 0) return 0;

  let aiTotal = 0;
  let oppTotal = 0;

  for (let i = 0; i < aiTopK.length; i++) {
    aiTotal += aiTopK[i] * Math.pow(decay, i);
  }

  for (let i = 0; i < oppTopK.length; i++) {
    oppTotal += oppTopK[i] * Math.pow(decay, i);
  }

  return aiTotal - oppTotal;
};