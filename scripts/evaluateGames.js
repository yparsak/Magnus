'use strict';

require('dotenv').config({
  path: require('path').resolve(__dirname, '../app/.env'),
  quiet: true
});

const mysql    = require('mysql2/promise');
const { get_engine_eval } = require('../app/lib/engineApi');
const dbConfig = require('./lib/dbConfig');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const ONE_MINUTE = 60 * 1000;

// Background game review can afford deeper search than the interactive
// /api/engine/eval default (10) since there's no user waiting on it.
const EVAL_DEPTH = 12;

// ---------------------------------------------------------------------------
// winningChances(pawns)
//
// Converts an engine eval (in pawns, e.g. 1.23) to a winning-chances value
// on the range [-1, +1]:
//   +1  = White is certainly winning
//    0  = equal
//   -1  = Black is certainly winning
//
// Uses the lichess sigmoid calibrated on real game data. Input is clamped to
// ±10 pawns so already-won/lost positions don't dominate the loss calculation.
// ---------------------------------------------------------------------------
function winningChances(pawns) {
  const cp = Math.max(-1000, Math.min(1000, pawns * 100));
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}

// ---------------------------------------------------------------------------
// evalToPawns(evaluation)
//
// get_engine_eval() already normalizes the evaluation to White's perspective.
// Converts it to a plain pawns number: 'cp' is centipawns (divide by 100);
// 'mate' has no meaningful magnitude, so store a large-magnitude value with
// the correct sign (winningChances() clamps to ±10 pawns anyway, so only the
// sign matters for classification).
// ---------------------------------------------------------------------------
function evalToPawns(evaluation) {
  if (evaluation.type === 'mate') {
    return evaluation.value < 0 ? -100 : 100;
  }
  return evaluation.value / 100;
}

// ---------------------------------------------------------------------------
// classifyLoss(prevBest, currentEval, side, isMate)
//
// Returns 0=accurate, 1=inaccuracy, 2=mistake, 3=blunder, or null if the
// move cannot be classified (checkmate delivered, game over).
//
// Key design decisions:
//
// 1. WINNING-CHANCES DELTA, not raw centipawns.
//    A 1-pawn swing at ±0 is a blunder; the same swing at ±8 is irrelevant.
//    The sigmoid handles context automatically.
//
// 2. SIDE-AWARE sign convention.
//    currentEval is always from White's perspective.
//    White moved → winLoss = prevWin - currentWin  (positive = White worse)
//    Black moved → winLoss = currentWin - prevWin  (positive = Black worse)
// ---------------------------------------------------------------------------
function classifyLoss(prevBest, currentEval, side, isMate) {
  if (isMate) return null;

  const prevWin    = winningChances(prevBest);
  const currentWin = winningChances(currentEval);
  const winLoss    = side === 1
    ? prevWin - currentWin   // White moved: drop in White's chances
    : currentWin - prevWin;  // Black moved: rise in White's chances = Black worse

  if      (winLoss >= 0.30) return 3;  // blunder
  else if (winLoss >= 0.20) return 2;  // mistake
  else if (winLoss >= 0.10) return 1;  // inaccuracy
  else                      return 0;  // accurate
}

async function main() {
  while (true) {
    const startTime = Date.now();

    try {
      const conn = await mysql.createConnection(dbConfig);

      try {
        const [game] = await conn.execute(
          'SELECT game_id FROM game_moves WHERE final_eval IS NULL LIMIT 1'
        );

        if (game.length === 0) {
          // Nothing to evaluate — wait until next cycle
          await conn.end();
          const elapsed = Date.now() - startTime;
          if (elapsed < ONE_MINUTE) await wait(ONE_MINUTE - elapsed);
          continue;
        }

        const gameId = game[0].game_id;
        const [moves] = await conn.execute(
          'SELECT * FROM game_moves WHERE game_id = ? ORDER BY id ASC',
          [gameId]
        );

        if (moves.length === 0) {
          await conn.end();
          continue;
        }

        console.log(`Processing Game (${gameId}) @ ${new Date().toLocaleString()}`);

        // Opening detection setup
        const [naRows]       = await conn.execute("SELECT id FROM opening_book WHERE eco = '?' LIMIT 1");
        const fallbackBookId = naRows.length > 0 ? naRows[0].id : null;
        let lastBookId       = fallbackBookId;
        let pgn              = '';
        let movecnt          = 0;

        // Eval tracking — seed with the standard opening eval (White's perspective)
        let prevBest = 0.21;

        for (const move of moves) {
          const side = parseInt(move.side);

          // Build PGN string for opening detection
          if (side === 1) {
            movecnt++;
            pgn = pgn === '' ? `${movecnt}.` : `${pgn} ${movecnt}.`;
          }
          pgn = `${pgn} ${move.short_notation}`;

          const [bookRows] = await conn.execute(
            'SELECT id FROM opening_book WHERE pgn = ?',
            [pgn.trim()]
          );
          if (bookRows.length > 0) lastBookId = bookRows[0].id;

          // Evaluate the position via the engine API
          const { evaluation, in_check, is_mate } = await get_engine_eval({
            fen: move.fen,
            depth: EVAL_DEPTH
          });
          const currentEval = evalToPawns(evaluation);

          // Classify the move (null = unclassifiable, store as 0 = accurate)
          const lossResult      = classifyLoss(prevBest, currentEval, side, is_mate);
          const evalLossCategory = lossResult ?? 0;

          await conn.beginTransaction();
          try {
            await conn.execute(
              'UPDATE game_moves SET incheck = ?, mate = ?, final_eval = ?, loss = ? WHERE id = ?',
              [in_check, is_mate, currentEval, evalLossCategory, move.id]
            );
            await conn.commit();
          } catch (err) {
            await conn.rollback();
            console.error(`Error updating move ${move.id}:`, err);
          }

          // Advance prevBest for the next move. If the move was unclassifiable
          // (checkmate delivered), keep prevBest as-is.
          if (lossResult !== null) prevBest = currentEval;
        }

        // Stamp the detected opening on the game
        try {
          await conn.execute(
            'UPDATE user_games SET book_id = ? WHERE id = ?',
            [lastBookId, gameId]
          );
          console.log(`Updated Game (${gameId}) with book_id: ${lastBookId}`);
        } catch (err) {
          console.error(`Error updating opening for game ${gameId}:`, err);
        }

      } catch (err) {
        console.error('Database error:', err);
      } finally {
        await conn.end();
      }

    } catch (err) {
      console.error('Database connection error:', err);
    }

    const elapsed = Date.now() - startTime;
    if (elapsed < ONE_MINUTE) await wait(ONE_MINUTE - elapsed);
  }
}

main();
