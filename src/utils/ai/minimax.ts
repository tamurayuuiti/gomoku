// src/utils/ai/minimax.ts
// ミニマックス探索エンジン
//
// 責務:
//   - SearchContext による探索状態の一元管理
//   - killer move heuristic による αβ 枝刈り効率化
//   - 3 tier 候補生成（CRITICAL / KILLER / REST）
//   - evaluateBoard を用いた高精度葉ノード評価
//   - 将来の transposition table・iterative deepening を想定した構造

import type { BoardState, Position, Player } from '../../types/game';
import { BOARD_SIZE, checkWin } from '../gameLogic';
import { AI_CONFIG, AI_SCORES } from './constants';
import {
  evaluatePosition,
  evaluateBoard,
  hasStoneNearby,
  opponentOf,
} from './evaluator';


// ============================================================
// SearchContext
// ============================================================

/** killer table が対応する最大探索深さ */
const MAX_KILLER_DEPTH = 8 as const;

/** 深さ 1 レベルの killer スロット */
type KillerEntry = [Position | null, Position | null];

/**
 * 探索コンテキスト。
 * 探索木全体を通じて共有される状態をまとめる。
 *
 * 【将来の拡張フィールド例】
 *   transpositionTable : Map<bigint, TTEntry>   … 置換表
 *   zobristHash        : ZobristHasher           … 差分ハッシュ計算器
 *   startTimeMs        : number                  … 探索開始時刻
 *   timeLimitMs        : number                  … 時間制限 (iterative deepening)
 *   nodeCount          : number                  … 評価ノード数カウンタ
 */
interface SearchContext {
  aiPlayer: Player;
  forbiddenMoves: boolean[][];
  killerTable: KillerEntry[];
}

const createSearchContext = (
  aiPlayer: Player,
  forbiddenMoves: boolean[][]
): SearchContext => ({
  aiPlayer,
  forbiddenMoves,
  killerTable: Array.from(
    { length: MAX_KILLER_DEPTH },
    (): KillerEntry => [null, null]
  ),
});


// ============================================================
// Killer move management
// ============================================================

/**
 * β カットオフを引き起こした手を killer table に記録する。
 *
 * 同じ手を重複登録しない。slot[0] が最新で slot[1] が次点。
 * CRITICAL tier（WIN 相当）の手は通常ソートで先頭になるため
 * killer には登録せず「静かな手」のみ管理する（呼び出し元で判定済み）。
 */
const storeKiller = (
  ctx: SearchContext,
  depth: number,
  pos: Position
): void => {
  if (depth >= MAX_KILLER_DEPTH) return;
  const slot = ctx.killerTable[depth];
  // 既に slot[0] に同一手があれば何もしない
  if (slot[0]?.row === pos.row && slot[0]?.col === pos.col) return;
  slot[1] = slot[0];
  slot[0] = { row: pos.row, col: pos.col };
};

/** 指定座標が depth の killer move に登録されているか確認する */
const isKiller = (
  ctx: SearchContext,
  depth: number,
  row: number,
  col: number
): boolean => {
  if (depth >= MAX_KILLER_DEPTH) return false;
  const [k0, k1] = ctx.killerTable[depth];
  return (k0?.row === row && k0?.col === col) ||
         (k1?.row === row && k1?.col === col);
};


// ============================================================
// 候補手生成（3 tier move ordering）
// ============================================================

/**
 * CRITICAL スコアの閾値。
 * DOUBLE_THREE 以上（DOUBLE_THREE / FOUR_THREE / DOUBLE_FOUR /
 * OPEN_FOUR / DEFEND_WIN / WIN）を CRITICAL tier とみなす。
 * これらは評価スコアだけで既に最優先されるため killer 管理は不要。
 */
const CRITICAL_SCORE_THRESHOLD = AI_SCORES.DOUBLE_THREE; // 50_000

