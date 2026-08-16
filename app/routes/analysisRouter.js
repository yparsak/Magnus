const express = require('express');
const router = express.Router();
const {
  pool,
  getUserGameForUser,
  getAdjacentUserGameIds,
  getGameMoves,
  getOpeningBookById,
  getFallbackOpeningBookId,
  setUserGameBookId
} = require('../lib/db');

const { renderPage } = require('../lib/renderPage');
const { isValidFen, gameMoveToMoveInfo } = require('../lib/chess');
const { findOpeningMatch } = require('../lib/openingBook');

// Resolves the opening for a stored game, persisting book_id the first time
// (mirrors scripts/evaluateGames.js's own convention of stamping the '?'
// sentinel when nothing matches, so this only runs once per game rather than
// re-querying opening_book on every page load).
async function resolveGameOpening(userGame, moveRows) {
  if (userGame.book_id) {
    return getOpeningBookById(userGame.book_id);
  }

  var sanMoves = moveRows.map((row) => row.short_notation);
  var match = await findOpeningMatch(pool, sanMoves, 10);
  if (match) {
    await setUserGameBookId(userGame.id, match.id);
    return { eco: match.eco, name: match.name };
  }

  var fallbackId = await getFallbackOpeningBookId();
  if (fallbackId) {
    await setUserGameBookId(userGame.id, fallbackId);
  }
  return { eco: '?', name: '?' };
}

// Builds { moves, gameInfo, orientation, opening } for a ?gameid= request, or
// null if the game shouldn't be preloaded (not logged in, bad id, or not this
// user's game -- see getUserGameForUser for the ownership join). Mirrors the
// graceful fallback the ?fen= path already uses: no match just means "don't
// preload".
async function loadGamePageData(req) {
  var rawGameId = req.query.gameid;
  var isLoggedIn = Boolean(req.session && req.session.user);
  if (!isLoggedIn || typeof rawGameId !== 'string' || !/^[1-9]\d*$/.test(rawGameId)) {
    return null;
  }
  var gameId = Number.parseInt(rawGameId, 10);

  var userGame = await getUserGameForUser(req.session.user.id, gameId);
  if (!userGame) {
    return null;
  }

  var moveRows = await getGameMoves(userGame.id);
  var adjacentGameIds = await getAdjacentUserGameIds(req.session.user.id, userGame.date, userGame.id);
  return {
    moves: moveRows.map(gameMoveToMoveInfo),
    prevGameId: adjacentGameIds.prevGameId,
    nextGameId: adjacentGameIds.nextGameId,
    gameInfo: {
      white: userGame.white,
      whiteElo: userGame.white_elo,
      whiteAccuracy: userGame.white_accuracy,
      black: userGame.black,
      blackElo: userGame.black_elo,
      blackAccuracy: userGame.black_accuracy,
      result: userGame.result,
      termination: userGame.termination,
      timeControl: userGame.time_control,
      date: userGame.date,
      side: userGame.side
    },
    orientation: userGame.side === 0 ? 'black' : 'white',
    opening: await resolveGameOpening(userGame, moveRows)
  };
}

router.get('/', async (req, res) => {
  try {
    var fen = req.query.fen;
    var gamePageData = await loadGamePageData(req);
    var pageData = gamePageData || ((typeof fen === 'string' && isValidFen(fen)) ? { fen: fen } : {});

    renderPage (res,'main_template', 'analysis', {
        mode: 'editor',
        title: 'Magnus - Analysis Board',
        showPromotionLayer: false,
        pageData: pageData
      }
    );
  }
  catch (err) {
    console.error(err);
    res.status(500).send('Databas Error');
  }
});

module.exports = router;
