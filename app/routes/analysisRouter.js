const express = require('express');
const router = express.Router();
const pool   = require('../lib/db');

const { renderPage } = require('../lib/renderPage');
const { isValidFen } = require('../lib/chess'); 

router.get('/', async (req, res) => {
  try {
    var fen = req.query.fen;
    var pageData = (typeof fen === 'string' && isValidFen(fen)) ? { fen: fen } : {};

    renderPage (res,'main_template', 'analysis', {
        mode: 'editor',
        title: 'Magnus - Analysis Board',
        showPromotionLayer: false,
        pageData: pageData
      }
    );
  }
  catch (err) {
    console.error(err);
    res.status(500).send('Databas Error');
  }
});

module.exports = router;
