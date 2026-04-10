const mariadb = require('mariadb');
require('dotenv').config();

// Configuration from dotenv 
const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectionLimit: 5
});

async function updateGameOpenings() {
    let conn;
    try {
        conn = await pool.getConnection();

        const na = await conn.query("SELECT id FROM opening_book WHERE eco = '?' limit 1");

        // 1. Select games where book_id is NULL
        const games = await conn.query("SELECT id FROM player_games WHERE book_id IS NULL");

        for (const game of games) {
            console.log(`Processing Game ID: ${game.id}`);

            // 2. Select moves for the game
            const moves = await conn.query(
                "SELECT fen FROM game_moves WHERE game_id = ? ORDER BY id ASC",
                [game.id]
            );

            let lastFoundBookId = null;

            // 3. Search for FENs in opening_book
            for (const move of moves) {
                const bookMatch = await conn.query(
                    "SELECT id FROM opening_book WHERE fen = ? LIMIT 1",
                    [move.fen]
                );

                if (bookMatch.length > 0) {
                    // Update the variable so we eventually keep the "last" one found in the sequence
                    lastFoundBookId = bookMatch[0].id;
                }
            }

            // 4. If a match was found, update player_games
            if (lastFoundBookId) {
                await conn.query(
                    "UPDATE player_games SET book_id = ? WHERE id = ?",
                    [lastFoundBookId, game.id]
                );
                console.log(`Successfully updated Game ${game.id} with Book ID ${lastFoundBookId}`);
            } else {
                if (na) {
                  await conn.query(
                    "UPDATE player_games SET book_id = ? WHERE id = ?",
                    [na.id, game.id]
                  );
                }
                console.log(`No opening match found for Game ${game.id}`);
            }
        }

    } catch (err) {
        console.error("Error during execution:", err);
    } finally {
        if (conn) conn.release();
        process.exit();
    }
}

updateGameOpenings();
