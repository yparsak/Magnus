const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function testConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

async function getPlatforms() {
  const [rows] = await pool.query('SELECT id, name FROM platforms ORDER BY id');
  return rows;
}

async function getPlatformAccount(platformId, accountname) {
  const [rows] = await pool.query('SELECT id FROM accounts WHERE platform_id = ? AND accountname = ? LIMIT 1;',
      [platformId, accountname]
      );
  return rows.length ? rows[0].id : null; 
}

async function insertPlatformAccount(platformId, accountname) {
    const [result] = await pool.query(
        'INSERT INTO accounts (platform_id, accountname) VALUES (?, ?)',
        [platformId, accountname]
    );
    return result.insertId;
}

async function getUserAccount(userid, AccountID) {
  const [rows] = await pool.query(
    'SELECT id FROM user_accounts WHERE user_id = ? AND account_id = ? LIMIT 1;',
    [userid, AccountID]
  );
  return rows.length ? rows[0].id : null; 
}

async function insertUserAccount(userid, AccountID, owner) {
    const [result] = await pool.query(
        'INSERT INTO user_accounts (user_id, account_id, owner) VALUES (?, ?, ?)',
        [userid, AccountID, owner]
    );
    return result.insertId;
}

// Returns the user_games row only if it belongs to an account owned/followed
// by userId -- joins through accounts (matching both account_id and
// platform_id, guarding against the two columns ever disagreeing) and
// user_accounts, rather than fetching the game and checking ownership in JS.
async function getUserGameForUser(userId, gameId) {
  const [rows] = await pool.query(
    `SELECT ug.* FROM user_games ug
     JOIN accounts a ON a.id = ug.account_id AND a.platform_id = ug.platform_id
     JOIN user_accounts ua ON ua.account_id = a.id AND ua.user_id = ?
     WHERE ug.id = ?
     LIMIT 1;`,
    [userId, gameId]
  );
  return rows.length ? rows[0] : null;
}

// Returns up to `limit` of userId's most recent games (same ownership join
// as getUserGameForUser), newest first, starting after `offset` rows. Callers
// paginating should fetch pageSize + 1 rows to detect a next page without a
// separate COUNT(*) query.
async function getLatestUserGames(userId, limit, offset = 0) {
  const [rows] = await pool.query(
    `SELECT ug.* FROM user_games ug
     JOIN accounts a ON a.id = ug.account_id AND a.platform_id = ug.platform_id
     JOIN user_accounts ua ON ua.account_id = a.id AND ua.user_id = ?
     ORDER BY ug.date DESC, ug.id DESC
     LIMIT ? OFFSET ?;`,
    [userId, Number(limit), Number(offset)]
  );
  return rows;
}

// Same as getLatestUserGames, scoped to games whose opening matches `eco`.
// An eco code covers several opening_book ids (a trunk line plus deeper
// named variations, see getOpeningBookByEco), so this joins opening_book on
// book_id and filters by eco rather than comparing against a single id.
async function getLatestUserGamesByEco(userId, eco, limit, offset = 0) {
  const [rows] = await pool.query(
    `SELECT ug.* FROM user_games ug
     JOIN accounts a ON a.id = ug.account_id AND a.platform_id = ug.platform_id
     JOIN user_accounts ua ON ua.account_id = a.id AND ua.user_id = ?
     JOIN opening_book ob ON ob.id = ug.book_id
     WHERE ob.eco = ?
     ORDER BY ug.date DESC, ug.id DESC
     LIMIT ? OFFSET ?;`,
    [userId, eco, Number(limit), Number(offset)]
  );
  return rows;
}

