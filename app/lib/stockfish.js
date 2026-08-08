'use strict';

/**
 * stockfish.js
 * Wraps all Stockfish engine interactions for the web app.
 */

const { spawn } = require('child_process');
const ENGINE_PATH = process.env.ENGINE_PATH;

/**
 * Spawns the Stockfish engine, sends UCI commands, and collects stdout until
 * "bestmove" is received. Resolves with all output lines.
 *
 * @param {string[]} commands  UCI commands to send before waiting for bestmove
 * @returns {Promise<string[]>}
 */
function runEngine(commands) {
  return new Promise((resolve, reject) => {
    const engine = spawn(ENGINE_PATH);
    let buffer = '';
    const lines = [];

    engine.stdout.on('data', (data) => {
      buffer += data.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop(); // keep incomplete line

      for (const line of parts) {
        lines.push(line);
        if (line.startsWith('bestmove')) {
          engine.stdin.write('quit\n');
          resolve(lines);
        }
      }
    });

    engine.stderr.on('data', (data) => {
      console.error(`Engine stderr: ${data}`);
    });

    engine.on('error', reject);

    for (const cmd of commands) {
      engine.stdin.write(cmd + '\n');
    }
  });
}

/**
 * Parses a score (cp or mate) from a UCI output line.
 * @param {string} line
 * @returns {{ type: string, value: number }}
 */
function parseScore(line) {
  const cpMatch   = line.match(/score cp (-?\d+)/);
  const mateMatch = line.match(/score mate (-?\d+)/);
  if (cpMatch)   return { type: 'cp',   value: parseInt(cpMatch[1]) };
  if (mateMatch) return { type: 'mate', value: parseInt(mateMatch[1]) };
  return { type: 'cp', value: 0 };
}

/**
 * Returns the engine's best move and score for a given FEN.
 * @param {string} fen
 * @param {number} [wtime]
 * @param {number} [btime]
 * @param {number} [winc]
 * @param {number} [binc]
 * @returns {Promise<{ move: string, score: { type: string, value: number } }>}
 */
async function getBestMove(fen, wtime, btime, winc, binc) {
  let go = 'go';
  if (wtime !== undefined) go += ` wtime ${wtime}`;
  if (btime !== undefined) go += ` btime ${btime}`;
  if (winc  !== undefined) go += ` winc ${winc}`;
  if (binc  !== undefined) go += ` binc ${binc}`;
  if (go === 'go') go += ' depth 10';

  const lines = await runEngine([`position fen ${fen}`, go]);

  let lastScore = { type: 'cp', value: 0 };
  let move = null;

  for (const line of lines) {
    if (line.includes('score')) lastScore = parseScore(line);
    if (line.startsWith('bestmove')) move = line.split(' ')[1];
  }

  return { move, score: lastScore };
}

/**
 * Returns a centipawn/mate evaluation for a given FEN.
 * @param {string} fen
 * @param {number} [depth=10]
 * @returns {Promise<{ type: string, value: number }>}
 */
async function getEvaluation(fen, depth = 10) {
  const lines = await runEngine([`position fen ${fen}`, `go depth ${depth}`]);

  let lastScore = { type: 'cp', value: 0 };
  for (const line of lines) {
    if (line.includes('score')) lastScore = parseScore(line);
  }
  return lastScore;
}

/**
 * Returns multiple principal variations (lines) for a given FEN.
 * @param {string} fen
 * @param {number} [multiPV=10]
 * @param {number} [depth=10]
 * @returns {Promise<Array<{ multipv: number, score: object, pv: string }>>}
 */
async function getAnalysis(fen, multiPV = 10, depth = 10) {
  const lines = await runEngine([
    'uci',
    `setoption name MultiPV value ${multiPV}`,
    `position fen ${fen}`,
    `go depth ${depth}`
  ]);

  const pvLines = [];
  for (const line of lines) {
    if (!line.includes('multipv')) continue;

    const mpvMatch = line.match(/multipv (\d+)/);
    const pvMatch  = line.match(/ pv (.+)/);
    if (!mpvMatch || !pvMatch) continue;

    const mpv = parseInt(mpvMatch[1]);
    pvLines[mpv - 1] = {
      multipv: mpv,
      score: parseScore(line),
      pv: pvMatch[1]
    };
  }

  return pvLines.filter(Boolean);
}

module.exports = { getBestMove, getEvaluation, getAnalysis };

