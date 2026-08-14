const express = require('express');
const router = express.Router();
const { pool, testConnection } = require('../lib/db');
const { ValidationError } = require('../lib/chess');
const { get_engine_eval, get_engine_bestmove } = require('../lib/engineApi');
const { findOpeningMatch } = require('../lib/openingBook');

router.get('/health', async (req, res) => {
  try {
    await testConnection();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: err.message });
  }
});

router.post('/engine/eval', async (req, res) => {
  try {
    const { fen, moves, depth } = req.body || {};
    const result = await get_engine_eval({ fen, moves, depth });
    res.json(result);
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/engine/bestmove', async (req, res) => {
  try {
    const { fen, moves, depth } = req.body || {};
    const moveList = await get_engine_bestmove({ fen, moves, depth });
    res.json({ moves: moveList });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/opening/detect', async (req, res) => {
  try {
    const { moves } = req.body || {};
    if (!Array.isArray(moves) || !moves.every((move) => typeof move === 'string')) {
      throw new ValidationError('"moves" must be an array of SAN strings.');
    }

    const match = await findOpeningMatch(pool, moves, 10);
    res.json({ opening: match ? { eco: match.eco, name: match.name } : null });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
