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

  router.use(express.urlencoded({ extended: true }));

  router.get('/', async (req, res) => {
    const playerId = req.query.id;
    if (!playerId) {
        return res.status(400).send("player ID is required");
    }
    try {
        const [rows] = await pool.query(
            `SELECT id, name, lastname FROM players WHERE id = ?`,
            [playerId]
        );
        if (rows.length > 0) {
            res.render('player', { player: rows[0] });
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

