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
    const userId = req.query.id;
    if (!userId) {
        return res.status(400).send("User ID is required");
    }
    try {
        const [rows] = await pool.query(
            `SELECT id, name, lastname FROM users WHERE id = ?`,
            [userId]
        );
        if (rows.length > 0) {
            res.render('user', { user: rows[0] });
        } else {
            res.redirect('/');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
});

  module.exports = router;