/**
 * 候補手を 3 tier に分類して結合し、上位 MAX_CANDIDATES 手を返す。
 *
 * Tier 0 (CRITICAL):
 *   evaluatePosition スコア >= CRITICAL_SCORE_THRESHOLD の手。
 *   WIN / DEFEND_WIN / OPEN_FOUR / 四三 / 双三 が該当。
 *   αβ の α/β 境界を早期更新し、後続手の枝刈り率を最大化する。
 *
 * Tier 1 (KILLER):
 *   killer table に登録された「静かな手（CRITICAL 未満）」。
 *   兄弟ノードで β カットオフを引き起こした実績を持つ手。
 *   CRITICAL 未満でも探索上重要な手を REST より先に試せる。
 *
 * Tier 2 (REST):
 *   上記以外。evaluatePosition 降順でソート済み。
 *
 * 【将来の拡張ポイント】
 *   - history heuristic: 手ごとのカットオフ実績カウンタをスコアへ加算
 *   - countermove heuristic: 直前手への対応として有効だった手を優先
 *   - TT ベストムーブ: 置換表にヒットした場合は先頭に配置
 */
const generateOrderedCandidates = (
  board: BoardState,
  player: Player,
  ctx: SearchContext,
  depth: number
): Position[] => {
  const { forbiddenMoves } = ctx;
  const scored: Array<{ pos: Position; score: number }> = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null || forbiddenMoves[r][c]) continue;
      if (!hasStoneNearby(board, r, c)) continue;

      scored.push({
        pos: { row: r, col: c },
        score: evaluatePosition(board, r, c, player),
      });
    }
  }

  if (scored.length === 0) return [];

  // score 降順（WIN > DEFEND_WIN > ... の自然な tier 順を維持）
  scored.sort((a, b) => b.score - a.score);

  const criticalTier: Position[] = [];
  const killerTier: Position[] = [];
  const restTier: Position[] = [];

  for (const { pos, score } of scored) {
    if (score >= CRITICAL_SCORE_THRESHOLD) {
      criticalTier.push(pos);
    } else if (isKiller(ctx, depth, pos.row, pos.col)) {
      killerTier.push(pos);
    } else {
      restTier.push(pos);
    }
  }

  // CRITICAL が既に MAX_CANDIDATES を超える局面（多重勝利等）では
  // CRITICAL のみ返すことで探索が迅速に収束する
  const ordered = [...criticalTier, ...killerTier, ...restTier];
  return ordered.slice(0, AI_CONFIG.MAX_CANDIDATES);
};


// ============================================================
// ミニマックス探索本体
// ============================================================

/**
 * αβ 枝刈り付きミニマックス探索。
 *
 * @param board          現在の盤面（in-place 変更・復元）
 * @param depth          残り探索深さ（0 = 葉ノード）
 * @param isMaximizing   true = AI 手番 / false = 相手手番
 * @param currentPlayer  現在の手番プレイヤー
 * @param ctx            探索コンテキスト（killer table 等を共有）
 * @param alpha          最大化側の現時点下限保証値
 * @param beta           最小化側の現時点上限保証値
 * @returns              aiPlayer 視点のスコア
 */
const minimax = (
  board: BoardState,
  depth: number,
  isMaximizing: boolean,
  currentPlayer: Player,
  ctx: SearchContext,
  alpha: number,
  beta: number
): number => {
  // 葉ノード: 全盤評価（多重脅威対応の重み付き和）
  if (depth === 0) {
    return evaluateBoard(board, ctx.aiPlayer, ctx.forbiddenMoves);
  }

  const candidates = generateOrderedCandidates(board, currentPlayer, ctx, depth);

  // 候補なし（盤面満杯等）→ 葉ノード評価にフォールバック
  if (candidates.length === 0) {
    return evaluateBoard(board, ctx.aiPlayer, ctx.forbiddenMoves);
  }

  if (isMaximizing) {
    let maxScore = -Infinity;

    for (const { row, col } of candidates) {
      board[row][col] = currentPlayer;

      // 即時勝利判定（AI の勝利）
      if (checkWin(board, { row, col }, ctx.aiPlayer)) {
        board[row][col] = null;
        return AI_SCORES.WIN;
      }

      const score = minimax(
        board,
        depth - 1,
        false,
        opponentOf(currentPlayer),
        ctx,
        alpha,
        beta
      );
      board[row][col] = null;

      if (score > maxScore) maxScore = score;
      if (score > alpha) alpha = score;

      // β カットオフ
      if (beta <= alpha) {
        // CRITICAL 未満の手のみ killer に記録（CRITICAL は常に先頭）
        const moveScore = evaluatePosition(board, row, col, currentPlayer);
        if (moveScore < CRITICAL_SCORE_THRESHOLD) {
          storeKiller(ctx, depth, { row, col });
        }
        break;
      }
    }

    return maxScore;
  } else {
    let minScore = Infinity;

    for (const { row, col } of candidates) {
      board[row][col] = currentPlayer;

      // 即時勝利判定（相手の勝利 = AI にとっての最悪値）
      if (checkWin(board, { row, col }, currentPlayer)) {
        board[row][col] = null;
        return -AI_SCORES.WIN;
      }

      const score = minimax(
        board,
        depth - 1,
        true,
        opponentOf(currentPlayer),
        ctx,
        alpha,
        beta
      );
      board[row][col] = null;

      if (score < minScore) minScore = score;
      if (score < beta) beta = score;

      // α カットオフ
      if (beta <= alpha) {
        const moveScore = evaluatePosition(board, row, col, currentPlayer);
        if (moveScore < CRITICAL_SCORE_THRESHOLD) {
          storeKiller(ctx, depth, { row, col });
        }
        break;
      }
    }

    return minScore;
  }
};


