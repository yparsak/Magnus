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
    const [rows] = await pool.query('SELECT name, lastname FROM users LIMIT 10');
      res.render('index', { userList: rows });
    } catch (err) {
      console.error(err);
      res.status(500).send("Database Error");
    }
    //res.render('index');
  });

  module.exports = router;

