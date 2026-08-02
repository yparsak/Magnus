const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../lib/db');

const { renderPage } = require('../lib/renderPage');

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 50;
const PASSWORD_MIN_LENGTH = 8;

function isValidUsername(username) {
  return typeof username === 'string'
    && username.trim().length >= USERNAME_MIN_LENGTH
    && username.trim().length <= USERNAME_MAX_LENGTH;
}

function showLoginForm(res, options = {}) {
  const { errorMessage = null, status = 200 } = options;

  res.status(status);
  renderPage(res, 'login', 'login', {
    errorMessage
  }, { title: 'Login' });
}

router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/');
  }

  return showLoginForm(res);
});

router.post('/login', async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';

  if (!isValidUsername(username)) {
    return showLoginForm(res, {
      status: 400,
      errorMessage: `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters.`
    });
  }

  try {
    const user = await authenticateWithPassword(username, req.body.password);

    if (!user) {
      return showLoginForm(res, {
        status: 401,
        errorMessage: 'Invalid username or password.'
      });
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error(err);
        return showLoginForm(res, { status: 500, errorMessage: 'Something went wrong. Please try again.' });
      }

      req.session.user = { id: user.id, username: user.username };
      return res.redirect('/');
    });
  } catch (err) {
    console.error(err);
    return showLoginForm(res, { status: 500, errorMessage: 'Something went wrong. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Real credential check against the stored bcrypt hash.
async function authenticateWithPassword(username, password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return null;
  }

  const [rows] = await pool.query(
    'SELECT id, username, password_hash FROM users WHERE username = ? LIMIT 1',
    [username]
  );
  const user = rows[0];
  if (!user || !user.password_hash) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  return passwordMatches ? user : null;
}

module.exports = router;
