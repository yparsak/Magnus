'use strict';

/**
 * db.js
 * Single home for all raw SQL used by scripts/. Callers own the connection
 * (and any transaction control on it); these functions just run statements
 * against a connection/pool handle passed in as the first argument.
 */

const mysql = require('mysql2/promise');
const dbConfig = require('./dbConfig');

async function createConnection() {
  return mysql.createConnection(dbConfig);
}

async function getAccountsToScan(conn) {
  const [accounts] = await conn.execute(
    `SELECT a.id, a.platform_id, p.name, a.accountname, a.last_scan FROM accounts a INNER JOIN platforms p ON a.platform_id = p.id`
  );
  return accounts;
}

async function insertUserGame(conn, account, game) {
  const [result] = await conn.execute(
    `INSERT IGNORE INTO user_games
       (account_id, platform_id, game_id, date, side, termination, points, result, time_control, white, white_elo, black, black_elo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [account.id, account.platform_id, game.externalId, game.date, game.side, game.termination,
     game.points, game.result, game.timeControl, game.white, game.whiteElo, game.black, game.blackElo]
  );
  return result;
}

async function insertGameMoves(conn, gameId, moves) {
  const rows = moves.map(move => [gameId, move.fen, move.shortNotation, move.longNotation, move.side]);
  const [result] = await conn.query(
    `INSERT INTO game_moves (game_id, fen, short_notation, long_notation, side) VALUES ?`,
    [rows]
  );
  return result;
}

async function updateLastScan(conn, accountId, date) {
  const [result] = await conn.execute(
    `UPDATE accounts SET last_scan = ? WHERE id = ?`,
    [date, accountId]
  );
  return result;
}

async function insertUser(conn, username, passwordHash) {
  const [result] = await conn.query(
    'INSERT INTO users (username, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
    [username, passwordHash]
  );
  return result;
}

module.exports = {
  createConnection,
  getAccountsToScan,
  insertUserGame,
  insertGameMoves,
  updateLastScan,
  insertUser
};
