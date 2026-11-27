'use strict';

/**
 * playEngine.js
 * Server-side rules and persistence for "Play Engine" games (see
 * routes/playRouter.js and public/js/play.chess.js).
 *
 * The database is authoritative: every request rebuilds the position by
 * replaying the game's stored game_moves rows rather than trusting a FEN
 * from the client, so a tampered or merely stale browser can't desync the
 * saved game from the board. The client still keeps its own chess.js copy
 * for instant feedback -- it just doesn't get the last word.
 */

const { Chess } = require('../public/js/chess.min.js');
const { ValidationError } = require('./chess');
const { get_engine_bestmove } = require('./engineApi');
const {
  getUserGameForUser,
  getGameMoves,
  getOrCreateEngineAccount,
  createEngineGame,
  appendGameMove,
  deleteLastGameMoves,
  finishEngineGame
} = require('./db');

const ENGINE_NAME = 'Engine';
const ENGINE_DEPTH = 10;

// How far below the best line a move may score and still be considered for
// the engine's reply, in centipawns. Wide enough that the engine doesn't
// play the same book line every game, tight enough that it never throws
// away real material to do it.
const MOVE_SPREAD_CP = 50;

/**
 * Replays a game's stored moves into a chess.js instance.
 * @param {Array<Object>} moveRows rows from getGameMoves, in insertion order
 * @returns {Chess}
 */
function positionFromMoves(moveRows) {
  const chess = new Chess();
  for (const row of moveRows) {
    // long_notation is chess.js "lan" (from+to+optional promotion letter);
    // sloppy mode is what lib/chess.js already uses to parse it.
    if (!chess.move(row.long_notation, { sloppy: true })) {
      throw new Error(`Stored game ${row.game_id} contains an illegal move: ${row.long_notation}`);
    }
  }
  return chess;
}

/**
 * Converts a chess.js move object into the column shape game_moves expects.
 * `side` is 1 for a white move and 0 for black, matching the importer and
 * lib/chess.js gameMoveToMoveInfo.
 */
function moveToRow(moveObj, fenAfter) {
  return {
    fen: fenAfter,
    shortNotation: moveObj.san,
    longNotation: moveObj.from + moveObj.to + (moveObj.promotion || ''),
    side: moveObj.color === 'w' ? 1 : 0
  };
}

/**
 * The client-facing description of a played move.
 */
function moveToClient(moveObj, fenAfter) {
  return {
    san: moveObj.san,
    from: moveObj.from,
    to: moveObj.to,
    promotion: moveObj.promotion || null,
    color: moveObj.color,
    fen: fenAfter
  };
}

/**
 * Describes how (and whether) the game has ended, from the perspective of
 * the user's side. `result`/`points` use the same vocabulary the importer
 * writes so the archive and stats queries need no special-casing.
 * @param {Chess} chess
 * @param {('w'|'b')} userColor
 * @returns {{ over: boolean, result: string|null, points: number|null, termination: string|null, reason: string|null }}
 */
function describeOutcome(chess, userColor) {
  if (!chess.game_over()) {
    return { over: false, result: null, points: null, termination: null, reason: null };
  }

  if (chess.in_checkmate()) {
    // chess.turn() is the side that has been mated.
    const userWon = chess.turn() !== userColor;
    return {
      over: true,
      result: userWon ? 'win' : 'loss',
      points: userWon ? 2 : 0,
      termination: 'Checkmate',
      reason: 'checkmate'
    };
  }

  let termination = 'Draw';
  let reason = 'draw';
  if (chess.in_stalemate()) {
    termination = 'Stalemate';
    reason = 'stalemate';
  } else if (chess.insufficient_material()) {
    termination = 'Insufficient material';
    reason = 'insufficient material';
  } else if (chess.in_threefold_repetition()) {
    termination = 'Threefold repetition';
    reason = 'threefold repetition';
  } else {
    termination = 'Fifty-move rule';
    reason = 'the fifty-move rule';
  }

  return { over: true, result: 'draw', points: 1, termination, reason };
}

/**
 * Picks the engine's reply: a uniformly random choice among the lines
 * scoring within MOVE_SPREAD_CP of the best one, from the engine's own
 * point of view.
 *
 * engineApi normalizes scores to White's perspective, so they're flipped
 * back here before comparing -- otherwise "within 50cp of the best" would
 * mean "within 50cp of the worst" whenever the engine has Black. Mate
 * scores aren't on the centipawn scale at all: when any line mates, the
 * choice is restricted to the mating lines (shortest mate first), so the
 * engine never trades a forced mate for a merely good move. Likewise a
 * line that gets mated is only ever chosen if every line does.
 *
 * @param {Array<{move: string, score: {type: string, value: number}}>} lines
 * @param {('w'|'b')} engineColor
 * @returns {string|null} the SAN of the chosen move
 */
