'use strict';

/**
 * engineApi.js
 * High-level Stockfish-backed functions consumed by the API routes.
 * Resolves FEN/moves input into a chess.js position (see lib/chess.js) and
 * validates the requested search depth before delegating to the engine
 * wrapper in lib/stockfish.js.
 */

const { resolvePosition, ValidationError } = require('./chess');
const { getEvaluation, getAnalysis } = require('./stockfish');

const MIN_DEPTH = 1;
const MAX_DEPTH = 20;
const DEFAULT_DEPTH = 10;
const MULTIPV = 10;

/**
 * Validates a requested search depth, defaulting to DEFAULT_DEPTH when omitted.
 * @param {*} depth
 * @returns {number} a validated integer depth between MIN_DEPTH and MAX_DEPTH
 * @throws {ValidationError} if depth is provided but is not an integer in range
 */
function resolveDepth(depth) {
  if (depth === undefined || depth === null || depth === '') {
    return DEFAULT_DEPTH;
  }

  if (typeof depth !== 'number' && typeof depth !== 'string') {
    throw new ValidationError(`Depth must be an integer between ${MIN_DEPTH} and ${MAX_DEPTH}.`);
  }

  const parsedDepth = Number(depth);
  if (!Number.isInteger(parsedDepth) || parsedDepth < MIN_DEPTH || parsedDepth > MAX_DEPTH) {
    throw new ValidationError(`Depth must be an integer between ${MIN_DEPTH} and ${MAX_DEPTH}.`);
  }
  return parsedDepth;
}

/**
 * Returns the engine evaluation for a position given as FEN or long-notation moves.
 * @param {Object} params
 * @param {string} [params.fen]
 * @param {string} [params.moves]
 * @param {number} [params.depth]
 * @returns {Promise<{ evaluation: { type: string, value: number }, in_check: boolean, is_mate: boolean }>}
 */
async function get_engine_eval({ fen, moves, depth } = {}) {
  const chess = resolvePosition({ fen, moves });
  const validDepth = resolveDepth(depth);

  const evaluation = await getEvaluation(chess.fen(), validDepth);

  return {
    evaluation,
    in_check: chess.in_check(),
    is_mate: chess.in_checkmate()
  };
}

/**
 * Returns the engine's top 10 best moves (principal variations) for a position
 * given as FEN or long-notation moves.
 * @param {Object} params
 * @param {string} [params.fen]
 * @param {string} [params.moves]
 * @param {number} [params.depth]
 * @returns {Promise<Array<{ move: string, score: { type: string, value: number } }>>}
 */
async function get_engine_bestmove({ fen, moves, depth } = {}) {
  const chess = resolvePosition({ fen, moves });
  const validDepth = resolveDepth(depth);

  const lines = await getAnalysis(chess.fen(), MULTIPV, validDepth);

  return lines.map((line) => ({
    move: line.pv.split(' ')[0],
    score: line.score
  }));
}

module.exports = { get_engine_eval, get_engine_bestmove };
