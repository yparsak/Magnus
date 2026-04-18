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

    const now = new Date();
    console.log(`Downloading lichess.org games @ ${now.toLocaleString()}`);

    let conn;
    try {
        conn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME
        });

        // Get all users from the database
        const [players] = await conn.execute('SELECT id, name, lastname FROM players');

        for (const player of players) {
            console.log(`Processing User: ${player.name} ${player.lastname}`);

            // Fetch accounts for this user specifically for Lichess
            const [accounts] = await conn.execute(
                `SELECT a.id, a.accountname, a.last_scan, pl.id as platform_id 
                 FROM accounts a 
                 JOIN platforms pl ON a.platform_id = pl.id
                 WHERE a.player_id = ? AND pl.name = 'lichess.org'`,
                [player.id]
            );

            for (const account of accounts) {
                console.log(`  Target Account: ${account.accountname}`);

                let params = {
                    max: 10,
                    sort: 'dateAsc',
                    pgnInJson: true,
                    moves: true // Get UCI moves from API
                };

                // Resume from last scan if available
                if (account.last_scan) { 
                    params.since = new Date(player.last_scan).getTime() + 1; 
                }

                try {
                    const response = await axios.get(`${process.env.LI_USER_API}/${account.accountname}`, {
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
                            "SELECT id FROM player_games WHERE account_id = ? AND game_id = ?",
                            [account.id, game.id]
                        );
                        if (exists.length > 0) continue;

                        // Start Transaction for this specific game and its moves
                        await conn.beginTransaction();

                        try {
                            const white = getPgnTag(pgnContent, "White");
                            const playerside = (white === player.accountname) ? 1 : 0;

                            const resultTag = getPgnTag(pgnContent, "Result");
                            let points = 0;

                            if (resultTag === "1/2-1/2") {
                              points = 1;
                            } else if (resultTag === "1-0") {
                              // White won: 2 points if player is white (1), 0 if black (0)
                              points = (playerside === 1) ? 2 : 0;
                            } else if (resultTag === "0-1") {
                              // Black won: 2 points if player is black (0), 0 if white (1)
                              points = (playerside === 0) ? 2 : 0;
                            }

                            const [gameResult] = await conn.query(
                            `INSERT INTO player_games (account_id, platform_id, game_id, date, side, white, black, white_elo, black_elo, time_control, termination, result, points)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                              account.id, 
                              account.platform_id, 
                              game.id, 
                              gameDate, 
                              playerside,
                              white, 
                              getPgnTag(pgnContent, "Black"),
                              getPgnTag(pgnContent, "WhiteElo"), 
                              getPgnTag(pgnContent, "BlackElo"),
                              getPgnTag(pgnContent, "TimeControl"), 
                              getPgnTag(pgnContent, "Termination"),
                              resultTag,
                              points 
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
                            //console.log(`    [Synced: ${game.id}]`);
                            lastGameTimestamp = game.createdAt;

                        } catch (err) {
                            await conn.rollback();
                            console.error(`    [Failed: ${game.id}] Rolling back.`, err.message);
                        }
                    }

                    // Update player state after processing the batch
                    if (lastGameTimestamp) {
                        const lastScanDate = new Date(lastGameTimestamp);
                        await conn.query("UPDATE accounts SET last_scan = ? WHERE id = ?", [lastScanDate, account.id]);
                    }

                } catch (apiErr) {
                    console.log(`  API Error for ${account.accountname}:`, apiErr.message);
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
