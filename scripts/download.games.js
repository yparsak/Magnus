'use strict';

const axios      = require('axios');
const mysql      = require('mysql2/promise');
const { Chess }  = require('chess.js');
const dbConfig   = require('./lib/dbConfig');
const siteConfig = require('./lib/siteConfig');

const DELAY_MS              = 60 * 60 * 1000; // 1 Hour
const MAX_GAMES_PER_ACCOUNT = 50;
const CHESSCOM_HEADERS      = { 'User-Agent': 'Magnus Chess Trainer (background game importer)' };

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchLichessGames(account) {

  const params = {
    max:       MAX_GAMES_PER_ACCOUNT,
    sort:      'dateAsc',
    pgnInJson: true,
    moves:     true
  };

  // Resume where the previous run left off: lichess's `since` is exclusive-ish,
  // so nudge 1ms past the last processed game to avoid re-downloading it.
  if (account.last_scan) {
    params.since = new Date(account.last_scan).getTime() + 1;
  }

  try {

    console.log(`${siteConfig.LICHESS_USER_API}/${account.accountname}`);

    const response = await axios.get(
      `${siteConfig.LICHESS_USER_API}/${account.accountname}`,
      { params,
        headers: { Accept: 'application/x-ndjson' },
        responseType: 'text',
        timeout: 60000
      }
    );

    const data = (response.data || '').toString().trim();

    if (!data) {
      return [];
    }

    return data
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        const game = JSON.parse(line);
        return { externalId: game.id, dateMs: game.createdAt, pgn: game.pgn };
      });

  } catch (apiErr) {
    console.error(`API error for ${account.accountname}:`, apiErr.message);
    return [];
  }
}

function findArchiveStartIndex(archives, sinceMs) {
  const sinceDate = new Date(sinceMs);
  const targetKey  = sinceDate.getUTCFullYear() * 100 + (sinceDate.getUTCMonth() + 1);

  for (let i = 0; i < archives.length; i++) {
    const match = archives[i].match(/\/(\d{4})\/(\d{2})$/);
    if (!match) {
      continue;
    }
    const key = Number(match[1]) * 100 + Number(match[2]);
    if (key >= targetKey) {
      return i;
    }
  }

  return archives.length;
}

async function fetchChesscomGames(account) {

  const username    = account.accountname.toLowerCase();
  const archivesUrl = `${siteConfig.CHESSCOM_USER_API}/${username}/games/archives`;

  let archives;
  try {
    console.log(archivesUrl);
    const response = await axios.get(archivesUrl, { headers: CHESSCOM_HEADERS, timeout: 60000 });
    archives = response.data?.archives || [];
  } catch (apiErr) {
    console.error(`API error for ${account.accountname}:`, apiErr.message);
    return [];
  }

  if (!archives.length) {
    return [];
  }

  // chess.com has no `since`/limit params, so we walk monthly archives (oldest to
  // newest) starting at the month containing last_scan, and stop once we have 50.
  const sinceMs    = account.last_scan ? new Date(account.last_scan).getTime() : null;
  const startIndex = sinceMs ? findArchiveStartIndex(archives, sinceMs) : 0;

  const games = [];

  for (let i = startIndex; i < archives.length && games.length < MAX_GAMES_PER_ACCOUNT; i++) {

    let monthGames;
    try {
      const response = await axios.get(archives[i], { headers: CHESSCOM_HEADERS, timeout: 60000 });
      monthGames = response.data?.games || [];
    } catch (apiErr) {
      console.error(`API error for ${account.accountname} archive ${archives[i]}:`, apiErr.message);
      continue;
    }

    monthGames = monthGames
      .filter(game => !sinceMs || (game.end_time * 1000) > sinceMs)
      .sort((a, b) => a.end_time - b.end_time);

    for (const game of monthGames) {
      games.push({ externalId: game.url, dateMs: game.end_time * 1000, pgn: game.pgn });
      if (games.length >= MAX_GAMES_PER_ACCOUNT) {
        break;
      }
    }
  }

  return games;
}

