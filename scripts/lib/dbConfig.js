'use strict';

/**
 * dbConfig.js
 * Shared MariaDB connection configuration for background scripts.
 * Reads credentials from environment variables loaded via dotenv.
 */

require('dotenv').config({
  path: require('path').resolve(__dirname, '../../app/.env'),
  quiet: true
});

const dbConfig = {
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

module.exports = dbConfig;
