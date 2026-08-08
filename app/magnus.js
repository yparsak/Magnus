const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const indexRouter = require('./routes/indexRouter');
const editorRouter  = require('./routes/editorRouter');
const analysisRouter = require('./routes/analysisRouter');
const apiRouter   = require('./routes/apiRouter');
const authRouter  = require('./routes/authRouter');
const userRouter  = require('./routes/userRouter');
const archiveRouter = require('./routes/archiveRouter');

const { attachCurrentUser, requireAuth } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1m' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Session store defaults to express-session's in-memory MemoryStore, which is
// fine for local/dev use but does not survive restarts or scale across
// multiple processes -- swap in a persistent store (e.g. connect-session-sequelize,
// or a sessions table via app/lib/db.js) before running this in production.
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(attachCurrentUser);

// -- Routes --
app.use('/', authRouter);        // /login, /signup, /logout must stay reachable while unauthenticated
app.use('/', indexRouter);       // home page is public
app.use('/editor',editorRouter); // editor is viewable while unauthenticated
app.use('/analysis',analysisRouter); // analysis is viewable while unauthenticated
app.use('/user', userRouter);    // add-account page shows a login prompt when unauthenticated
app.use('/archive', archiveRouter); // User Game Archives...
app.use(requireAuth);
app.use('/api',   apiRouter);

app.listen(PORT, () => {
  console.log(`Magnus is running at http://localhost:${PORT}`);
});

module.exports = app;
