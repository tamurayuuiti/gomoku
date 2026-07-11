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

import type { BoardState, Player, Cell } from '../../types/game';
import type { PatternCount } from '../../types/ai';
import { BOARD_SIZE } from '../gameLogic';
import { AI_SCORES, AI_CONFIG, EVAL_CONFIG, DIRECTIONS } from './constants';
import { detectPattern, hasStoneNearby, opponentOf } from './evaluator';


// ============================================================
// ライン走査キャッシュ
// ============================================================

/** セルの Player|null を getLineString と同じ文字コードへ変換する（'1'=color の石, '0'=空マス, '2'=相手石/盤外） */
const cellChar = (cell: Cell, color: Player): string =>
  cell === color ? '1' : cell === null ? '0' : '2';

/**
 * 指定方向 (dx, dy) について盤面全体を 1 回走査し、各セルを中心とする
 * 9 文字ウィンドウ文字列（getLineString と同一形式）を事前計算して返す。
 * これを方向あたり 1 回だけ生成することで、空きマスごとの重複読み取りを排除する。
 *
 * @future
 * 差分更新（1 手ごとに影響範囲のラインだけ再計算）へ発展させる場合は、
 * このキャッシュ構造を SearchContext 等へ持ち上げる形で拡張できる。
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
  WIN: 0, OPEN_FOUR: 0, CLOSED_FOUR: 0, OPEN_THREE: 0,
  CLOSED_THREE: 0, OPEN_TWO: 0, CLOSED_TWO: 0, SINGLE: 0,
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
    const attackPtn = detectPattern(attackLine);
    attackCounts[attackPtn]++;

    const oppLine = oppLineCaches[d][r][c];
    const beforeLine = oppLine.slice(0, 4) + '1' + oppLine.slice(5);
    const beforePtn = detectPattern(beforeLine);
    oppBeforeCounts[beforePtn]++;

    const afterLine = oppLine.slice(0, 4) + '2' + oppLine.slice(5);
    const afterPtn = detectPattern(afterLine);
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


// ============================================================
// 全盤評価（葉ノード向け）
// ============================================================

/**
 * 盤面全体を aiPlayer 視点で評価し、スカラースコアを返す。
 *
 * 旧実装は `aiMax - oppMax`（各プレイヤー "1 手だけ" の最善差分）だったが、
 * 現実装は上位 K 手の重み付き和差分を取る:
 *   score = Σ_i(aiTopK[i] × decay^i) - Σ_i(oppTopK[i] × decay^i)
 * decay < 1 で 2・3 番手の寄与を逓減させることで、「1 箇所だけ強い」盤面より
 * 「複数箇所に脅威がある」盤面（四三・双三など）を正確に高評価する。
 * 評価方式・スコアの意味・優先順位はライン走査化後も変更していない。
 *
 * @param board          評価対象の盤面
 * @param aiPlayer       AI のプレイヤー（スコアの基準視点）
 * @param forbiddenMoves 禁じ手マップ（候補マスのフィルタリングに使用）
 * @returns              aiPlayer 視点のスカラースコア
 */
export const evaluateBoard = (
  board: BoardState,
  aiPlayer: Player,
  forbiddenMoves: boolean[][]
): number => {
  const opp = opponentOf(aiPlayer);
  const topK = EVAL_CONFIG.TOP_K;
  const decay = EVAL_CONFIG.TOP_K_DECAY;

  /**
   * 上位 K 要素のみを保持するソート済み降順配列へ挿入。
   * K が小さい（≤ 3）ため線形挿入 O(K) で十分。
   *
   * @future K を増やす場合は min-heap へ差し替えると O(log K) になる。
   */
  const insertTopK = (arr: number[], val: number, k: number): void => {
    let i = arr.length;
    while (i > 0 && arr[i - 1] < val) i--;
    arr.splice(i, 0, val);
    if (arr.length > k) arr.length = k;
  };

  const aiLineCaches = DIRECTIONS.map(([dx, dy]) => buildLineCache(board, dx, dy, aiPlayer));
  const oppLineCaches = DIRECTIONS.map(([dx, dy]) => buildLineCache(board, dx, dy, opp));

  const aiTopK: number[] = [];
  const oppTopK: number[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      insertTopK(aiTopK, scoreFromLineCache(r, c, aiLineCaches, oppLineCaches), topK);
      insertTopK(oppTopK, scoreFromLineCache(r, c, oppLineCaches, aiLineCaches), topK);
    }
  }

  if (aiTopK.length === 0 && oppTopK.length === 0) return 0;

  let aiTotal = 0;
  let oppTotal = 0;
  for (let i = 0; i < aiTopK.length; i++) aiTotal += aiTopK[i] * Math.pow(decay, i);
  for (let i = 0; i < oppTopK.length; i++) oppTotal += oppTopK[i] * Math.pow(decay, i);

  return aiTotal - oppTotal;
};