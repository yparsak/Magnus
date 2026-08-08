'use strict';

const { Chess } = require('../public/js/chess.min.js');

// Thrown for bad caller input (missing/ambiguous fen+moves, illegal move, invalid FEN).
// Routes should map this to an HTTP 400; anything else is an unexpected 500.
class ValidationError extends Error {}

// Validate FEN
function isValidFen(fen) {
  if (typeof fen !== 'string' || !fen.trim()) {
    return false;
  }

  var parts = fen.trim().split(/\s+/);
  if (parts.length > 6) {
    return false;
  }

  var ranks = parts[0].split('/');
  if (ranks.length !== 8) {
    return false;
  }
  for (var i = 0; i < ranks.length; i++) {
    if (!/^[pnbrqkPNBRQK1-8]+$/.test(ranks[i])) {
      return false;
    }
    var squares = 0;
    for (var c = 0; c < ranks[i].length; c++) {
      var ch = ranks[i].charAt(c);
      squares += /[1-8]/.test(ch) ? Number(ch) : 1;
    }
    if (squares !== 8) {
      return false;
    }
  }

  if (parts[1] !== undefined && parts[1] !== 'w' && parts[1] !== 'b') {
    return false;
  }
  if (parts[2] !== undefined && parts[2] !== '-' && !/^[KQkq]+$/.test(parts[2])) {
    return false;
  }
  if (parts[3] !== undefined && parts[3] !== '-' && !/^[a-h][36]$/.test(parts[3])) {
    return false;
  }
  if (parts[4] !== undefined && !/^\d+$/.test(parts[4])) {
    return false;
  }
  if (parts[5] !== undefined && !/^\d+$/.test(parts[5])) {
    return false;
  }
  return true;
}

/**
 * Resolves a chess.js position from either a FEN string or a sequence of
 * long-algebraic (UCI-style) moves applied from the standard starting
 * position (e.g. "e2e4 e7e5 g1f3 b8c6"). Exactly one of `fen`/`moves` must
 * be provided.
 *
 * @param {Object} input
 * @param {string} [input.fen]
 * @param {string} [input.moves]
 * @returns {Chess} a chess.js instance positioned accordingly
 * @throws {ValidationError} if input is missing/ambiguous, the FEN is invalid,
 *   or a move is illegal
 */
function resolvePosition({ fen, moves } = {}) {
  const hasFen = typeof fen === 'string' && fen.trim().length > 0;
  const hasMoves = typeof moves === 'string' && moves.trim().length > 0;

  if (hasFen === hasMoves) {
    throw new ValidationError('Provide exactly one of "fen" or "moves".');
  }

  if (hasFen) {
    if (!isValidFen(fen)) {
      throw new ValidationError('Invalid FEN string.');
    }
    return new Chess(fen.trim());
  }

  const chess = new Chess();
  for (const moveStr of moves.trim().split(/\s+/)) {
    if (!chess.move(moveStr, { sloppy: true })) {
      throw new ValidationError(`Illegal move: "${moveStr}"`);
    }
  }
  return chess;
}

module.exports = { isValidFen, resolvePosition, ValidationError };

