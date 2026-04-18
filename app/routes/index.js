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
    const [rows] = await pool.query('SELECT id, name, lastname FROM players LIMIT 10');

    if (rows.length) {
      res.render('index', { playerList: rows });
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

