/*
  Lichess Game Downloader & Move Processor
  Optimized with Transactions, Batch Inserts, and FEN Generation
*/

require('dotenv').config({
  path: require('path').resolve(__dirname, '.env')
});

const { Chess } = require('chess.js');
const mysql = require('mysql2/promise');
const axios = require('axios');

// Global timeout to prevent hanging (5 minutes)
const timeout = setTimeout(() => {
    console.error('ERROR: Script timed out!');
    process.exit(1);
}, 300000);

/**
 * Helper to extract tags from PGN strings
 */
function getPgnTag(pgn, tag) {
    if (!pgn) return "Unknown";
    const regex = new RegExp(`\\[${tag} "(.*?)"\\]`);
    const match = pgn.match(regex);
    return match ? match[1] : "Unknown";
}

async function downloadUserGames() {
    let conn;
    try {
        conn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME
        });

        // Get all users from the database
        const [users] = await conn.execute('SELECT id, name, lastname FROM users');

        for (const user of users) {
            console.log(`Processing User: ${user.name} ${user.lastname}`);

            // Fetch player accounts for this user specifically for Lichess
            const [players] = await conn.execute(
                `SELECT p.id, p.accountname, p.last_scan, pl.id as platform_id 
                 FROM players p
                 JOIN platforms pl ON p.platform_id = pl.id
                 WHERE p.user_id = ? AND pl.name = 'lichess.org'`,
                [user.id]
            );

            for (const player of players) {
                console.log(`  Target Account: ${player.accountname}`);

                let params = {
                    max: 10,
                    sort: 'dateAsc',
                    pgnInJson: true,
                    moves: true // Get UCI moves from API
                };

                // Resume from last scan if available
                if (player.last_scan) { 
                    params.since = new Date(player.last_scan).getTime() + 1; 
                }

                try {
                    const response = await axios.get(`${process.env.LI_USER_API}/${player.accountname}`, {
                        params: params,
                        headers: { 'Accept': 'application/x-ndjson' },
                        responseType: 'text'
                    });

                    const data = (response.data || "").toString().trim();
                    if (!data) continue;

                    const lines = data.split('\n').filter(l => l.trim() !== "");
                    let lastGameTimestamp = null;

                    for (const line of lines) {
                        const game = JSON.parse(line);
                        const gameDate = new Date(game.createdAt);
                        const pgnContent = game.pgn || "";

                        // Check for existing game to avoid duplicates
                        const [exists] = await conn.query(
                            "SELECT id FROM player_games WHERE player_id = ? AND game_id = ?",
                            [player.id, game.id]
                        );
                        if (exists.length > 0) continue;

                        // Start Transaction for this specific game and its moves
                        await conn.beginTransaction();

                        try {
                            const white = getPgnTag(pgnContent, "White");
                            const playerside = (white === player.accountname) ? 1 : 0;

                            // Insert Game Metadata - UPDATED: Added result column and value
                            const [gameResult] = await conn.query(
                                `INSERT INTO player_games (player_id, platform_id, game_id, date, side, white, black, white_elo, black_elo, time_control, termination, result) 
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [
                                    player.id, player.platform_id, game.id, gameDate, playerside, 
                                    white, getPgnTag(pgnContent, "Black"),
                                    getPgnTag(pgnContent, "WhiteElo"), getPgnTag(pgnContent, "BlackElo"),
                                    getPgnTag(pgnContent, "TimeControl"), getPgnTag(pgnContent, "Termination"),
                                    getPgnTag(pgnContent, "Result") // Extracting Result from PGN
                                ]
                            );
                            
                            const internalGameId = gameResult.insertId;

                            // Move Processing using chess.js
                            const chess = new Chess();
                            const uciMoves = game.moves ? game.moves.split(' ') : [];
                            const moveRecords = [];
                            let moveside = 1;

                            for (const moveUci of uciMoves) {
                                // Lichess 'moves' param gives UCI (long notation)
                                const moveResult = chess.move(moveUci);
                                if (moveResult) {
                                    moveRecords.push([
                                        internalGameId,
                                        chess.fen(),
                                        moveResult.san, // Short notation
                                        moveUci,        // Long notation
                                        moveside
                                    ]);
                                    moveside = moveside === 1 ? 0 : 1;
                                }
                            }

                            // Optimized Batch Insert for moves
                            if (moveRecords.length > 0) {
                                await conn.query(
                                    "INSERT INTO game_moves (game_id, fen, short_notation, long_notation, side) VALUES ?",
                                    [moveRecords]
                                );
                            }

                            await conn.commit();
                            console.log(`    [Synced: ${game.id}]`);
                            lastGameTimestamp = game.createdAt;

                        } catch (err) {
                            await conn.rollback();
                            console.error(`    [Failed: ${game.id}] Rolling back.`, err.message);
                        }
                    }

                    // Update player state after processing the batch
                    if (lastGameTimestamp) {
                        const lastScanDate = new Date(lastGameTimestamp);
                        await conn.query("UPDATE players SET last_scan = ? WHERE id = ?", [lastScanDate, player.id]);
                    }

                } catch (apiErr) {
                    console.log(`  API Error for ${player.accountname}:`, apiErr.message);
                }
            }
        }
    } catch (error) {
        console.error('Fatal Connection Error: ', error.message);
    } finally {
        if (conn) {
            await conn.end();
            console.log('Connection closed.');
        }
        timeout.unref();
    }
}

downloadUserGames();
