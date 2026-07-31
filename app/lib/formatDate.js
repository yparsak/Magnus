'use strict';

/**
 * formatDate.js
 * Utility for formatting game dates consistently across all routes.
 */

const DATE_FORMAT_OPTIONS = {
  month:   'short',
  day:     '2-digit',
  year:    'numeric',
  hour:    '2-digit',
  minute:  '2-digit',
  second:  '2-digit',
  hour12:  false
};

/**
 * Formats a Date (or date string) into "MMM/DD/YYYY HH:MM:SS".
 * @param {Date|string} date
 * @returns {string}
 */
function formatGameDate(date) {
  const d = new Date(date);
  const formatter = new Intl.DateTimeFormat('en-US', DATE_FORMAT_OPTIONS);
  const parts = Object.fromEntries(formatter.formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * Maps an array of game rows, replacing the raw `date` field with a
 * formatted string. All other fields are preserved unchanged.
 * @param {Array} games
 * @returns {Array}
 */
function formatGameDates(games) {
  return games.map(game => ({ ...game, date: formatGameDate(game.date) }));
}

module.exports = { formatGameDate, formatGameDates };
