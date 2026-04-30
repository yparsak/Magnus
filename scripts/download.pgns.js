
  require('dotenv').config({
    path: require('path').resolve(__dirname, '.env'),
    quiet: true 
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

  async function download_lichess(conn, platform_id, account) {

    let params = {
        max: 50,
        sort: 'dateAsc',
        pgnInJson: true,
        moves: true // Get UCI moves from API
    };

    if (account.last_scan) {
      params.since = new Date(account.last_scan).getTime() + 1; 
    }
    
    try {
      const response = await axios.get(`${process.env.LI_USER_API}/${account.accountname}`, {
        params: params,
        headers: { 'Accept': 'application/x-ndjson' },
        responseType: 'text'
      });

      const data = (response.data || "").toString().trim();
      if (! data) {
        console.log(`Unable to parse data for ${account.accountname}: `);
      }

      const lines = data.split('\n').filter(l => l.trim() !== "");
      let lastGameTimestamp = null;

      await conn.beginTransaction();

      for (const line of lines) {

        const game = JSON.parse(line);
        const gameDate = new Date(game.createdAt);
        const pgnContent = game.pgn || "";

        const [gamelist] = await conn.query(
           "SELECT id FROM player_games WHERE platform_id = ? AND account_id = ? AND game_id = ?",
           [platform_id, account.id, game.id]
        );

        if (gamelist.length > 0) {
          // console.log("Game is already found in the database. Skipping..");
          continue;
        }

        if (! lastGameTimestamp) {lastGameTimestamp = game.createdAt;}
        if (  lastGameTimestamp < game.createdAt) { lastGameTimestamp = game.createdAt; }

        //await conn.beginTransaction();
        try {
          const white = getPgnTag(pgnContent, "White");
          const black = getPgnTag(pgnContent, "Black");
          const white_elo = getPgnTag(pgnContent, "WhiteElo");
          const black_elo = getPgnTag(pgnContent, "BlackElo");
          const time_control = getPgnTag(pgnContent, "TimeControl");
          const termination = getPgnTag(pgnContent, "Termination");
          const playerside = (white === account.accountname) ? 1 : 0;          
          const resultTag = getPgnTag(pgnContent, "Result");

          let points = 0;
          if (resultTag === "1/2-1/2") {
            points = 1;
          } else if (resultTag === "1-0") {
            points = (playerside === 1) ? 2 : 0;
          } else if (resultTag === "0-1") {
            points = (playerside === 0) ? 2 : 0;
          }

          const [pg_result] = await conn.query(
`INSERT INTO player_games (account_id, platform_id, game_id, date, side, white, black, white_elo, black_elo, time_control, termination, result, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              account.id,
              account.platform_id,
              game.id,
              gameDate,
              playerside,
              white,
              black,
              white_elo,
              black_elo,
              time_control,
              termination,
              resultTag,
              points
            ]);

          const gameId = pg_result.insertId;

          const chess = new Chess();
          const uciMoves = game.moves ? game.moves.split(' ') : [];
          const moveRecords = [];
          let moveside = 1;

          for (const moveUci of uciMoves) {
            const game_move = chess.move(moveUci);
            if (game_move) {
              // console.log(`${game_move.san}`);
              moveRecords.push(
              [
                gameId,
                chess.fen(),
                game_move.san,
                moveUci,
               moveside
             ]);
              moveside = moveside === 1 ? 0 : 1;
            }
          }

          if (moveRecords.length > 0) {
            await conn.query(
"INSERT INTO game_moves (game_id, fen, short_notation, long_notation, side) VALUES ?",
            [moveRecords]
            );
          }

        } catch (err) {
          await conn.rollback();
          console.error(`    [Failed: ${game.id}] Rolling back.`, err.message);
        }

        //console.log(`Processing ${game.id} ${game.createdAt} ${lastGameTimestamp}` );

      }
      
      if (lastGameTimestamp) {
        lastGameTimestamp += 60;
        const lastScanDate = new Date(lastGameTimestamp);
        await conn.query("UPDATE accounts SET last_scan = ? WHERE id = ?", [lastScanDate, account.id]);
      }

      await conn.commit();

    } catch (apiErr) {
      console.log(`API error for ${account.accountname}: `, apiErr.message);
    }
  }

async function download_chesscom(conn, platform_id, account) {

  const STANDARD_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  try {
    const archiveList = await axios.get(
      `${process.env.CHESSCOM_USER_API}/${account.accountname}/games/archives`,
      { headers: { 'User-Agent': process.env.USER_AGENT } }
    );

    const archives = archiveList.data.archives;
    if (!archives || archives.length === 0) return;

    let downloadURL = null;
    let ndx = 0;

    if (!account.last_scan) {
      //console.log('Scan Date is null');
      downloadURL = archives[0];
    } else {
      const last_scan = new Date(account.last_scan);
      let ls_year = last_scan.getUTCFullYear();
      let ls_month = String(last_scan.getUTCMonth() + 1).padStart(2, '0');

      const regex = new RegExp(`/games/${ls_year}/${ls_month}$`);

      for (let i = 0; i < archives.length; i++) {
        if (regex.test(archives[i])) {
          // Pick the next archive if available, otherwise stay on current
          downloadURL = archives[i + 1] || archives[i];
          break;
        }
      }
      if (!downloadURL) downloadURL = archives[archives.length - 1];
    }

    if (!downloadURL) return;

    const url_match = downloadURL.match(/\/(\d{4})\/(\d{1,2})$/);
    const url_year = parseInt(url_match[1], 10);
    const url_month = parseInt(url_match[2], 10);
    const firstDay = new Date(Date.UTC(url_year, url_month - 1, 1));
    const last_scan_value = firstDay.toISOString().slice(0, 19).replace('T', ' ');

    console.log(`Downloading: ${downloadURL}`);
    const gamesRes = await axios.get(downloadURL, {
      headers: { 'User-Agent': process.env.USER_AGENT }
    });

    const games = gamesRes.data.games || [];
    
    for (const gameData of games) {

      //Filter out non-standard rules (Chess960, King of the Hill, etc.)
      if (gameData.rules && gameData.rules !== "chess") {
        console.log(`Skipping game ${gameData.uuid}: Non-standard rules (${gameData.rules})`);
        continue;
      }


      //console.log(`Game uuid: ${gameData.uuid}`);
      const externalGameId = gameData.uuid || gameData.url;

      const [exists] = await conn.query(
        "SELECT id FROM player_games WHERE platform_id = ? AND account_id = ? AND game_id = ?",
        [platform_id, account.id, externalGameId]
      );
      if (exists.length > 0) continue;

      // Start transaction for this specific game
      await conn.beginTransaction();

      try {
        const pgn = gameData.pgn || "";
        const fenTag = getPgnTag(pgn, "FEN");

        // 2. Filter out custom setups or variants
        // If the game has a FEN tag and it doesn't match the standard start, skip it.
        if (fenTag !== "Unknown" && fenTag !== STANDARD_FEN) {
          console.log(`Skipping game ${gameData.uuid}: Custom setup/Variation detected.`);
          continue;
        }

        const white = getPgnTag(pgn, "White");
        const black = getPgnTag(pgn, "Black");
        const playerside = (white.toLowerCase() === account.accountname.toLowerCase()) ? 1 : 0;
        const resultTag = getPgnTag(pgn, "Result");
        const gameTimestamp = new Date(gameData.end_time * 1000);

        let points = 0;
        if (resultTag === "1/2-1/2") {
          points = 1;
        } else if (resultTag === "1-0") {
          points = (playerside === 1) ? 2 : 0;
        } else if (resultTag === "0-1") {
          points = (playerside === 0) ? 2 : 0;
        }

        const [gameResult] = await conn.query(
          `INSERT INTO player_games (account_id, platform_id, game_id, date, side, white, black, white_elo, black_elo, time_control, termination, result, points)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            account.id, platform_id, externalGameId, gameTimestamp,
            playerside, white, black,
            getPgnTag(pgn, "WhiteElo"), getPgnTag(pgn, "BlackElo"),
            getPgnTag(pgn, "TimeControl"), getPgnTag(pgn, "Termination"),
            resultTag, points
          ]
        );

        // 2. This is the internal DB ID
        const internalId = gameResult.insertId;

        const chess = new Chess();
        try {
          chess.loadPgn(pgn);
        } catch (e) {
          console.error(`Regex/Parsing error for game ${externalGameId}: ${e.message}`);
        }
        const moves = chess.history({ verbose: true });

        // Check if moves exist instead of checking the return value of loadPgn
        if (moves.length === 0 && pgn.trim().length > 0) {
          console.error(`Failed to parse any moves for game ${externalGameId}.`);
        } 

        const moveRecords = [];
        const tempChess = new Chess();
        let moveside = 1; 

        for (const m of moves) {
          const moveAttempt = tempChess.move(m.san);
          if (moveAttempt) {
              moveRecords.push([
              internalId, 
              tempChess.fen(), 
              m.san, 
              `${m.from}${m.to}${m.promotion || ''}`, 
              moveside
            ]);
            moveside = (moveside === 1) ? 0 : 1;
          }
        }
        //console.log(`Number of moves: ${moveRecords.length}`);

        if (moveRecords.length > 0) {
          await conn.query(
            "INSERT INTO game_moves (game_id, fen, short_notation, long_notation, side) VALUES ?", 
            [moveRecords]
          );
        }

        await conn.commit();
      } catch (err) {
        await conn.rollback();
        console.error(`Failed to insert game ${externalGameId}: ${err.message}`);
      }
    }

    // Update the account scan date after processing the archive
    await conn.query("UPDATE accounts SET last_scan = ? WHERE id = ?", [last_scan_value, account.id]);

  } catch (apiErr) {
    console.error(`API error for ${account.accountname}: `, apiErr.message);
  }
}

  async function main() {
    const now = new Date();
    console.log(`Downloading games @ ${now.toLocaleString()}`);

    let conn;
    try {

      conn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME
      });

      const [accounts] = await conn.execute(
        'SELECT a.id, a.player_id, a.platform_id, p.name as platform, a.accountname,a.last_scan FROM accounts a inner join platforms p on a.platform_id = p.id'
      );

      for (account of accounts) {
        console.log(`${account.platform} ${account.accountname}`);

        switch(account.platform) {
          case "lichess.org":
            await download_lichess(conn, account.platform_id, account);
            break;
          case "chess.com":
            await download_chesscom(conn, account.platform_id, account);
            break;
        }
      }
    }  catch (error) {
        console.error('Fatal Connection Error: ', error.message);
    } finally {
        if (conn) {
            await conn.end();
            //console.log('Connection closed.');
        }
        timeout.unref();
        const endtime = new Date();
        console.log(`Done Downloading games @ ${endtime.toLocaleString()}`);
    }
  }
main();
