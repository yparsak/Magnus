const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../lib/db');

const { renderPage } = require('../lib/renderPage');

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 50;
const PASSWORD_MIN_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIGNUP_LINK_TTL_HOURS = 24;

function isValidUsername(username) {
  return typeof username === 'string'
    && username.trim().length >= USERNAME_MIN_LENGTH
    && username.trim().length <= USERNAME_MAX_LENGTH;
}

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

function showLoginForm(res, options = {}) {
  const { errorMessage = null, status = 200 } = options;

  res.status(status);
  renderPage(res, 'login', 'login', {
    errorMessage
  }, { title: 'Login' });
}

function showSignupForm(res, options = {}) {
  const { errorMessage = null, status = 200, values = {} } = options;

  res.status(status);
  renderPage(res, 'signup', 'signup', {
    errorMessage,
    values
  }, { title: 'Sign Up' });
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

router.get('/signup', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/');
  }

  return showSignupForm(res);
});

// Public AJAX endpoint the signup form polls to give the user early feedback.
// This is a UX nicety only -- POST /signup re-checks server-side regardless.
router.get('/signup/check-username', async (req, res) => {
  const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';

  if (!isValidUsername(username)) {
    return res.status(400).json({
      available: false,
      message: `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters.`
    });
  }

  try {
    const taken = await usernameExists(username);
    return res.json({ available: !taken });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ available: false, message: 'Something went wrong. Please try again.' });
  }
});

router.post('/signup', async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const values = { username, email };

  if (!isValidUsername(username)) {
    return showSignupForm(res, {
      status: 400,
      errorMessage: `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters.`,
      values
    });
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return showSignupForm(res, {
      status: 400,
      errorMessage: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      values
    });
  }

  if (!isValidEmail(email)) {
    return showSignupForm(res, {
      status: 400,
      errorMessage: 'Please enter a valid email address.',
      values
    });
  }

  try {
    if (await usernameExists(username)) {
      return showSignupForm(res, {
        status: 400,
        errorMessage: 'That username is already taken.',
        values
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const linkId = crypto.randomBytes(32).toString('hex');

    await pool.query(
      'INSERT INTO SignUp (link_id, username, email, password_hash) VALUES (?, ?, ?, ?)',
      [linkId, username, email, passwordHash]
    );

    return res.redirect(`/validateemail?id=${linkId}`);
  } catch (err) {
    console.error(err);
    return showSignupForm(res, { status: 500, errorMessage: 'Something went wrong. Please try again.', values });
  }
});

router.get('/validateemail', async (req, res) => {
  const linkId = typeof req.query.id === 'string' ? req.query.id : '';
  const invalidLinkError = 'This sign-up link is invalid or has expired. Please sign up again.';

  try {
    const [rows] = await pool.query(
      `SELECT * FROM SignUp WHERE link_id = ? AND created_at > (NOW() - INTERVAL ${SIGNUP_LINK_TTL_HOURS} HOUR) LIMIT 1`,
      [linkId]
    );
    const pendingSignup = rows[0];

    if (!pendingSignup) {
      return showSignupForm(res, { status: 400, errorMessage: invalidLinkError });
    }

    let insertId;
    try {
      const [result] = await pool.query(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
        [pendingSignup.username, pendingSignup.email, pendingSignup.password_hash]
      );
      insertId = result.insertId;
    } catch (err) {
      // Race: another concurrent signup already claimed this username.
      console.error(err);
      return showSignupForm(res, { status: 400, errorMessage: invalidLinkError });
    }

    await pool.query('DELETE FROM SignUp WHERE id = ?', [pendingSignup.id]);

    req.session.regenerate((err) => {
      if (err) {
        console.error(err);
        return showSignupForm(res, { status: 500, errorMessage: 'Something went wrong. Please try again.' });
      }

      req.session.user = { id: insertId, username: pendingSignup.username };
      return res.redirect('/');
    });
  } catch (err) {
    console.error(err);
    return showSignupForm(res, { status: 500, errorMessage: 'Something went wrong. Please try again.' });
  }
});

async function usernameExists(username) {
  const [rows] = await pool.query(
    'SELECT id FROM users WHERE username = ? LIMIT 1',
    [username]
  );
  return Boolean(rows[0]);
}

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
