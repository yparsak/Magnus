/*
* 
* updates player_games 
* sets player_games.book_id = opening_book.id
* where player_games.fen=opening_book.fen
*
*/

  const mariadb = require('mariadb');
  require('dotenv').config({ quiet: true });

  // Configuration from dotenv 
  const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectionLimit: 5
  });

  const timeout = setTimeout(() => {
    console.error('ERROR: Script timed out!');
    process.exit(1);
  }, 300000);


async function updateGameOpenings() {

  const now = new Date();
  console.log(`UpdatingGameOpenings @ ${now.toLocaleString()}`);

  let conn;
 
  try {
    conn = await pool.getConnection();
  
    const na = await conn.query("SELECT id FROM opening_book WHERE eco = '?' limit 1");

    const games = await conn.query("SELECT id FROM player_games WHERE book_id IS NULL");

    for (const game of games) {
      //console.log(`Processing Game ID: ${game.id}`);

      const moves = await conn.query(
                "SELECT side,short_notation FROM game_moves WHERE game_id = ? ORDER BY id ASC",
                [game.id]
      );

      let lastBookFound=null;
      let pgn = '';
      let movecnt = 0;

      for (move of moves) {
        if (move.side == '1') {
          movecnt ++;
          if (pgn == '') {
            pgn=`${movecnt}.`
          } else {
            pgn=`${pgn} ${movecnt}.`
          }
        }
        
        pgn=`${pgn} ${move.short_notation}`;

        const books = await conn.query("SELECT id,eco,pgn,name FROM opening_book where pgn = ?",
                        [pgn]
        );

        //console.log(`${pgn}`);
        for (book of books) {
          lastBookFound=book;
          //console.log(`${book.id} ${book.eco} ${book.pgn}`);
        }
        //console.log(`${move.side} ${move.short_notation}`); 
        //console.log(`${pgn}`);
      }

      if (lastBookFound) {
        //console.log(`${lastBookFound.eco} ${lastBookFound.name}`);
      } else {
        lastBookFound=na;
        //console.log(`${na.eco}`);
      }
      await conn.query(
        "UPDATE player_games SET book_id = ? WHERE id = ?",
        [lastBookFound.id, game.id]
      );

    }

  } catch (err) {
    console.error(`Error executing updateGameOpenings ${err}`);
  } finally {
    if (conn) conn.release();
    timeout.unref();
    const endtime = new Date();
    console.log(`Done UpdatingGameOpenings @ ${endtime.toLocaleString()}`);
    process.exit();
  }
}

updateGameOpenings();

