'use strict';

const axios      = require('axios');
const mysql      = require('mysql2/promise');
const dbConfig   = require('./lib/dbConfig');
const siteConfig = require('./lib/siteConfig');

const DELAY_MS = 60 * 60 * 1000; // 1 Hour

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function download_lichess(conn, account) {

  const params = {
    max:       100,
    sort:      'dateAsc',
    pgnInJson: true,
    moves:     true
  };

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
      console.log(`No data returned for ${account.accountname}`);
      return;
    }

    const lines = data
    .split(/\r?\n/)
    .filter(Boolean);

    for (const line of lines) {

      const game = JSON.parse(line);

      console.log(game.id);
      console.log(game.createdAt);
      console.log(game.players.white.user?.name);
      console.log(game.players.black.user?.name);

    }

  } catch (apiErr) {
    console.log(`API error for ${account.accountname}:`, apiErr.message);
  }

}

async function download_chesscom(conn, account) {
}

async function download() {
  console.log(`Downloading games @ ${new Date().toLocaleString()}`);
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const[accounts] = await conn.execute(
      `SELECT a.id, a.platform_id, p.name, a.accountname, a.last_scan FROM accounts a INNER JOIN platforms p ON a.platform_id = p.id`
    );
    for (const account of accounts) {
      console.log(`Platform: ${account.platform_id} ${account.name} Account: ${account.accountname}`);
      switch (account.name) {
        case 'lichess.org': await download_lichess(conn, account); break;
        case 'chess.com':   await download_chesscom(conn, account); break;
      }
    }
  } catch (err) {
    console.error('Database error:', err.message);    
  } 
}

async function main() {
//  while (true) {
    const startTime = Date.now();

    try {
      await download(); 
    } catch (err) {
      console.error("Error during iteration:", err);
    }

    const elapsed = Date.now() - startTime;
    const delay = Math.max(0, DELAY_MS - elapsed);
//    await sleep(delay); 
//  }
}

main().catch(console.error);

