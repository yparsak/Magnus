const express = require('express');
const router = express.Router();

const { renderPage } = require('../lib/renderPage');
const { requireAuth } = require('../lib/auth');
const { ValidationError } = require('../lib/chess');
const { getUserGameForUser, getGameMoves } = require('../lib/db');
const {
  startGame,
  playUserMove,
  takeBack,
  resign,
  rowToClient
} = require('../lib/playEngine');

// Unlike /analysis and /editor, every route here needs a logged-in user --
// a game is saved under their account from the first move. magnus.js's
// global requireAuth only covers /api (it's mounted after the page
// routers), so this router gates itself.
router.use(requireAuth);

function handleError(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

// The play page itself. ?gameid= resumes a game already in progress (e.g.
// after a refresh); without it the page renders with no game and the
// side-selection popup asks which king the user wants.
router.get('/engine', async (req, res) => {
  try {
    var pageData = { game: null };

    var rawGameId = req.query.gameid;
    if (typeof rawGameId === 'string' && /^[1-9]\d*$/.test(rawGameId)) {
      var userGame = await getUserGameForUser(req.session.user.id, Number.parseInt(rawGameId, 10));
      if (userGame) {
        var moveRows = await getGameMoves(userGame.id);
        pageData.game = {
          gameId: userGame.id,
          userColor: userGame.side === 1 ? 'w' : 'b',
          white: userGame.white,
          black: userGame.black,
          moves: moveRows.map(rowToClient),
          finished: Boolean(userGame.result),
          result: userGame.result,
          termination: userGame.termination
        };
      }
    }

    renderPage(res, 'main_template', 'play_engine', {
      mode: 'play',
      title: 'Magnus - Play Engine',
      showPromotionLayer: false,
      pageData: pageData
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database Error');
  }
});

// -- Game API ---------------------------------------------------------------
// Mounted under /play rather than /api so the whole feature (page + its
// endpoints) lives behind this router's single requireAuth.

router.post('/api/start', async (req, res) => {
  try {
    const side = (req.body || {}).side;
    const game = await startGame(req.session.user, side);
    res.json(game);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/api/move', async (req, res) => {
  try {
    const { gameId, from, to, promotion } = req.body || {};
    if (!Number.isInteger(gameId)) {
      throw new ValidationError('A numeric "gameId" is required.');
    }
    const result = await playUserMove(req.session.user.id, gameId, { from, to, promotion });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/api/takeback', async (req, res) => {
  try {
    const { gameId } = req.body || {};
    if (!Number.isInteger(gameId)) {
      throw new ValidationError('A numeric "gameId" is required.');
    }
    const result = await takeBack(req.session.user.id, gameId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/api/resign', async (req, res) => {
  try {
    const { gameId } = req.body || {};
    if (!Number.isInteger(gameId)) {
      throw new ValidationError('A numeric "gameId" is required.');
    }
    const result = await resign(req.session.user.id, gameId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
