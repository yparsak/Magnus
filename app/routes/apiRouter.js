const express = require('express');
const router = express.Router();
const { testConnection } = require('../lib/db');

router.get('/health', async (req, res) => {
  try {
    await testConnection();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: err.message });
  }
});

module.exports = router;
