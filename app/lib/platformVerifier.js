'use strict';

/**
 * platformVerifier.js
 * Verifies that a username exists on a given chess platform (Lichess, Chess.com).
 * Extracted from account.js so it can be reused anywhere.
 */

/**
 * Verifies a Lichess username by checking for a 'createdAt' field in the API response.
 * @param {string} accountname
 * @returns {Promise<boolean>}
 */
async function checkLichessUser(accountname) {
  if (! accountname) return false;
  try {
    const response = await fetch(`https://lichess.org/api/user/${accountname}`);
    if (response.status === 200) {
      const data = await response.json();
      return data.createdAt !== undefined;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Verifies a Chess.com username by checking for a 'joined' field in the API response.
 * @param {string} accountname
 * @returns {Promise<boolean>}
 */
async function checkChessComUser(accountname) {
  if (!accountname) return false;
  try {
    const response = await fetch(
      `https://api.chess.com/pub/player/${accountname.toLowerCase()}`,
      { headers: { 'User-Agent': 'Magnus/1.0' } }
    );
    if (response.status === 200) {
      const data = await response.json();
      return data.joined !== undefined && data.code === undefined;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Dispatches to the correct platform verifier by platform name.
 * Returns false for unrecognized platforms.
 * @param {string} platform  e.g. "lichess.org" | "chess.com"
 * @param {string} username
 * @returns {Promise<boolean>}
 */
async function verifyPlatformAccount(platform, accountname) {
  switch (platform) {
    case 1: return checkLichessUser(accountname);
    case 2:   return checkChessComUser(accountname);
    default:            return false;
  }
}

module.exports = { checkLichessUser, checkChessComUser, verifyPlatformAccount };
