'use strict';

/**
 * platformVerifier.js
 * Verifies that a username exists on a given chess platform (Lichess, Chess.com).
 * Extracted from account.js so it can be reused anywhere.
 */

/**
 * Verifies a Lichess username by checking for a 'createdAt' field in the API response.
 * @param {string} user
 * @returns {Promise<boolean>}
 */
async function checkLichessUser(user) {
  if (!user) return false;
  try {
    const response = await fetch(`https://lichess.org/api/user/${user}`);
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
 * @param {string} user
 * @returns {Promise<boolean>}
 */
async function checkChessComUser(user) {
  if (!user) return false;
  try {
    const response = await fetch(
      `https://api.chess.com/pub/player/${user.toLowerCase()}`,
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
async function verifyPlatformUser(platform, username) {
  switch (platform) {
    case 1: return checkLichessUser(username);
    case 2:   return checkChessComUser(username);
    default:            return false;
  }
}

module.exports = { checkLichessUser, checkChessComUser, verifyPlatformUser };