// ============================================================
// 公開 API
// ============================================================

/**
 * ミニマックス探索で最善手を求めて返す。
 *
 * search.ts から呼び出される唯一の公開関数。
 * ルートノードの探索を行い、最もスコアの高い Position を返す。
 *
 * 【将来の拡張ポイント: iterative deepening】
 * ```
 * for (let d = 1; d <= depth; d++) {
 *   bestPos = searchAtDepth(board, d, ctx);
 *   if (isTimeUp(ctx)) break;
 * }
 * ```
 * SearchContext に startTimeMs / timeLimitMs を追加するだけで対応可能。
 *
 * 【将来の拡張ポイント: aspiration window】
 * 前回 depth の bestScore を基に初期 [α, β] を絞り込み、
 * fail high/low 時に window を広げて再探索。
 * ルートループの alpha / beta を SearchContext 管理にすることで実装できる。
 *
 * @param board          現在の盤面
 * @param forbiddenMoves 禁じ手マップ（探索中は静的として扱う）
 * @param aiPlayer       AI のプレイヤー
 * @param depth          探索深さ（デフォルト: AI_CONFIG.MINIMAX_DEPTH）
 * @returns              最善手の Position、候補なしの場合は null
 */
export const findBestMove = (
  board: BoardState,
  forbiddenMoves: boolean[][],
  aiPlayer: Player,
  depth: number = AI_CONFIG.MINIMAX_DEPTH
): Position | null => {
  const ctx = createSearchContext(aiPlayer, forbiddenMoves);
  const candidates = generateOrderedCandidates(board, aiPlayer, ctx, depth);
  if (candidates.length === 0) return null;

  let bestPos: Position = candidates[0]; // 候補がある限り必ず返す
  let bestScore = -Infinity;
  // ルート α はすべての子スコアを比較するため -Infinity から開始
  let alpha = -Infinity;
  const beta = Infinity;

  console.log(
    `[Minimax] depth=${depth}, candidates=${candidates.length}, player=${aiPlayer}`
  );

  for (const { row, col } of candidates) {
    board[row][col] = aiPlayer;

    // ルートノード即時勝利（1 手詰め検出）
    if (checkWin(board, { row, col }, aiPlayer)) {
      board[row][col] = null;
      console.log(`[Minimax] Immediate Win at (${row}, ${col})`);
      return { row, col };
    }

    const score = minimax(
      board,
      depth - 1,
      false,
      opponentOf(aiPlayer),
      ctx,
      alpha,
      beta
    );
    board[row][col] = null;

    if (score > bestScore) {
      bestScore = score;
      bestPos = { row, col };
    }
    // ルート α を更新して子ノードの枝刈り効率を高める
    if (score > alpha) alpha = score;
  }

  console.log(
    `[Minimax] best=(${bestPos.row}, ${bestPos.col}), score=${bestScore}`
  );
  return bestPos;
};