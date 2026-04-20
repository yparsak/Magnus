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
         'SELECT pg.white, pg.black, pg.date, pg.result, pg.time_control, ob.eco, ob.name FROM player_games pg LEFT JOIN opening_book ob on pg.book_id = ob.id ORDER by pg.id DESC' 
      );
        
      res.render('index', { playerList: players,
                            accountList: accounts,
                            gameList: games
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

