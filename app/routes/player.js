
  require('dotenv').config({
    quiet: true 
  });

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

  router.use(express.urlencoded({ extended: true }));

  router.get('/', async (req, res) => {
    const playerId = req.query.id;
    // Get current page from query, default to 1
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    if (!playerId) {
        return res.status(400).send("player ID is required");
    }
    try {
        const [players] = await pool.query(
            `SELECT id, name, lastname FROM players WHERE id = ?`,
            [playerId]
        );
        
        if (players.length > 0) {
            const [accounts] = await pool.query(
                `select a.id, a.accountname, p.name from accounts a left join platforms p on a.platform_id = p.id where a.player_id = ?`,
                [players[0].id]
            );

            const [games] = await pool.query(
                `select pg.id, pg.white, pg.black, pg.result, pg.time_control, pg.date, pg.side  
                 from player_games pg 
                 inner join accounts a on pg.platform_id = a.platform_id 
                 where a.player_id = ? 
                 order by pg.date desc 
                 limit ? offset ?`,
                [players[0].id, limit + 1, offset]
            );

            const hasNextPage = games.length > limit;
            // Slice the array to only 20 items for display
            const displayGames = games.slice(0, limit);

            const formattedGames = displayGames.map(game => {
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
                const finalDate = `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute}:${p.second}`;

                return { ...game, date: finalDate };
            });

            res.render('player', { 
                player: players[0], 
                accounts: accounts, 
                games: formattedGames,
                currentPage: page,
                hasNextPage: hasNextPage
            });
        } else {
            res.redirect('/');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
  });

  router.get('/add', (req, res) => {
    const errorMessage = req.query.error; 
    res.render('add_player_form', { error: errorMessage });
  });

  router.post('/add', async (req, res) => {

    const { firstName, lastName, action } = req.body;

    if (action === 'cancel') {
      return res.redirect('/'); 
    }

    if (!firstName || !lastName) {
      return res.redirect('/player/add?error=missing_fields');
    }

    try {

      const [exists] = await pool.query(
        "SELECT id FROM players WHERE name = ? AND lastname = ?",
        [firstName, lastName]
      );

      if (exists.length === 0) {
        const sql = 'INSERT INTO players (name, lastname) VALUES (?, ?)';
        await pool.execute(sql, [firstName, lastName]);
        return res.redirect('/'); 
      } else {
        return res.redirect('/player/add?error=already_exists');
      }

    } catch (err) {
      console.error("Error managing user:", err);
      return res.status(500).send("Internal Server Error");
    }
  });

  module.exports = router;