// Returns the ids of the games immediately adjacent to (date, gameId) in
// userId's game history, ordered the same way as getLatestUserGames (newest
// first, same ownership join): prevGameId is the next-newer game (the row
// just above this one in that list), nextGameId is the next-older game (the
// row just below), either null if this is the first/last game. Comparing the
// (date, id) tuple rather than date alone keeps this deterministic even when
// two games share a `date` (the column isn't unique).
//
// When `eco` is given, both sub-queries also join opening_book on book_id
// and filter by eco, so adjacency is computed within the eco-filtered list
// (matching getLatestUserGamesByEco) instead of the full history -- an eco
// covers several opening_book ids (see getLatestUserGamesByEco), so this
// can't be done by comparing book_id directly.
async function getAdjacentUserGameIds(userId, date, gameId, eco = null) {
  const ecoJoin = eco ? 'JOIN opening_book ob ON ob.id = ug.book_id AND ob.eco = ?' : '';
  const ecoParams = eco ? [eco] : [];
  const [prevRows] = await pool.query(
    `SELECT ug.id FROM user_games ug
     JOIN accounts a ON a.id = ug.account_id AND a.platform_id = ug.platform_id
     JOIN user_accounts ua ON ua.account_id = a.id AND ua.user_id = ?
     ${ecoJoin}
     WHERE (ug.date, ug.id) > (?, ?)
     ORDER BY ug.date ASC, ug.id ASC
     LIMIT 1;`,
    [userId, ...ecoParams, date, gameId]
  );
  const [nextRows] = await pool.query(
    `SELECT ug.id FROM user_games ug
     JOIN accounts a ON a.id = ug.account_id AND a.platform_id = ug.platform_id
     JOIN user_accounts ua ON ua.account_id = a.id AND ua.user_id = ?
     ${ecoJoin}
     WHERE (ug.date, ug.id) < (?, ?)
     ORDER BY ug.date DESC, ug.id DESC
     LIMIT 1;`,
    [userId, ...ecoParams, date, gameId]
  );
  return {
    prevGameId: prevRows.length ? prevRows[0].id : null,
    nextGameId: nextRows.length ? nextRows[0].id : null
  };
}

async function getGameMoves(gameId) {
  const [rows] = await pool.query(
    'SELECT * FROM game_moves WHERE game_id = ? ORDER BY id ASC;',
    [gameId]
  );
  return rows;
}

async function getOpeningBookById(id) {
  const [rows] = await pool.query(
    'SELECT id, eco, name FROM opening_book WHERE id = ? LIMIT 1;',
    [id]
  );
  return rows.length ? rows[0] : null;
}

// Looks up an opening_book row by ECO code for the analysis page's ?eco=
// link (see index.ejs's Opening Books tab). An ECO code can map to several
// rows at different depths (a trunk line plus deeper named variations
// sharing the same code) -- ordering by pgn length picks the shortest,
// i.e. the trunk/canonical line, for a deterministic result.
async function getOpeningBookByEco(eco) {
  const [rows] = await pool.query(
    'SELECT id, eco, name, pgn FROM opening_book WHERE eco = ? ORDER BY CHAR_LENGTH(pgn) ASC, id ASC LIMIT 1;',
    [eco]
  );
  return rows.length ? rows[0] : null;
}

// Mirrors scripts/evaluateGames.js's own lookup for the sentinel "no known
// opening" row, so this file and that batch job agree on which row means
// "unrecognized" when stamping user_games.book_id.
async function getFallbackOpeningBookId() {
  const [rows] = await pool.query(
    "SELECT id FROM opening_book WHERE eco = '?' LIMIT 1;"
  );
  return rows.length ? rows[0].id : null;
}

async function setUserGameBookId(gameId, bookId) {
  await pool.query(
    'UPDATE user_games SET book_id = ? WHERE id = ?;',
    [bookId, gameId]
  );
}