function chooseEngineMove(lines, engineColor) {
  if (!lines.length) {
    return null;
  }

  // Re-express every score from the engine's own perspective.
  const sign = engineColor === 'w' ? 1 : -1;
  const scored = lines.map((line) => ({
    move: line.move,
    type: line.score.type,
    value: line.score.value * sign
  }));

  const winningMates = scored.filter((entry) => entry.type === 'mate' && entry.value > 0);
  if (winningMates.length) {
    // Shorter mates first; pick at random among the equally short ones.
    const shortest = Math.min(...winningMates.map((entry) => entry.value));
    return pickRandom(winningMates.filter((entry) => entry.value === shortest)).move;
  }

  const nonLosing = scored.filter((entry) => entry.type !== 'mate');
  if (!nonLosing.length) {
    // Every line is a forced loss -- delay it as long as possible.
    const longest = Math.min(...scored.map((entry) => entry.value));
    return pickRandom(scored.filter((entry) => entry.value === longest)).move;
  }

  const best = Math.max(...nonLosing.map((entry) => entry.value));
  const candidates = nonLosing.filter((entry) => entry.value >= best - MOVE_SPREAD_CP);
  return pickRandom(candidates).move;
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Plays the engine's reply in `chess` and records it, if the game is still
 * running. Returns the move as sent to the client, or null if the game is
 * already over (or the engine produced nothing).
 */
async function playEngineReply(chess, gameId) {
  if (chess.game_over()) {
    return null;
  }

  const engineColor = chess.turn();
  const lines = await get_engine_bestmove({ fen: chess.fen(), depth: ENGINE_DEPTH });
  const san = chooseEngineMove(lines, engineColor);
  if (!san) {
    return null;
  }

  const moveObj = chess.move(san);
  if (!moveObj) {
    // The engine returned something illegal for this position, which would
    // mean engine/board disagreement -- fail loudly rather than silently
    // skipping the engine's turn and leaving the user to move twice.
    throw new Error(`Engine proposed an illegal move "${san}" in ${chess.fen()}`);
  }

  const fenAfter = chess.fen();
  await appendGameMove(gameId, moveToRow(moveObj, fenAfter));
  return moveToClient(moveObj, fenAfter);
}

/**
 * Loads an engine game the user owns, along with its replayed position.
 * @throws {ValidationError} if the game doesn't exist, isn't theirs, or has
 *   already finished
 */
async function loadLiveGame(userId, gameId) {
  const userGame = await getUserGameForUser(userId, gameId);
  if (!userGame) {
    throw new ValidationError('Game not found.');
  }
  if (userGame.result) {
    throw new ValidationError('This game has already finished.');
  }

  const moveRows = await getGameMoves(gameId);
  return {
    userGame,
    moveRows,
    chess: positionFromMoves(moveRows),
    userColor: userGame.side === 1 ? 'w' : 'b'
  };
}

/**
 * Finalizes a game that has just ended, and returns the client-facing
 * outcome. A no-op for a game that's still running.
 */
async function finalizeIfOver(chess, gameId, userColor) {
  const outcome = describeOutcome(chess, userColor);
  if (outcome.over) {
    await finishEngineGame(gameId, {
      result: outcome.result,
      points: outcome.points,
      termination: outcome.termination
    });
  }
  return outcome;
}

/**
 * Starts a new game. When the user takes Black the engine's opening move is
 * played and saved before this returns, so the board is already on move 1
 * when the page first renders.
 *
 * @param {{id: number, username: string}} user
 * @param {('w'|'b')} userColor
 * @returns {Promise<{gameId: number, userColor: string, white: string, black: string, moves: Array}>}
 */
async function startGame(user, userColor) {
  if (userColor !== 'w' && userColor !== 'b') {
    throw new ValidationError('Side must be "w" or "b".');
  }

  const { accountId, platformId } = await getOrCreateEngineAccount(user.id, user.username);
  const white = userColor === 'w' ? user.username : ENGINE_NAME;
  const black = userColor === 'w' ? ENGINE_NAME : user.username;
  const now = new Date();

  const gameId = await createEngineGame(accountId, platformId, {
    // user_games.game_id is unique per account, not globally -- the
    // timestamp plus the user's colour is enough to keep one user's own
    // games apart.
    gameId: `engine-${now.getTime()}-${userColor}`,
    side: userColor === 'w' ? 1 : 0,
    white,
    black,
    date: now
  });

  const moves = [];
  if (userColor === 'b') {
    const chess = new Chess();
    const engineMove = await playEngineReply(chess, gameId);
    if (engineMove) {
      moves.push(engineMove);
    }
  }

  return { gameId, userColor, white, black, moves };
}

/**
 * Records the user's move and answers with the engine's reply.
 *
 * @param {number} userId
 * @param {number} gameId
 * @param {{from: string, to: string, promotion?: string}} move
 */
async function playUserMove(userId, gameId, move) {
  const { chess, userColor } = await loadLiveGame(userId, gameId);

  if (chess.turn() !== userColor) {
    throw new ValidationError('It is not your turn.');
  }
  if (!move || typeof move.from !== 'string' || typeof move.to !== 'string') {
    throw new ValidationError('A move needs "from" and "to" squares.');
  }

  const userMoveObj = chess.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion || undefined
  });
  if (!userMoveObj) {
    throw new ValidationError('Illegal move.');
  }

  const fenAfterUser = chess.fen();
  await appendGameMove(gameId, moveToRow(userMoveObj, fenAfterUser));

  // The user's move may itself have ended the game (mate, stalemate, a
  // drawing capture) -- in which case there's no reply to play.
  let outcome = await finalizeIfOver(chess, gameId, userColor);
  if (outcome.over) {
    return {
      userMove: moveToClient(userMoveObj, fenAfterUser),
      engineMove: null,
      fen: chess.fen(),
      outcome
    };
  }

  const engineMove = await playEngineReply(chess, gameId);
  outcome = await finalizeIfOver(chess, gameId, userColor);

  return {
    userMove: moveToClient(userMoveObj, fenAfterUser),
    engineMove,
    fen: chess.fen(),
    outcome
  };
}

