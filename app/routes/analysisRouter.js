const express = require('express');
const router = express.Router();
const { pool, getUserGameForUser, getGameMoves } = require('../lib/db');

const { renderPage } = require('../lib/renderPage');
const { isValidFen, gameMoveToMoveInfo } = require('../lib/chess');

// Builds { moves, gameInfo, orientation } for a ?gameid= request, or null if
// the game shouldn't be preloaded (not logged in, bad id, or not this user's
// game -- see getUserGameForUser for the ownership join). Mirrors the graceful
// fallback the ?fen= path already uses: no match just means "don't preload".
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
  return {
    moves: moveRows.map(gameMoveToMoveInfo),
    gameInfo: {
      white: userGame.white,
      whiteElo: userGame.white_elo,
      black: userGame.black,
      blackElo: userGame.black_elo,
      result: userGame.result,
      termination: userGame.termination,
      timeControl: userGame.time_control,
      date: userGame.date,
      side: userGame.side
    },
    orientation: userGame.side === 0 ? 'black' : 'white'
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