// Per-account stats for everything userId owns/follows (one row per
// user_accounts entry). Aggregates come from user_games joined the same
// defensive account_id+platform_id way as the other queries here.
//
// `result` is written by scripts/downloadGames.js already relative to the
// tracked account, as the literal strings 'win' | 'draw' | 'loss' (not
// white/black-relative like '1-0'/'0-1'), so wins/losses/draws can be counted
// directly without cross-checking `side`. Accuracy, however, IS stored
// per-color (`white_accuracy`/`black_accuracy`), so that still needs `side`
// to know which column belongs to the tracked account.
async function getUserAccountsWithStats(userId) {
  const [rows] = await pool.query(
    `SELECT ua.account_id, ua.owner, a.accountname, p.name AS platform_name,
            COUNT(ug.id) AS total_games,
            SUM(CASE WHEN ug.result = 'win' THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN ug.result = 'loss' THEN 1 ELSE 0 END) AS losses,
            SUM(CASE WHEN ug.result = 'draw' THEN 1 ELSE 0 END) AS draws,
            AVG(CASE WHEN ug.side = 0 THEN ug.black_accuracy ELSE ug.white_accuracy END) AS avg_accuracy
     FROM user_accounts ua
     JOIN accounts a ON a.id = ua.account_id
     JOIN platforms p ON p.id = a.platform_id
     LEFT JOIN user_games ug ON ug.account_id = a.id AND ug.platform_id = a.platform_id
     WHERE ua.user_id = ?
     GROUP BY ua.account_id, ua.owner, a.accountname, p.name
     ORDER BY p.name ASC, a.accountname ASC;`,
    [userId]
  );
  return rows;
}

// Top openings played across all given account ids, grouped by account. One
// round trip for every account instead of looping a per-account query. The
// sentinel "unrecognized opening" row (opening_book.eco = '?', see
// getFallbackOpeningBookId) is excluded so the top-5 only shows real
// openings; games with no book_id yet (not evaluated) are dropped the same
// way by the INNER JOIN. Returns a map of account_id -> up to 5 rows,
// ordered by games played desc.
async function getTopOpeningsForAccounts(accountIds) {
  if (!accountIds.length) {
    return {};
  }

  const placeholders = accountIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT ug.account_id, ob.id AS book_id, ob.eco, ob.name, COUNT(*) AS games
     FROM user_games ug
     JOIN opening_book ob ON ob.id = ug.book_id
     WHERE ug.account_id IN (${placeholders}) AND ob.eco <> '?'
     GROUP BY ug.account_id, ob.id, ob.eco, ob.name
     ORDER BY ug.account_id ASC, games DESC;`,
    accountIds
  );

  const openingsByAccount = {};
  for (const row of rows) {
    const list = openingsByAccount[row.account_id] || (openingsByAccount[row.account_id] = []);
    if (list.length < 5) {
      list.push(row);
    }
  }
  return openingsByAccount;
}

// Site-wide top openings across every user_games row that has been matched
// to an opening_book entry (book_id IS NOT NULL via the INNER JOIN), scoped
// to accounts that are someone's own tracked account (user_accounts.owner =
// 1) rather than just followed. DISTINCT guards against double-counting a
// game if the same account is ever owned by more than one user_accounts row.
// Mirrors getTopOpeningsForAccounts in excluding the sentinel "unrecognized
// opening" row (opening_book.eco = '?', see getFallbackOpeningBookId) so the
// list only shows real openings.
async function getTopOpeningsOverall(limit) {
  const [rows] = await pool.query(
    `SELECT ob.id AS book_id, ob.eco, ob.name, COUNT(DISTINCT ug.id) AS games
     FROM user_games ug
     JOIN opening_book ob ON ob.id = ug.book_id
     JOIN user_accounts ua ON ua.account_id = ug.account_id AND ua.owner = 1
     WHERE ug.book_id IS NOT NULL AND ob.eco <> '?'
     GROUP BY ob.id, ob.eco, ob.name
     ORDER BY games DESC
     LIMIT ?;`,
    [limit]
  );
  return rows;
}

module.exports = { pool,
                   testConnection,
                   getPlatforms,
                   getPlatformAccount,
                   insertPlatformAccount,
                   getUserAccount,
                   insertUserAccount,
                   getUserGameForUser,
                   getLatestUserGames,
                   getLatestUserGamesByEco,
                   getAdjacentUserGameIds,
                   getGameMoves,
                   getOpeningBookById,
                   getOpeningBookByEco,
                   getFallbackOpeningBookId,
                   setUserGameBookId,
                   getUserAccountsWithStats,
                   getTopOpeningsForAccounts,
                   getTopOpeningsOverall
                 };

