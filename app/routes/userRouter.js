const express = require('express');
const router = express.Router();
const { verifyPlatformAccount } = require('../lib/platformVerifier');
const { pool, 
        getPlatforms,
        getPlatformAccount,
        insertPlatformAccount,
        getUserAccount,
        insertUserAccount } = require('../lib/db');

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

    let AccountID = null;
    AccountID = await getPlatformAccount(platformId, accountname);

    if (AccountID === null) {
      const validAccount = await verifyPlatformAccount(platformId, accountname);
      if ( validAccount ) {
        AccountID = await insertPlatformAccount(platformId, accountname);
      } else {
        return showAddAccountForm(res, {
        status: 400,
        errorMessage: `Account Name ${accountname} is not valid`,
        values,
        platforms
        });
      }
    }

    if (AccountID === null) {
      return showAddAccountForm(res, {
        status: 400,
        errorMessage: `Unable to add ${accountname}`,
        values,
        platforms
      });
    } else {
      const userid = await getUserAccount(req.session.user.id, AccountID);
      if (userid === null) {
        const useraccount = await insertUserAccount(req.session.user.id, AccountID, myOwn);
        if (useraccount === null) {
          return showAddAccountForm(res, {
            status: 400,
            errorMessage: `Unable to add ${accountname} `,
            values,
            platforms
          });
        } else {
          return res.redirect('/user/add_account?added=1');
        }
      } else {
        return showAddAccountForm(res, {
          status: 400,
          errorMessage: `User Account ${accountname} already found in database`,
          values,
          platforms
        });
      }
    }

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
