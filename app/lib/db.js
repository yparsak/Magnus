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
     ORDER BY ug.date DESC
     LIMIT ? OFFSET ?;`,
    [userId, Number(limit), Number(offset)]
  );
  return rows;
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

module.exports = { pool,
                   testConnection,
                   getPlatforms,
                   getPlatformAccount,
                   insertPlatformAccount,
                   getUserAccount,
                   insertUserAccount,
                   getUserGameForUser,
                   getLatestUserGames,
                   getGameMoves,
                   getOpeningBookById,
                   getFallbackOpeningBookId,
                   setUserGameBookId
                 };

