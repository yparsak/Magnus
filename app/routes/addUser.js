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

router.get('/', (req, res) => {
  const errorMessage = req.query.error; 
  res.render('add_user_form', { error: errorMessage });
});


router.post('/', async (req, res) => {
  const { firstName, lastName, action } = req.body;

  if (action === 'cancel') {
    return res.redirect('/'); 
  }

  // Basic validation to prevent empty inserts
  if (!firstName || !lastName) {
    return res.redirect('/add_user?error=missing_fields');
  }

  try {

   const [exists] = await pool.query(
      "SELECT id FROM users WHERE name = ? AND lastname = ?",
      [firstName, lastName]
    );

    if (exists.length === 0) {
      const sql = 'INSERT INTO users (name, lastname) VALUES (?, ?)';
      await pool.execute(sql, [firstName, lastName]);
      return res.redirect('/'); 
    } else {
      // Passing error via query string
      return res.redirect('/add_user?error=already_exists');
    }

  } catch (err) {
    console.error("Error managing user:", err);
    // Avoid sending raw error details to the client for security
    return res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
