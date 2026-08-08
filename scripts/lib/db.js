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

async function insert_usergames(
     account_id,
     platform_id,
     game_id,
     date,side, 
     termination,points, result, time_control,
     white, white_elo,
     black, black_elo  
   ) {
    const [result] = await pool.query(
      `INSERT IGNORE INTO user_games
         (account_id, platform_id, game_id, date, side, termination, points, result, time_control, white, white_elo, black, black_elo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
       [account.id, account.platform_id, game.externalId, game.date, game.side, game.termination,
        game.points, game.result, game.timeControl, game.white, game.whiteElo, game.black, game.blackElo]
    );
    return result;
}

async function insert_gamemoves(
     game_id,
     fen, short_notation, long_notation,
     side
   ) {

  const rows = game.moves.map(move => [game_id, fen, short_notation, long_notation, side]);

  const [result] = await pool.query(
    `INSERT INTO game_moves (game_id, fen, short_notation, long_notation, side) VALUES ?`,
    [rows]
  );

  return result;
}

module.exports = { pool,
                   insert_usergames,
                   insert_gamemoves
                 };