function buildGameRecord(account, rawGame) {

  const chess = new Chess();
  let header  = {};
  let plies   = [];

  try {
    chess.loadPgn(rawGame.pgn);
    header = chess.header();
    plies  = chess.history({ verbose: true });
  } catch (pgnErr) {
    console.error(`Failed to parse PGN for game ${rawGame.externalId}:`, pgnErr.message);
  }

  const white     = header.White || null;
  const black     = header.Black || null;
  const whiteElo  = header.WhiteElo ? Number(header.WhiteElo) : null;
  const blackElo  = header.BlackElo ? Number(header.BlackElo) : null;
  const timeControl = header.TimeControl || null;
  const termination = header.Termination || null;

  // side: 1 = tracked account played white, 0 = tracked account played black
  const accountName = account.accountname.toLowerCase();
  let side;
  if (white && white.toLowerCase() === accountName) {
    side = 1;
  } else if (black && black.toLowerCase() === accountName) {
    side = 0;
  } else {
    console.error(`Could not determine side for ${account.accountname} in game ${rawGame.externalId}`);
    side = 1;
  }

  // result/points are recorded from the tracked account's perspective:
  // result: 'win' | 'draw' | 'loss', points: win=2, draw=1, loss=0
  const winner = header.Result === '1-0' ? 'white' : header.Result === '0-1' ? 'black' : null;
  let result = 'draw';
  let points = 1;
  if (winner) {
    const won = (winner === 'white' && side === 1) || (winner === 'black' && side === 0);
    result = won ? 'win' : 'loss';
    points = won ? 2 : 0;
  }

  return {
    externalId: rawGame.externalId,
    date:       new Date(rawGame.dateMs),
    side,
    termination,
    result,
    points,
    timeControl,
    white,
    whiteElo,
    black,
    blackElo,
    moves: plies.map(move => ({
      fen:            move.after,
      shortNotation:  move.san,
      longNotation:   move.lan,
      side:           move.color === 'w' ? 1 : 0
    }))
  };
}

async function persistGames(conn, account, rawGames) {

  await conn.beginTransaction();

  try {

    let latestDateMs = null;

    for (const rawGame of rawGames) {

      const game = buildGameRecord(account, rawGame);

      const [insertResult] = await conn.execute(
        `INSERT IGNORE INTO user_games
           (account_id, platform_id, game_id, date, side, termination, points, result, time_control, white, white_elo, black, black_elo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [account.id, account.platform_id, game.externalId, game.date, game.side, game.termination,
         game.points, game.result, game.timeControl, game.white, game.whiteElo, game.black, game.blackElo]
      );

      if (insertResult.affectedRows > 0 && game.moves.length) {
        const rows = game.moves.map(move => [insertResult.insertId, move.fen, move.shortNotation, move.longNotation, move.side]);
        await conn.query(
          `INSERT INTO game_moves (game_id, fen, short_notation, long_notation, side) VALUES ?`,
          [rows]
        );
      }

      // Advance last_scan past every game we looked at this batch (including
      // ones ignored as duplicates), so a crash-recovery rerun can't loop forever.
      if (latestDateMs === null || rawGame.dateMs > latestDateMs) {
        latestDateMs = rawGame.dateMs;
      }
    }

    if (latestDateMs !== null) {
      await conn.execute(
        `UPDATE accounts SET last_scan = ? WHERE id = ?`,
        [new Date(latestDateMs), account.id]
      );
    }

    await conn.commit();

  } catch (err) {
    await conn.rollback();
    console.error(`Failed to persist games for ${account.accountname}:`, err.message);
  }
}

async function download() {
  console.log(`Downloading games @ ${new Date().toLocaleString()}`);
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const [accounts] = await conn.execute(
      `SELECT a.id, a.platform_id, p.name, a.accountname, a.last_scan FROM accounts a INNER JOIN platforms p ON a.platform_id = p.id`
    );
    for (const account of accounts) {
      console.log(`Platform: ${account.platform_id} ${account.name} Account: ${account.accountname}`);

      let games = [];
      switch (account.name) {
        case 'lichess.org': games = await fetchLichessGames(account); break;
        case 'chess.com':   games = await fetchChesscomGames(account); break;
        default: continue;
      }

      if (!games.length) {
        console.log(`No new games for ${account.accountname}`);
        continue;
      }

      console.log(`Fetched ${games.length} new game(s) for ${account.accountname}`);
      await persistGames(conn, account, games);
    }
  } catch (err) {
    console.error('Database error:', err.message);
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

async function main() {
  while (true) {
    const startTime = Date.now();

    try {
      await download();
    } catch (err) {
      console.error("Error during iteration:", err);
    }

    const elapsed = Date.now() - startTime;
    const delay = Math.max(0, DELAY_MS - elapsed);
    await sleep(delay);
  }
}

main().catch(console.error);
