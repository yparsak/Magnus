'use strict';

const { Chess } = require('../public/js/chess.min.js');
const { ValidationError } = require('./chess');

/**
 * openingBook.js
 * Opening-book lookup shared by the analysis page (live detection while
 * browsing a line) and analysisRouter (one-time detection/persistence for a
 * stored game). Builds PGN prefixes in the exact format scripts/evaluateGames.js
 * uses to stamp `user_games.book_id`, so lookups hit the same seeded
 * `opening_book` rows -- see that file's move loop for the source of truth.
 */

// Builds the cumulative PGN string for an ordered array of SAN moves
// (starting with White's move), e.g. ['e4', 'e5', 'Nf3'] -> "1. e4 e5 2. Nf3".
// Mirrors scripts/evaluateGames.js's per-move PGN-building loop exactly.
function buildOpeningPgn(sanMoves) {
  var pgn = '';
  var movecnt = 0;

  sanMoves.forEach(function (san, i) {
    var side = i % 2 === 0 ? 1 : 0; // 1 = white, 0 = black (even index = white's move)
    if (side === 1) {
      movecnt++;
      pgn = pgn === '' ? `${movecnt}.` : `${pgn} ${movecnt}.`;
    }
    pgn = `${pgn} ${san}`;
  });

  return pgn.trim();
}

// Finds the deepest opening_book match for the given line, trimmed to at
// most `maxFullMoves` full moves. Queries every ply-prefix in one round trip
// and picks the longest (deepest) matching pgn. Returns { id, eco, name } or
// null if nothing matches (including an empty `sanMoves`).
async function findOpeningMatch(pool, sanMoves, maxFullMoves = 10) {
  if (!Array.isArray(sanMoves) || sanMoves.length === 0) {
    return null;
  }

  var trimmed = sanMoves.slice(0, maxFullMoves * 2);
  var prefixes = [];
  for (var i = 1; i <= trimmed.length; i++) {
    prefixes.push(buildOpeningPgn(trimmed.slice(0, i)));
  }

  const [rows] = await pool.query(
    'SELECT id, eco, name, pgn FROM opening_book WHERE pgn IN (?)',
    [prefixes]
  );
  if (rows.length === 0) {
    return null;
  }

  // Rows come back in arbitrary order -- keep the one with the longest pgn,
  // i.e. the deepest ply matched.
  var best = rows[0];
  rows.forEach(function (row) {
    if (row.pgn.length > best.pgn.length) {
      best = row;
    }
  });

  return { id: best.id, eco: best.eco, name: best.name };
}

// Inverse of buildOpeningPgn: takes a pgn string in that same format
// ("1. e4 e5 2. Nf3") and replays it on a fresh Chess instance, returning an
// array of moveInfo objects shaped like gameMoveToMoveInfo in chess.js
// ({ san, from, to, promotion, color, fen }) so it can be fed straight into
// the frontend move tree (move-tree.js's addMove defaults eval/mateIn/loss
// to null when absent). Move-number tokens ("1.", "2.", ...) are stripped
// before replay. Throws ValidationError if a token isn't a legal move --
// shouldn't happen for real opening_book data, but keeps behavior consistent
// with chess.js's resolvePosition.
function parseOpeningPgn(pgn) {
  var tokens = pgn.trim().split(/\s+/).filter(function (token) {
    return token.length > 0 && !/^\d+\.+$/.test(token);
  });

  var chess = new Chess();
  return tokens.map(function (token) {
    var move = chess.move(token, { sloppy: true });
    if (!move) {
      throw new ValidationError(`Illegal move in opening_book pgn: "${token}"`);
    }
    return {
      san: move.san,
      from: move.from,
      to: move.to,
      promotion: move.promotion || null,
      color: move.color,
      fen: chess.fen()
    };
  });
}

module.exports = { buildOpeningPgn, findOpeningMatch, parseOpeningPgn };
