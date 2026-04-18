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

/**
 * Verifies Lichess user by checking the 'createdAt' timestamp.
 */
async function checkLichessUser(user) {
  if (!user) return false;
  
  try {
    const response = await fetch(`https://lichess.org/api/user/${user}`);
    
    if (response.status === 200) {
      const data = await response.json();
      // Check if the registration date property exists
      return data.createdAt !== undefined;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Verifies Chess.com user by checking the 'joined' timestamp.
 */
async function checkChessComUser(user) {
  if (!user) return false;
  
  try {
    const response = await fetch(`https://api.chess.com/pub/player/${user.toLowerCase()}`, {
      headers: {
        // Chess.com prefers a User-Agent to identify the source of the request
        'User-Agent': 'ChessValidator/1.0 (contact: your@email.com)'
      }
    });

    if (response.status === 200) {
      const data = await response.json();
      
      // Ensure we didn't get an error object (like your "not found" example)
      // and that the 'joined' registration date exists.
      return data.joined !== undefined && data.code === undefined;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

  async function addPlayerAccount(playerId, platformName, accountName) {
    try {
      const[platforms] = await pool.execute(
        'SELECT id FROM platforms WHERE name = ?',
        [platformName]
      );

      if (platforms.length === 0) {
        console.error('Platform not found');
        return;
      }
      const platformId = platforms[0].id;

      const [accounts] = await pool.execute(
        'SELECT id FROM accounts WHERE platform_id = ? AND accountname = ?',
        [platformId, accountName]
      );
      if (accounts.length > 0) {
        console.log('Account already exists. Exiting...');
        return;
      } 

     //console.log(
     // `INSERT INTO accounts (player_id, platform_id, accountname) VALUES (${playerId}, ${platformId}, ${accountName})`
     //);

     const [result] = await pool.execute(
       'INSERT INTO accounts (player_id, platform_id, accountname) VALUES (?, ?, ?)',
       [playerId, platformId, accountName]
     );

    } catch(err) {
      console.error(err);
      return;
    }
  }

  router.use(express.urlencoded({ extended: true }));

  router.get('/add', (req, res) => {
    const playerId = req.query.playerId;
    const errorMessage = req.query.error;

    res.render('add_account_form', { error: errorMessage, playerId:playerId  });
  });

  router.post('/add', async (req, res) => {
    const {playerId, accountName, platform, action } = req.body;

    if (action === 'cancel') {
      return res.redirect('/'); 
    }

    if (! accountName || ! platform) {
      return res.redirect('/account/add?error=missing_fields');
    } 

    switch (platform) {
      case "lichess.org":
        const isLichessUser = await checkLichessUser(accountName);
        if (isLichessUser) {
          console.log('lichess account does exist');
          // intentional fall through
        } else  {
          console.log('lichess account does NOT exist');
          return res.redirect('/account/add?error=account_doesnt_exist');
        } 
        break;

      case "chess.com":
        const isChessComUser = await checkChessComUser(accountName);
        if (isChessComUser) {
          console.log('chess.com account does exists');
          // intentional fall through
        } else  {
          console.log('chess.com account does NOT exists');
          return res.redirect('/account/add?error=account_doesnt_exist');
        }
        break;

      default:
        console.error(`Unrecognized platform ${platform}`);
        return res.redirect('/account/add?error=unknown_platform');
    }

   addPlayerAccount(playerId, platform, accountName)

    return res.redirect(`/player?id=${playerId}`);

  });

  module.exports = router;

