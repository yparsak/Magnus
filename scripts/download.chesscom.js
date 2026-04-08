/*
  Chess.com Chronological Sync
  Iterates month-by-month from join date or last scan.
*/

require('dotenv').config({
  path: require('path').resolve(__dirname, '.env')
});

const { Chess } = require('chess.js');
const mysql = require('mysql2/promise');
const axios = require('axios');

const timeout = setTimeout(() => {
    console.error('ERROR: Script timed out!');
    process.exit(1);
}, 300000);

function getPgnTag(pgn, tag) {
    if (!pgn) return "Unknown";
    const regex = new RegExp(`\\[${tag} "(.*?)"\\]`);
    const match = pgn.match(regex);
    return match ? match[1] : "Unknown";
}

async function downloadChessComGames() {
    let conn;
    try {
        conn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME
        });

        const [players] = await conn.execute(
            `SELECT p.id, p.user_id, p.accountname, p.last_scan, pl.id as platform_id 
             FROM players p
             JOIN platforms pl ON p.platform_id = pl.id
             WHERE pl.name = 'chess.com'`
        );

        for (const player of players) {
            console.log(`Processing: ${player.accountname}`);

            try {
                // 1. Get all available monthly archives for this player
                const archiveListRes = await axios.get(
                    `${process.env.CHESSCOM_USER_API}/${player.accountname}/games/archives`,
                    { headers: { 'User-Agent': process.env.USER_AGENT } }
                );
                
                const archives = archiveListRes.data.archives; // Array of URLs
                if (!archives || archives.length === 0) continue;

                let targetArchiveUrl = null;

                if (!player.last_scan) {
                    // Scenario A: Start from the very first month available
                    targetArchiveUrl = archives[0];
                    console.log(`  No last_scan found. Starting from oldest archive: ${targetArchiveUrl}`);
                } else {
                    // Scenario B: Find the archive immediately following the last_scan
                    const lastScanDate = new Date(player.last_scan);
                    const lastScanMonthStr = `${lastScanDate.getUTCFullYear()}/${String(lastScanDate.getUTCMonth() + 1).padStart(2, '0')}`;
                    
                    // Find index of the archive that matches our last scan
                    const lastIndex = archives.findIndex(url => url.includes(lastScanMonthStr));
                    
                    if (lastIndex !== -1 && lastIndex < archives.length - 1) {
                        targetArchiveUrl = archives[lastIndex + 1];
                        console.log(`  Resuming. Next month found: ${targetArchiveUrl}`);
                    } else if (lastIndex === -1) {
                        // If for some reason the last_scan month isn't in archives, default to first
                        targetArchiveUrl = archives[0];
                    } else {
                        console.log(`  Already up to date for ${player.accountname}.`);
                        continue;
                    }
                }

                // 2. Fetch the games for the selected month
                const gamesRes = await axios.get(targetArchiveUrl, {
                    headers: { 'User-Agent': process.env.USER_AGENT }
                });

                const games = gamesRes.data.games || [];
                let latestTimestampInBatch = null;

                for (const gameData of games) {
                    const gameTimestamp = new Date(gameData.end_time * 1000);
                    const gameIdPlatform = gameData.uuid || gameData.url;

                    // 3. Verify if game exists in DB before processing
                    const [exists] = await conn.query(
                        "SELECT id FROM player_games WHERE player_id = ? AND game_id = ?",
                        [player.id, gameIdPlatform]
                    );

                    if (exists.length > 0) continue;

                    // 4. Process and Insert
                    await conn.beginTransaction();
                    try {
                        const pgn = gameData.pgn || "";
                        const white = getPgnTag(pgn, "White");
                        const playerside = (white.toLowerCase() === player.accountname.toLowerCase()) ? 1 : 0;

                        const [gameResult] = await conn.query(
                            `INSERT INTO player_games (player_id, platform_id, game_id, date, side, white, black, white_elo, black_elo, time_control, termination) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                player.id, player.platform_id, gameIdPlatform, gameTimestamp, 
                                playerside, white, getPgnTag(pgn, "Black"),
                                getPgnTag(pgn, "WhiteElo"), getPgnTag(pgn, "BlackElo"),
                                getPgnTag(pgn, "TimeControl"), getPgnTag(pgn, "Termination")
                            ]
                        );

                        const internalGameId = gameResult.insertId;
                        const chess = new Chess();
                        const moves = chess.loadPgn(pgn) ? chess.history({ verbose: true }) : [];
                        
                        const moveRecords = [];
                        const tempChess = new Chess();
                        let moveside = 1;

                        for (const m of moves) {
                            const moveAttempt = tempChess.move(m.san);
                            if (moveAttempt) {
                                moveRecords.push([internalGameId, tempChess.fen(), m.san, `${m.from}${m.to}${m.promotion || ''}`, moveside]);
                                moveside = moveside === 1 ? 0 : 1;
                            }
                        }

                        if (moveRecords.length > 0) {
                            await conn.query("INSERT INTO game_moves (game_id, fen, short_notation, long_notation, side) VALUES ?", [moveRecords]);
                        }

                        await conn.commit();
                        latestTimestampInBatch = gameTimestamp;

                    } catch (dbErr) {
                        await conn.rollback();
                        console.error(`  Error inserting game ${gameIdPlatform}:`, dbErr.message);
                    }
                }

                // 5. Update last_scan to the last game of the month processed
                // If the month was empty, we use a date representing that month to move the pointer forward
                if (latestTimestampInBatch) {
                    await conn.query("UPDATE players SET last_scan = ? WHERE id = ?", [latestTimestampInBatch, player.id]);
                } else {
                    // Progress the pointer even if no NEW games were found in that archive
                    const archiveParts = targetArchiveUrl.split('/');
                    const dummyDate = new Date(Date.UTC(archiveParts[archiveParts.length-2], archiveParts[archiveParts.length-1]-1, 28));
                    await conn.query("UPDATE players SET last_scan = ? WHERE id = ?", [dummyDate, player.id]);
                }

                console.log(`  Finished processing month archive: ${targetArchiveUrl}`);

            } catch (apiErr) {
                console.error(`  API Error for ${player.accountname}:`, apiErr.message);
            }
        }
    } catch (error) {
        console.error('Fatal Error:', error.message);
    } finally {
        if (conn) await conn.end();
        clearTimeout(timeout);
    }
}

downloadChessComGames();
