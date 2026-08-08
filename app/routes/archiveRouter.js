const express = require('express');
const router = express.Router();
const { getLatestUserGames } = require('../lib/db');

const { renderPage } = require('../lib/renderPage');

const PAGE_SIZE = 30;

router.get('/', async (req, res) => {
  try {
    var rawPage = req.query.page;
    var page = /^[1-9]\d*$/.test(rawPage) ? Number.parseInt(rawPage, 10) : 1;

    var isLoggedIn = Boolean(req.session && req.session.user);
    var offset = (page - 1) * PAGE_SIZE;
    var rows = isLoggedIn ? await getLatestUserGames(req.session.user.id, PAGE_SIZE + 1, offset) : [];

    var hasNext = rows.length > PAGE_SIZE;
    var games = rows.slice(0, PAGE_SIZE);
    var hasPrev = page > 1;

    renderPage(res, 'main_template', 'archive', {
        mode: null,
        title: 'Magnus - Archive',
        showPromotionLayer: false,
        pageData: { games: games, page: page, hasPrev: hasPrev, hasNext: hasNext }
      }
    );
  }
  catch (err) {
    console.error(err);
    res.status(500).send('Databas Error');
  }
});

module.exports = router;
