'use strict';

require('dotenv').config({
  path: require('path').resolve(__dirname, '../app/.env'),
  quiet: true
});

const mysql    = require('mysql2/promise');
const sf       = require('../app/lib/stockfish');
const dbConfig = require('./lib/dbConfig');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const ONE_MINUTE = 60 * 1000;

// ---------------------------------------------------------------------------
// winningChances(pawns)
//
// Converts a Stockfish eval (in pawns, e.g. 1.23) to a winning-chances value
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
// classifyLoss(prevBest, currentEval, currentBest, side, incheck, mate)
//
// Returns 0=accurate, 1=inaccuracy, 2=mistake, 3=blunder, or null if the
// move cannot be classified (checkmate, or forced-mate-in-check sentinel).
//
// Key design decisions:
//
// 1. WINNING-CHANCES DELTA, not raw centipawns.
//    A 1-pawn swing at ±0 is a blunder; the same swing at ±8 is irrelevant.
//    The sigmoid handles context automatically.
//
// 2. SIDE-AWARE sign convention.
//    Stockfish always scores from White's perspective.
//    White moved → winLoss = prevWin - currentWin  (positive = White worse)
//    Black moved → winLoss = currentWin - prevWin  (positive = Black worse)
//
// 3. IN-CHECK sentinel handling.
//    When the resulting position is in check, Stockfish sets final_eval = 0
//    (a sentinel, not a real score). We recover the real position value by
//    negating best_eval, which is the opponent's best-reply score — so from
//    White's perspective it is -best_eval.
//
//    Exception: if best_eval is also 0, the engine found a forced mate and
//    there is no meaningful numeric evaluation. Skip classification.
//
// 4. CHECKMATE: always skipped (game is over).
// ---------------------------------------------------------------------------
function classifyLoss(prevBest, currentEval, currentBest, side, incheck, mate) {
  if (mate) return null;

  let realEval;
  if (incheck && currentEval === 0) {
    // best_eval = 0 signals forced mate detected — unclassifiable
    if (currentBest === 0) return null;
    // best_eval is the opponent's score; negate for White's perspective
    realEval = -currentBest;
  } else {
    realEval = currentEval;
  }

  const prevWin    = winningChances(prevBest);
  const currentWin = winningChances(realEval);
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

          // Evaluate the position via Stockfish
          const rawOutput   = await sf.getStockfishData(move.fen);
          const evalData    = sf.parseEval(rawOutput);
          const currentEval = parseFloat(evalData.final);
          const currentBest = parseFloat(evalData.best_eval) || 0;
          const incheck     = evalData.in_check;
          const mate        = evalData.mate;

          // Classify the move (null = unclassifiable, store as 0 = accurate)
          const lossResult      = classifyLoss(prevBest, currentEval, currentBest, side, incheck, mate);
          const evalLossCategory = lossResult ?? 0;

          await conn.beginTransaction();
          try {
            await conn.execute(
              'UPDATE game_moves SET incheck = ?, mate = ?, final_eval = ?, best_eval = ?, loss = ? WHERE id = ?',
              [incheck, mate, currentEval, currentBest, evalLossCategory, move.id]
            );
            await conn.commit();
          } catch (err) {
            await conn.rollback();
            console.error(`Error updating move ${move.id}:`, err);
          }

          // Advance prevBest for the next move.
          // For in-check sentinels where we recovered realEval via -best_eval,
          // use that recovered value so the next move's baseline is correct.
          // If the move was unclassifiable (forced mate / checkmate), keep prevBest.
          if (lossResult !== null) {
            const realEval = (incheck && currentEval === 0) ? -currentBest : currentEval;
            if (!isNaN(realEval)) prevBest = realEval;
          }
        }

        // Stamp the detected opening on the game
        try {
          await conn.execute(
            'UPDATE player_games SET book_id = ? WHERE id = ?',
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
