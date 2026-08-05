const express = require('express');
const router = express.Router();
const { verifyPlatformUser } = require('../lib/platformVerifier');
const { pool } = require('../lib/db');

const { renderPage } = require('../lib/renderPage');

const ACCOUNTNAME_MAX_LENGTH = 20;

function isValidAccountname(accountname) {
  return typeof accountname === 'string'
    && accountname.trim().length > 0
    && accountname.trim().length <= ACCOUNTNAME_MAX_LENGTH;
}

function isValidAccountType(accountType) {
  return accountType === 'a' || accountType === 'b';
}

async function getPlatforms() {
  const [rows] = await pool.query('SELECT id, name FROM platforms ORDER BY id');
  return rows;
}

function showAddAccountForm(res, options = {}) {
  const {
    status = 200,
    errorMessage = null,
    successMessage = null,
    values = {},
    platforms = []
  } = options;

  res.status(status);
  renderPage(res, 'main_template', 'add_account', {
    mode: null,
    errorMessage,
    successMessage,
    values,
    platforms
  }, { title: 'Magnus - Add Chess Account' });
}

router.get('/add_account', async (req, res) => {
  try {
    const isLoggedIn = Boolean(req.session && req.session.user);
    const platforms = isLoggedIn ? await getPlatforms() : [];
    const successMessage = req.query.added === '1' ? 'Chess account added successfully.' : null;

    return showAddAccountForm(res, {
      platforms,
      successMessage,
      values: { account_type: 'a' }
    });
  } catch (err) {
    console.error(err);
    return showAddAccountForm(res, { status: 500, errorMessage: 'Something went wrong. Please try again.' });
  }
});

router.post('/add_account', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/user/add_account');
  }

  const platformId = Number.parseInt(req.body.platform_id, 10);
  const accountname = typeof req.body.accountname === 'string' ? req.body.accountname.trim() : '';
  const accountType = req.body.account_type;
  const values = { platform_id: req.body.platform_id, accountname, account_type: accountType };

  try {
    const platforms = await getPlatforms();
    const validPlatformIds = platforms.map((platform) => platform.id);

    if (!validPlatformIds.includes(platformId)) {
      return showAddAccountForm(res, {
        status: 400,
        errorMessage: 'Please select a valid platform.',
        values,
        platforms
      });
    }

    if (!isValidAccountname(accountname)) {
      return showAddAccountForm(res, {
        status: 400,
        errorMessage: `Account name must be between 1 and ${ACCOUNTNAME_MAX_LENGTH} characters.`,
        values,
        platforms
      });
    }

    if (!isValidAccountType(accountType)) {
      return showAddAccountForm(res, {
        status: 400,
        errorMessage: 'Please choose whether this is your own account or one you are following.',
        values,
        platforms
      });
    }

    const myOwn = accountType === 'a' ? 1 : 0;

    const userExists = await verifyPlatformUser(platformId, accountname);

    if (!userExists) {
      return showAddAccountForm(res, {
        status: 400,
        errorMessage: 'Account doesnt exist',
        values
      });
    }

    await pool.query(
      'INSERT INTO accounts (user_id, platform_id, accountname, last_scan, myown) VALUES (?, ?, ?, NULL, ?)',
      [req.session.user.id, platformId, accountname, myOwn]
    );

    return res.redirect('/user/add_account?added=1');
  } catch (err) {
    console.error(err);
    return showAddAccountForm(res, {
      status: 500,
      errorMessage: 'Something went wrong. Please try again.',
      values
    });
  }
});

module.exports = router;
