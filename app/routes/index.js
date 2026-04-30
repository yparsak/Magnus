  require('dotenv').config();
  const mysql = require('mysql2');
  const path = require('path'); 

  const express = require('express');
  const router = express.Router();

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  }).promise();

  router.get('/', async (req, res) => {
    try {
    const [players] = await pool.query('SELECT id, name, lastname FROM players');

    if (players.length > 0) {

      const [accounts] = await pool.query('SELECT id FROM accounts');

      const [games] = await pool.query(
         'SELECT pg.id, pg.white, pg.black, pg.date, pg.result, pg.time_control, ob.eco, ob.name FROM player_games pg LEFT JOIN opening_book ob on pg.book_id = ob.id ORDER by pg.id DESC LIMIT 20' 
      );


      const formattedGames = games.map(game => {
        const d = new Date(game.date);
        const formatter = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
        });

        const parts = formatter.formatToParts(d);
        const p = Object.fromEntries(parts.map(p => [p.type, p.value]));

        // Construct exactly: MMM/DD/YYYY HH:MM:SS
        const finalDate = `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute}:${p.second}`;

        return { ...game, date: finalDate };
      });

      res.render('index', { playerList: players,
                            accountList: accounts,
                            gameList: formattedGames
      });

    } else {
      res.redirect('/player/add');
    }  

    } catch (err) {
      console.error(err);
      res.status(500).send("Database Error");
    }
    //res.render('index');
  });

  module.exports = router;

