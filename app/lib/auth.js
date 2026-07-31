'use strict';

// Auth is a cohesive domain concern (session state, gating, USE_AUTH toggle),
// so it gets its own module rather than living inline in magnus.js or a router.

function isAuthEnabled() {
  const value = String(process.env.USE_AUTH || '').trim().toUpperCase();
  return value === '1' || value === 'TRUE';
}

// Makes the current session user (and the USE_AUTH mode) available to every
// view via res.locals, so partials like header_right.ejs can render without
// each router having to pass it in explicitly.
function attachCurrentUser(req, res, next) {
  res.locals.currentUser = (req.session && req.session.user) || null;
  res.locals.authEnabled = isAuthEnabled();
  next();
}

// Gates everything mounted after it except the login routes and static assets.
// API requests get a JSON 401 (an API consumer can't follow an HTML redirect),
// page requests get redirected to the login page.
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  if (req.originalUrl.startsWith('/api')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      error: { code: 'UNAUTHENTICATED' }
    });
  }

  return res.redirect('/login');
}

module.exports = { isAuthEnabled, attachCurrentUser, requireAuth };