/**
 * Takes back the user's last move together with the engine's reply to it,
 * leaving the board on the user's turn, and removes both plies from the
 * saved game.
 *
 * Which plies to drop is derived from whose move the last stored one was,
 * not assumed to be two: when the user has Black the game starts with the
 * engine's opening move, and a take-back at that point must leave that
 * opening move in place rather than emptying the game.
 *
 * @returns {Promise<{moves: Array, fen: string}>} the game as it now stands
 */
async function takeBack(userId, gameId) {
  const { moveRows, userColor } = await loadLiveGame(userId, gameId);

  const userSide = userColor === 'w' ? 1 : 0;
  // Walk back to (and including) the user's most recent move.
  let toDrop = 0;
  for (let i = moveRows.length - 1; i >= 0; i--) {
    toDrop++;
    if (moveRows[i].side === userSide) {
      break;
    }
  }

  const droppedUserMove = moveRows.length > 0 &&
    moveRows[moveRows.length - toDrop].side === userSide;
  if (!toDrop || !droppedUserMove) {
    // Nothing of the user's to take back (an empty game, or one holding
    // only the engine's opening move).
    const chess = positionFromMoves(moveRows);
    return { moves: moveRows.map(rowToClient), fen: chess.fen() };
  }

  await deleteLastGameMoves(gameId, toDrop);

  const remaining = moveRows.slice(0, moveRows.length - toDrop);
  const chess = positionFromMoves(remaining);
  return { moves: remaining.map(rowToClient), fen: chess.fen() };
}

/**
 * Converts a stored game_moves row into the same client shape as a freshly
 * played move.
 */
function rowToClient(row) {
  return {
    san: row.short_notation,
    from: row.long_notation.slice(0, 2),
    to: row.long_notation.slice(2, 4),
    promotion: row.long_notation.length > 4 ? row.long_notation.charAt(4) : null,
    color: row.side ? 'w' : 'b',
    fen: row.fen
  };
}

/**
 * Resigns a live game, recording it as a loss for the user.
 */
async function resign(userId, gameId) {
  const { userColor } = await loadLiveGame(userId, gameId);
  await finishEngineGame(gameId, {
    result: 'loss',
    points: 0,
    termination: 'Resignation'
  });
  return {
    outcome: {
      over: true,
      result: 'loss',
      points: 0,
      termination: 'Resignation',
      reason: 'resignation',
      userColor
    }
  };
}

module.exports = {
  startGame,
  playUserMove,
  takeBack,
  resign,
  rowToClient,
  describeOutcome,
  chooseEngineMove,
  ENGINE_NAME,
  MOVE_SPREAD_CP
};
