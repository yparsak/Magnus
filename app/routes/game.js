
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

    const gameId = req.query.id;
    const playerId = req.query.player;

    if (!gameId) {
        return res.status(400).send("game ID is required");
    }
      
    try {

      const [gameInfo] = await pool.query(
        `select pg.date, pg.white_elo, pg.black_elo, pg.termination, pg.result,pg.side, pg.time_control, pg.white, pg.black,ob.eco,ob.name from player_games pg left join opening_book ob on pg.book_id = ob.id
 where pg.id= ?`,
        [gameId]
      );

      const [gameData] = await pool.query(
        `select gm.id,gm.fen,gm.short_notation,e.material_eval, e.positional_eval, e.final_eval from game_moves gm left join evaluation e on gm.eval_id = e.id where game_id = ?`,
        [gameId]
      );

      let player = null;
      if (playerId) {
        const [ players ] = await pool.query(
          `select id,name,lastname from players where id = ?`,
          [ playerId ]
        );
        if (players.length > 0) {
          player = players[0];
        }
      }

      res.render('game',{
        info:   gameInfo, 
        moves : gameData,
        player: player,
        startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
      });

    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
  });

  module.exports = router;

