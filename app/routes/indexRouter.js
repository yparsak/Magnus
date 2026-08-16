const express = require('express');
const router = express.Router();
const { getUserAccountsWithStats, getTopOpeningsForAccounts } = require('../lib/db');

const { renderPage } = require('../lib/renderPage');

router.get('/', async (req, res) => {
  try {
    const isLoggedIn = Boolean(req.session && req.session.user);
    let accounts = [];

    if (isLoggedIn) {
      const accountRows = await getUserAccountsWithStats(req.session.user.id);
      const accountIds = accountRows.map((row) => row.account_id);
      const openingsByAccount = await getTopOpeningsForAccounts(accountIds);

      accounts = accountRows.map((row) => {
        const totalGames = Number(row.total_games) || 0;
        const wins = Number(row.wins) || 0;

        return {
          accountId: row.account_id,
          accountname: row.accountname,
          platformName: row.platform_name,
          owner: Boolean(row.owner),
          totalGames,
          wins,
          losses: Number(row.losses) || 0,
          draws: Number(row.draws) || 0,
          winRate: totalGames > 0 ? (wins / totalGames) * 100 : null,
          avgAccuracy: row.avg_accuracy !== null ? Number(row.avg_accuracy) : null,
          topOpenings: openingsByAccount[row.account_id] || []
        };
      });
    }

    renderPage(res, 'main_template', 'index', {
        mode: null,
        title: 'Magnus',
        showPromotionLayer: false,
        pageData: { isLoggedIn: isLoggedIn, accounts: accounts }
      }
    );
  }
  catch (err) {
    console.error(err);
    res.status(500).send('Databas Error');
  }
});

module.exports = router;
